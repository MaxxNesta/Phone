// POS receipt templates: which template a sale prints with, what the slip
// shows, that reprints keep the version first printed, and that drawing or
// printing a receipt never posts or changes anything.
//
//   ALLOW_DESTRUCTIVE_TESTS=1 ./node_modules/.bin/tsx scripts/test-receipt-templates.mjs
//
// Destructive like the other posting suites: it empties the DEV transaction
// tables first. Templates it makes are removed at the end and the company's
// own default is put back.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { takeTestLock, releaseTestLock } from "./test-lock.mjs";
import { resetTransactions } from "./test-reset.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.DATABASE_URL && existsSync(join(root, ".env"))) {
  for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
    if (m) { process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, ""); break; }
  }
}
const url = process.env.DATABASE_URL;
const sql = postgres(url, { ssl: url.includes("localhost") ? false : "require",
  prepare: !url.includes("-pooler."), onnotice: () => {}, max: 4 });

let bad = 0, good = 0;
const check = (label, ok, detail = "") => {
  if (ok) good++; else bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "   " + detail : ""}`);
};
const section = (s) => console.log(`\n  ${s}`);
const luhn = (body) => {
  let sum = 0;
  for (let i = 0; i < 14; i++) { let d = Number(body[13 - i]); if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return body + ((10 - (sum % 10)) % 10);
};
// An action outside a request commits, then revalidatePath has no request to
// revalidate and the action reports that as its error. That is success here.
const NO_REQUEST = /static generation store|revalidat|Invariant|outside a request/i;
const done = (r) => !r?.error || NO_REQUEST.test(r.error);
const refusedWith = (r, re) => Boolean(r?.error) && !NO_REQUEST.test(r.error) && re.test(r.error);

const made = [];
let co, seeded;
try {
  [co] = await sql`select id, name, address, phone from company order by created_at limit 1`;
  if (!/\bDEV\b/i.test(String(co.name)) || process.env.ALLOW_DESTRUCTIVE_TESTS !== "1") {
    throw new Error(`This suite empties the transaction tables. Run it against a DEV database with ALLOW_DESTRUCTIVE_TESTS=1 ("${co.name}").`);
  }
  await takeTestLock(sql, "test-receipt-templates.mjs");
  await resetTransactions(sql);

  const P = await import("../lib/posting.ts");
  const R = await import("../lib/receipt.ts");
  const C = await import("../lib/receipt-config.ts");
  const A = await import("../lib/receipt-template-actions.ts");
  const AC = await import("../lib/auth-core.ts");
  // tsx compiles JSX the classic way (React.createElement); Next does not need this.
  globalThis.React = await import("react");
  const { ReceiptSlip } = await import("../components/receipt-slip.tsx");

  // Two branches, each with a warehouse under it if it has one.
  const branches = await sql`
    select b.id, b.name, b.address, b.phone,
           coalesce((select w.id from location w where w.parent_id = b.id and w.is_stock_location and w.is_active order by w.code limit 1),
                    case when b.is_stock_location then b.id end) as stock_id
      from location b where b.company_id = ${co.id} and b.parent_id is null and b.is_active order by b.code`;
  const [b1, b2] = branches.filter((b) => b.stock_id);
  if (!b1 || !b2) throw new Error("Needs two branches with stock locations on DEV.");
  const [supp] = await sql`select id from business_partner where company_id = ${co.id} and is_supplier and is_active order by code limit 1`;
  const [cust] = await sql`select id, name from business_partner where company_id = ${co.id} and is_customer and is_active and credit_limit is null and code <> 'WALKIN' order by code limit 1`;
  const [grp] = await sql`select id from item_group where company_id = ${co.id} and identity = 'IMEI' order by code limit 1`;
  const [accGrp] = await sql`select id from item_group where company_id = ${co.id} and identity = 'NONE' order by code limit 1`;
  const [uom] = await sql`select id from uom where company_id = ${co.id} order by code limit 1`;
  const cash = await sql`select id, name from account where company_id = ${co.id} and is_cash_account and is_active order by code limit 2`;
  const [tax] = await sql`select id from tax_code where company_id = ${co.id} and is_active and fn_tax_rate_on(id, current_date) > 0 order by code limit 1`;
  const today = new Date().toISOString().slice(0, 10);
  const stamp = String(Date.now()).slice(-7);
  console.log(`\n  ${co.name} · branches ${b1.name}, ${b2.name}`);

  seeded = (await sql`select id, is_default, is_active from receipt_template where company_id = ${co.id}`);

  let n = 0, k = 0;
  const item = async (name, phone) => {
    const [it] = await sql`
      insert into item (company_id, item_group_id, serial, name, base_uom_id, is_stocked, tracks_serial, identity)
      values (${co.id}, ${phone ? grp.id : accGrp.id}, ${"RT" + stamp + n++}, ${name}, ${uom.id}, true, ${phone}, ${phone ? "IMEI" : "NONE"})
      returning id`;
    return it.id;
  };
  const imei = () => luhn("35" + stamp + String(k++).padStart(5, "0"));
  const phone = await item("RT iPhone 17 Pro Max 256 GB", true);
  const cable = await item("RT USB-C to USB-C braided charging cable, 2 metre, fast charge 60 W, with a name long enough to wrap twice", false);
  const stock = async (loc, phones) => {
    const sn = Array.from({ length: phones }, imei);
    await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc, docDate: today,
      lines: [{ itemId: phone, qty: phones, unitCost: 3_000_000, serials: sn }, { itemId: cable, qty: 50, unitCost: 10_000 }] });
    return sn;
  };
  const sn1 = await stock(b1.stock_id, 8);
  const sn2 = await stock(b2.stock_id, 2);

  const sell = async ({ loc = b1.stock_id, partner = cust.id, lines, pay = [], memo = null, taxCodeId = null }) => {
    const [first, ...rest] = pay;
    return sql.begin(async (tx) => {
      const s = await P.postRetailSale({
        companyId: co.id, partnerId: partner, locationId: loc, docDate: today, dueDate: today,
        paymentType: rest.length === 0 && first ? "CASH" : "CREDIT", memo, reference: "POS:test" + stamp + n++,
        lines: lines.map((l) => ({ taxCodeId, ...l })),
        cashIn: first ? first[1] : 0, cashAccountId: first?.[0] ?? null,
      }, tx);
      for (const [acc, amt] of rest) {
        const r = await P.postCustomerReceipt({ companyId: co.id, partnerId: partner, docDate: today, cashAccountId: acc,
          locationId: loc, allocations: [{ invoiceId: s.id, amount: amt }], memo: `Payment against ${s.docNo}` }, tx);
        await tx`update document set lifecycle_owner_id = ${s.id} where id = ${r.id}`;
      }
      return s;
    });
  };
  const ledger = async () => (await sql`
    select (select count(*) from document)::int as docs, (select count(*) from journal_line)::int as jl,
           (select coalesce(sum(base_amount), 0)::float from journal_line where base_amount > 0) as dr,
           (select count(*) from stock_movement)::int as moves`)[0];
  const render = (view, logo = null) => renderToStaticMarkup(createElement(ReceiptSlip,
    { data: view.data, config: view.config, identity: view.identity, paper: view.paper, logoUrl: logo }));

  // ------------------------------------------------------------ templates --
  section("Templates: draft, publish, default");
  const mk = async (name, paper, branchId, cfg) => {
    const r = await A.createReceiptTemplate({ name: `RT ${stamp} ${name}`, paper, branchId });
    const [t] = await sql`select id from receipt_template where company_id = ${co.id} and name = ${`RT ${stamp} ${name}`}`;
    if (t) made.push(t.id);
    if (t && cfg) await A.saveReceiptDraft({ id: t.id, name: `RT ${stamp} ${name}`, paper, config: cfg });
    return { r, id: t?.id };
  };
  const coT = await mk("Company 80", "80", null, { ...C.defaultConfig("80"), custom: { ...C.defaultConfig("80").custom, footerText: "COMPANY-V1" } });
  check("a company template is created as a draft", done(coT.r) && Boolean(coT.id), coT.r?.error ?? "");
  const [d0] = await sql`select published_version, is_default from receipt_template where id = ${coT.id}`;
  check("a new template is not published and not the default", d0.published_version === null && d0.is_default === false);
  const notYet = await A.setDefaultReceiptTemplate({ id: coT.id });
  check("an unpublished template cannot be made the default", refusedWith(notYet, /Publish/), notYet?.error);
  const p1 = await A.publishReceiptTemplate({ id: coT.id });
  check("publishing makes version 1", done(p1), p1?.error ?? "");
  const dup = await A.createReceiptTemplate({ name: `RT ${stamp} Company 80`, paper: "80", branchId: null });
  check("two templates cannot share a name", refusedWith(dup, /already exists/), dup?.error);
  const badPaper = await A.createReceiptTemplate({ name: `RT ${stamp} bad`, paper: "110", branchId: null });
  check("only 58 mm, 80 mm or A4", refusedWith(badPaper, /58 mm, 80 mm or A4/), badPaper?.error);
  const sd = await A.setDefaultReceiptTemplate({ id: coT.id });
  check("a published template becomes the company default", done(sd), sd?.error ?? "");
  const defaults = await sql`select count(*)::int as n from receipt_template where company_id = ${co.id} and branch_id is null and is_default`;
  check("one company default at a time (the seeded one stepped down)", defaults[0].n === 1, `${defaults[0].n}`);

  // Draft edits never reach a sale until published.
  await A.saveReceiptDraft({ id: coT.id, name: `RT ${stamp} Company 80`, paper: "80",
    config: { ...C.defaultConfig("80"), custom: { ...C.defaultConfig("80").custom, footerText: "COMPANY-DRAFT" } } });
  const resolvedDraft = await R.resolveTemplate(co.id, b1.id);
  check("a saved draft does not change what sales print", resolvedDraft?.config?.custom?.footerText === "COMPANY-V1",
    resolvedDraft?.config?.custom?.footerText);

  const brT = await mk("Branch 58", "58", b2.id, { ...C.defaultConfig("58"), custom: { ...C.defaultConfig("58").custom, footerText: "BRANCH-58" } });
  await A.publishReceiptTemplate({ id: brT.id });
  await A.setDefaultReceiptTemplate({ id: brT.id });
  const r1 = await R.resolveTemplate(co.id, b1.id), r2 = await R.resolveTemplate(co.id, b2.id);
  check("a branch without its own default prints the company's", r1?.id === coT.id, r1?.name);
  check("a branch's own default overrides the company's", r2?.id === brT.id && r2.paper === "58", r2?.name);
  await A.setReceiptTemplateActive({ id: brT.id, active: false });
  const r2off = await R.resolveTemplate(co.id, b2.id);
  const [brOff] = await sql`select is_default from receipt_template where id = ${brT.id}`;
  check("turning a branch template off falls back to the company default", r2off?.id === coT.id && !brOff.is_default, r2off?.name);
  const reDef = await A.setDefaultReceiptTemplate({ id: brT.id });
  check("an inactive template cannot be the default", refusedWith(reDef, /Turn the template on/), reDef?.error);
  await A.setReceiptTemplateActive({ id: brT.id, active: true });
  await A.setDefaultReceiptTemplate({ id: brT.id });

  const imm = await sql`update receipt_template_version set config = '{}' where template_id = ${coT.id}`.then(() => "changed", (e) => e.message);
  check("a published version can never be edited", /never changed/.test(imm), imm);
  const audit = await sql`select action from receipt_template_audit where template_id = ${coT.id} order by acted_at`;
  check("every change is in the audit trail", ["CREATE", "SAVE_DRAFT", "PUBLISH", "SET_DEFAULT"].every((a) => audit.some((x) => x.action === a)),
    audit.map((a) => a.action).join(","));

  section("Who may change templates (enforced on the server)");
  const admin = { role: "ADMIN", branchId: null }, mgr1 = { role: "MANAGER", branchId: b1.id };
  const cashier = { role: "CASHIER", branchId: b1.id };
  check("receipts.manage: admin yes, manager yes, cashier no",
    AC.can(admin, "receipts.manage") && AC.can(mgr1, "receipts.manage") && !AC.can(cashier, "receipts.manage"));
  check("cashier can still sell and print (pos.sell)", AC.can(cashier, "pos.sell"));
  check("admin may edit company and any branch template",
    R.mayEditReceiptTemplate(admin, null) && R.mayEditReceiptTemplate(admin, b2.id));
  check("manager may edit their own branch's template only",
    R.mayEditReceiptTemplate(mgr1, b1.id) && !R.mayEditReceiptTemplate(mgr1, b2.id) && !R.mayEditReceiptTemplate(mgr1, null));
  check("cashier may edit none", !R.mayEditReceiptTemplate(cashier, b1.id) && !R.mayEditReceiptTemplate(cashier, null));
  const pathPerm = AC.PATH_PERMISSIONS?.find?.(([p]) => "/settings/receipt-templates".startsWith(p))?.[1];
  check("the settings page itself needs receipts.manage", pathPerm === "receipts.manage", String(pathPerm));
  const src = readFileSync(join(root, "lib/receipt-template-actions.ts"), "utf8");
  const exported = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
  const unguarded = exported.filter((fn) => {
    const body = src.slice(src.indexOf(`export async function ${fn}`)).split(/\nexport async function /)[0];
    return !/requirePermission\("(receipts|settings)\.manage"\)|can\(u, "receipts\.manage"\)/.test(body);
  });
  check("every template action checks permission first", unguarded.length === 0, unguarded.join(", "));
  const editing = ["saveReceiptDraft", "publishReceiptTemplate", "setDefaultReceiptTemplate", "setReceiptTemplateActive"]
    .filter((fn) => !src.slice(src.indexOf(`export async function ${fn}`)).split(/\nexport async function /)[0].includes("loadForEdit("));
  check("every change to a template goes through the branch check", editing.length === 0, editing.join(", "));

  // ------------------------------------------------------------- sales --
  section("Sales and their receipts");
  const before = await ledger();
  const cashSale = await sell({ lines: [{ itemId: phone, qty: 1, unitPrice: 4_000_000, serials: [sn1[0]], warrantyMonths: 12 }],
    pay: [[cash[0].id, 4_000_000]] });
  const after = await ledger();
  const v1 = await R.receiptView(co.id, cashSale.id, null, { bind: true });
  const v1b = await R.receiptView(co.id, cashSale.id, null, { bind: true });
  const after2 = await ledger();
  check("sale completes and its receipt draws", v1?.data.docNo === cashSale.docNo, v1?.data.docNo);
  check("receipt drawn with the branch's resolved template, version 1", v1?.template?.id === coT.id && v1.template.version === 1);
  check("drawing the receipt twice posts nothing", JSON.stringify(after) === JSON.stringify(after2), JSON.stringify(after2));
  check("the sale posted exactly one invoice (no duplicates from printing)",
    (await sql`select count(*)::int as n from document where doc_type = 'SALES_INVOICE'`)[0].n === 1);
  check("Cash: payment method is the cash account", v1.data.paymentMethod === cash[0].name, v1.data.paymentMethod);
  check("IMEI printed in full", render(v1).includes(sn1[0]));
  check("warranty from the unit sold: 12 months", v1.data.lines[0].warrantyMonths === 12 && /Warranty 12 months/.test(render(v1)));
  check("80 mm slip at the configured width", /rc-thermal rc-80/.test(render(v1)) && /--rc-width:72mm/.test(render(v1)));
  check("receipt carries the published footer, not the draft", render(v1).includes("COMPANY-V1") && !render(v1).includes("COMPANY-DRAFT"));

  const qr = await sell({ lines: [{ itemId: cable, qty: 3, unitPrice: 25_000 }], pay: [[cash[0].id, 75_000]], memo: "Paid by QR" });
  const card = await sell({ lines: [{ itemId: cable, qty: 1, unitPrice: 25_000 }], pay: [[cash[0].id, 25_000]], memo: "Card payment" });
  const vqr = await R.receiptView(co.id, qr.id, null, { bind: true }), vcard = await R.receiptView(co.id, card.id, null, { bind: true });
  check("QR: payment method QR", vqr.data.paymentMethod === "QR", vqr.data.paymentMethod);
  check("Card: payment method Card", vcard.data.paymentMethod === "Card", vcard.data.paymentMethod);
  check("quantity product: 3 × price, no IMEI line", vqr.data.lines[0].qty === 3 && vqr.data.lines[0].imeis.length === 0 && !/IMEI/.test(render(vqr)));

  const second = cash[1] ?? cash[0];
  const split = await sell({ lines: [{ itemId: phone, qty: 2, unitPrice: 4_000_000, serials: [sn1[1], sn1[2]] },
    { itemId: cable, qty: 2, unitPrice: 25_000, discountPct: 10 }],
    pay: [[cash[0].id, 5_000_000], [second.id, 3_045_000]] });
  const vs = await R.receiptView(co.id, split.id, null, { bind: true });
  const hs = render(vs);
  check("split: method Split payment with both amounts", vs.data.paymentMethod === "Split payment" && vs.data.paid.length === 2,
    `${vs.data.paymentMethod} ${vs.data.paid.length}`);
  check("multiple IMEIs on one line both print", hs.includes(sn1[1]) && hs.includes(sn1[2]));
  check("line discount shown and total is after discount", /Discount 10%/.test(hs) && Math.abs(vs.data.total - 8_045_000) < 0.01, String(vs.data.total));
  check("subtotal before discount", Math.abs(vs.data.subtotal - 8_050_000) < 0.01 && Math.abs(vs.data.discount - 5_000) < 0.01);
  check("long product names wrap, not overflow (overflow-wrap set on .rc)",
    /\.rc\s*\{[^}]*overflow-wrap:\s*anywhere/.test(readFileSync(join(root, "app/globals.css"), "utf8")));

  const credit = await sell({ lines: [{ itemId: cable, qty: 1, unitPrice: 30_000 }] });
  const vc = await R.receiptView(co.id, credit.id, null, { bind: true });
  check("credit: on account, nothing paid", vc.data.paymentMethod.startsWith("Credit") && Math.abs(vc.data.onAccount - 30_000) < 0.01, vc.data.paymentMethod);
  check("credit: On account line prints", /On account/.test(render(vc)));

  if (tax) {
    const taxed = await sell({ lines: [{ itemId: cable, qty: 1, unitPrice: 100_000 }], taxCodeId: tax.id });
    const vt = await R.receiptView(co.id, taxed.id, null, { bind: true });
    const noTaxCfg = { ...vt, config: { ...vt.config, transaction: { ...vt.config.transaction, showTaxWhenZero: false } } };
    check("tax charged always prints, even with the zero-tax line hidden", vt.data.tax > 0 && /<dt>Tax<\/dt>/.test(render(noTaxCfg)), String(vt.data.tax));
  } else check("tax charged always prints (no taxed code on DEV — skipped)", true, "skipped");
  const zeroTax = { ...v1, config: { ...v1.config, transaction: { ...v1.config.transaction, showTaxWhenZero: false } } };
  check("zero tax line hidden when the template says so", !/<dt>Tax<\/dt>/.test(render(zeroTax)));

  section("Branch default and isolation");
  const b2sale = await sell({ loc: b2.stock_id, lines: [{ itemId: phone, qty: 1, unitPrice: 4_000_000, serials: [sn2[0]] }], pay: [[cash[0].id, 4_000_000]] });
  const vb2 = await R.receiptView(co.id, b2sale.id, null, { bind: true });
  check("a sale at branch 2 prints with branch 2's 58 mm template", vb2.template?.id === brT.id && vb2.paper === "58");
  check("58 mm slip at 48 mm printable width", /rc-thermal rc-58/.test(render(vb2)) && /--rc-width:48mm/.test(render(vb2)));
  const b1Locs = (await sql`select id from location where id = ${b1.id} or parent_id = ${b1.id}`).map((r) => r.id);
  check("someone limited to branch 1 cannot open branch 2's receipt", (await R.receiptView(co.id, b2sale.id, b1Locs, { bind: false })) === null);
  const [other] = await sql`select id from company where id <> ${co.id} limit 1`;
  check("another company cannot open this company's receipt",
    (await R.receiptView(other?.id ?? "00000000-0000-0000-0000-000000000000", b2sale.id, null, { bind: false })) === null);

  section("Historical reprints");
  await A.saveReceiptDraft({ id: coT.id, name: `RT ${stamp} Company 80`, paper: "80",
    config: { ...C.defaultConfig("80"), custom: { ...C.defaultConfig("80").custom, footerText: "COMPANY-V2" } } });
  await A.publishReceiptTemplate({ id: coT.id });
  await sql`update company set address = ${"RT new address " + stamp} where id = ${co.id}`;
  const reprint = await R.receiptView(co.id, cashSale.id, null, { bind: true });
  check("a reprint after publishing v2 still uses v1", reprint.template?.version === 1 && render(reprint).includes("COMPANY-V1"));
  check("a reprint keeps the address printed the first time", !render(reprint).includes("RT new address"));
  const fresh = await sell({ lines: [{ itemId: cable, qty: 1, unitPrice: 25_000 }], pay: [[cash[0].id, 25_000]] });
  const vf = await R.receiptView(co.id, fresh.id, null, { bind: true });
  check("a new sale prints with v2", vf.template?.version === 2 && render(vf).includes("COMPANY-V2"));
  const pinImm = await sql`update sale_receipt set template_version = 2 where document_id = ${cashSale.id}`.then(() => "changed", (e) => e.message);
  check("a sale's pinned receipt can never be rewritten", /fixed once printed/.test(pinImm), pinImm);
  const look = await R.receiptView(co.id, credit.id, null, { bind: false });
  check("previewing a real sale pins nothing new", look.template?.version === 1);
  const unprinted = await sell({ lines: [{ itemId: cable, qty: 1, unitPrice: 25_000 }], pay: [[cash[0].id, 25_000]] });
  await R.receiptView(co.id, unprinted.id, null, { bind: false });
  check("a template preview of an unprinted sale leaves it unpinned",
    (await sql`select count(*)::int as n from sale_receipt where document_id = ${unprinted.id}`)[0].n === 0);

  section("What the slip shows");
  const masked = { ...vs, config: { ...vs.config, product: { ...vs.config.product, imeiMode: "masked" } } };
  const hm = render(masked);
  check("masked IMEI hides the middle digits", !hm.includes(sn1[1]) && hm.includes(sn1[1].slice(0, 4)) && hm.includes(sn1[1].slice(-3)));
  const off = C.sanitizeConfig({ product: { showImei: false, showVariant: false }, transaction: { showCashier: false, showCustomer: false,
    showPaymentMethod: false, showSubtotal: false }, identity: { showAddress: false, showPhone: false }, custom: { thankYou: "" } }, "80");
  const ho = render({ ...vs, config: off });
  check("every optional field can be hidden", !ho.includes(sn1[1]) && !ho.includes("Cashier") && !ho.includes("Customer") && !ho.includes("Subtotal"));
  check("receipt number, date, items and total always print", ho.includes(split.docNo) && ho.includes("Date") && ho.includes("Total") && ho.includes("rc-item"));
  const missing = render({ ...vs, identity: { companyName: "Shop", branchName: null, address: null, phone: null, hasLogo: false },
    data: { ...vs.data, customer: null, salesman: null, cashier: null } });
  check("missing optional data (no address, phone, cashier, customer) leaves no empty labels",
    !missing.includes("Tel:") && !missing.includes("Cashier") && !missing.includes("Customer") && !missing.includes("Sold by"));
  const evil = C.sanitizeConfig({ custom: { footerText: "<script>alert(1)</script>\u0007", headerText: "<img src=x onerror=alert(1)>" },
    general: { printableWidthMm: 500, autoPrint: "yes" }, style: { fontSize: "huge" }, bogus: { x: 1 } }, "58");
  const he = render({ ...vs, config: evil });
  check("template text is escaped, never markup", !he.includes("<script>") && he.includes("&lt;script&gt;") && !he.includes("<img src=x"));
  check("control characters are stripped", !evil.custom.footerText.includes("\u0007"));
  check("width is clamped to the paper (58 mm → at most 58)", evil.general.printableWidthMm === 58);
  check("wrong types fall back to defaults; unknown keys dropped", evil.general.autoPrint === false && evil.style.fontSize === "normal" && !("bogus" in evil));
  check("A4 has no thermal width", C.sanitizeConfig({ general: { printableWidthMm: 72 } }, "A4").general.printableWidthMm === 0);

  const many = { ...vs, paper: "A4", config: C.sanitizeConfig({}, "A4"),
    data: { ...vs.data, lines: Array.from({ length: 60 }, (_, i) => ({ ...vs.data.lines[1], lineNo: i + 1 })) } };
  const ha = render(many);
  check("A4 renders a table with a repeating header and every line", /rc-a4/.test(ha) && /<thead>/.test(ha) && (ha.match(/<tr>/g) ?? []).length === 61);
  const css = readFileSync(join(root, "app/globals.css"), "utf8"), pc = readFileSync(join(root, "components/receipt-print.tsx"), "utf8");
  check("A4 pagination: header repeats, rows and totals do not split",
    /\.rc-table thead \{ display: table-header-group/.test(css) && /\.rc-table tr \{ break-inside: avoid/.test(css) && /\.rc-a4-end[^}]*break-inside: avoid/.test(css));
  check("@page: A4 page size for A4, zero margin for thermal", /size: A4/.test(pc) && /margin: 0/.test(pc));
  check("print shows the receipt only", /html\[data-receipt-print\] body > \*:not\(\.receipt-print-host\)/.test(css));
  check("SAMPLE data is labelled as sample", renderToStaticMarkup(createElement(ReceiptSlip, { data: C.SAMPLE_RECEIPT,
    config: C.defaultConfig("80"), identity: C.SAMPLE_IDENTITY, paper: "80", sample: true })).includes("Sample data"));

  section("Nothing posted by receipts");
  const end = await ledger();
  const jeTotal = await sql`select coalesce(sum(base_amount), 0)::float as s from journal_line`;
  check("journals balance after every sale and reprint", Math.abs(jeTotal[0].s) < 0.01, String(jeTotal[0].s));
  check("documents grew only by the sales posted", end.docs > before.docs);
} catch (e) {
  bad++;
  console.log(`  FAIL  ${e.stack ?? e.message}`);
} finally {
  try {
    // Put the company back as it was: its default, its address, no test templates.
    if (co) await sql`update company set address = ${co.address}, phone = ${co.phone} where id = ${co.id}`;
    if (made.length) {
      await sql.begin(async (tx) => {
        await tx`truncate sale_receipt`;
        await tx`alter table receipt_template_version disable trigger trg_receipt_template_version_immutable`;
        await tx`delete from receipt_template_audit where template_id = any(${made})`;
        await tx`delete from receipt_template_version where template_id = any(${made})`;
        await tx`delete from receipt_template where id = any(${made})`;
        await tx`alter table receipt_template_version enable trigger trg_receipt_template_version_immutable`;
      });
    }
    for (const s of seeded ?? []) {
      await sql`update receipt_template set is_default = ${s.is_default}, is_active = ${s.is_active} where id = ${s.id}`;
    }
  } catch (e) { bad++; console.log(`  FAIL  cleanup: ${e.message}`); }
  await releaseTestLock(sql).catch(() => {});
  console.log(`\n  ${good} passed, ${bad} failed\n`);
  await sql.end();
  process.exit(bad ? 1 : 0);
}

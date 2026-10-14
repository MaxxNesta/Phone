// Receipt templates over real HTTP, signed in as real people.
//
//   AUTH_REQUIRED=true npx next dev -p 3001          (against the DEV database)
//   BASE_URL=http://localhost:3001 npx tsx scripts/live-receipt-templates.mjs setup
//   BASE_URL=http://localhost:3001 npx tsx scripts/live-receipt-templates.mjs api
//   ... drive the till in a browser as rt-cashier (see `setup` output) ...
//   npx tsx scripts/live-receipt-templates.mjs cleanup
//
// Not part of the regression sweep (it needs a running server with sign-in on).
// `setup` makes a test company and test people with live sessions; `api`
// sends the requests those people could send — pages, the logo route, and the
// server actions called directly — and compares the database before and after
// each refused one; `cleanup` deactivates the people, removes the test
// company, templates and logos, and puts the DEV company back.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import postgres from "postgres";
import { takeTestLock, releaseTestLock } from "./test-lock.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.DATABASE_URL && existsSync(join(root, ".env"))) {
  for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
    if (m) { process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, ""); break; }
  }
}
const url = process.env.DATABASE_URL;
const sql = postgres(url, { ssl: url.includes("localhost") ? false : "require",
  prepare: !url.includes("-pooler."), onnotice: () => {}, max: 3 });
const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const STATE = process.env.STATE_FILE ?? join(tmpdir(), "rt-live-state.json");
const PASSWORD = "RtLive-Test-1";
const mode = process.argv[2];

let good = 0, bad = 0;
const check = (label, ok, detail = "") => {
  if (ok) good++; else bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "   " + String(detail).slice(0, 220) : ""}`);
};
const section = (s) => console.log(`\n  ${s}`);
const luhn = (body) => {
  let sum = 0;
  for (let i = 0; i < 14; i++) { let d = Number(body[13 - i]); if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return body + ((10 - (sum % 10)) % 10);
};
const sha = (b) => createHash("sha256").update(b).digest("hex");

// A real PNG (a dark bar with a light stripe), built here so no fixture is needed.
function png(w = 160, h = 48) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = Math.abs(y - h / 2) < 4 ? 230 : 20;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0"), Buffer.from([0xff, 0xd9])]);

// ------------------------------------------------------------------ setup --

async function setup() {
  const [co] = await sql`select id, name, address, phone from company order by created_at limit 1`;
  if (!/\bDEV\b/i.test(co.name)) throw new Error(`Not a DEV database ("${co.name}").`);
  await takeTestLock(sql, "live-receipt-templates.mjs");
  const A = await import("../lib/auth-core.ts");
  const P = await import("../lib/posting.ts");
  const stamp = String(Date.now()).slice(-7);
  const state = { stamp, companyId: co.id, orig: { address: co.address, phone: co.phone }, users: {}, tokens: {} };

  const br = async (code) => (await sql`select id, name, (select w.id from location w where w.parent_id = b.id and w.is_stock_location order by w.code limit 1) as wh
      from location b where company_id = ${co.id} and code = ${code}`)[0];
  const b2 = await br("BR2"), yg = await br("YGN");
  state.branches = { b2, yg };

  const mkUser = async (companyId, key, role, branchId) => {
    const [u] = await sql`
      insert into app_user (company_id, name, initials, email, role, branch_id, sees_all_branches, password_hash, is_active)
      values (${companyId}, ${`RT ${stamp} ${key}`}, 'RT', ${`rt-${stamp}-${key}@rt-test.invalid`}, ${role}, ${branchId}, false,
              ${A.hashPassword(PASSWORD)}, true) returning id, name, email`;
    const token = randomBytes(32).toString("base64url");
    await sql`insert into user_session (user_id, token_hash, expires_at) values (${u.id}, ${A.tokenHash(token)}, now() + interval '3 hours')`;
    state.users[key] = { id: u.id, name: u.name, email: u.email, role, branchId };
    state.tokens[key] = token;
  };
  await mkUser(co.id, "admin", "ADMIN", null);
  await mkUser(co.id, "mgr2", "MANAGER", b2.id);
  await mkUser(co.id, "mgrY", "MANAGER", yg.id);
  await mkUser(co.id, "cashier", "CASHIER", b2.id);
  await mkUser(co.id, "cashierY", "CASHIER", yg.id);

  // A second company, to prove one company cannot see or change another's.
  const [other] = await sql`
    insert into company (code, name, base_currency) values (${"RT" + stamp}, ${"RT Other Co " + stamp}, 'MMK') returning id`;
  state.otherCompanyId = other.id;
  await mkUser(other.id, "otherAdmin", "ADMIN", null);

  // Stock for two real sales: one per branch, so receipts can be fetched across branches.
  const [supp] = await sql`select id from business_partner where company_id = ${co.id} and is_supplier and is_active order by code limit 1`;
  const [cust] = await sql`select id from business_partner where company_id = ${co.id} and is_customer and is_active and credit_limit is null and code <> 'WALKIN' order by code limit 1`;
  const [cash] = await sql`select id from account where company_id = ${co.id} and is_cash_account and is_active order by code limit 1`;
  const [item] = await sql`select id from item where company_id = ${co.id} and tracks_serial and is_active order by name limit 1`;
  let k = 0;
  const imei = () => luhn("35" + stamp + String(k++).padStart(5, "0"));
  const sold = {};
  for (const [key, b] of [["b2", b2], ["yg", yg]]) {
    const sn = [imei(), imei(), imei()];
    await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: b.wh, docDate: new Date().toISOString().slice(0, 10),
      lines: [{ itemId: item.id, qty: 3, unitCost: 2_000_000, serials: sn }] });
    const today = new Date().toISOString().slice(0, 10);
    const s = await P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: b.wh, docDate: today, dueDate: today,
      paymentType: "CASH", reference: `POS:rtlive${stamp}${key}`, cashIn: 2_500_000, cashAccountId: cash.id,
      lines: [{ itemId: item.id, qty: 1, unitPrice: 2_500_000, serials: [sn[0]] }] });
    sold[key] = { id: s.id, docNo: s.docNo, imei: sn[0], spare: sn.slice(1) };
    if (key === "b2") {
      // A sale nobody has opened the receipt of yet: its first view pins it.
      const u = await P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: b.wh, docDate: today, dueDate: today,
        paymentType: "CASH", reference: `POS:rtlive${stamp}${key}u`, cashIn: 2_500_000, cashAccountId: cash.id,
        lines: [{ itemId: item.id, qty: 1, unitPrice: 2_500_000, serials: [sn[1]] }] });
      sold.b2u = { id: u.id, docNo: u.docNo, imei: sn[1] };
    }
  }
  state.sales = sold; state.itemId = item.id;
  writeFileSync(STATE, JSON.stringify(state, null, 2));
  console.log(`  set up: ${Object.keys(state.users).length} people, 1 other company, 2 sales. State in ${STATE}`);
  console.log(`  sign-in for the browser: ${state.users.cashier.email} / ${state.users.admin.email} — password ${PASSWORD}`);
  await releaseTestLock(sql).catch(() => {});
}

// -------------------------------------------------------------------- api --

const load = () => JSON.parse(readFileSync(STATE, "utf8"));
const cookie = (t) => (t ? { Cookie: `erp_session=${t}` } : {});

let manifest = null;
async function actionId(name, st) {
  if (!manifest) {
    // Visit the pages once so a dev server has compiled the actions.
    for (const p of ["/settings/receipt-templates", "/pos"]) await fetch(BASE + p, { headers: cookie(st.tokens.admin), redirect: "manual" });
    manifest = JSON.parse(readFileSync(join(root, ".next/server/server-reference-manifest.json"), "utf8")).node;
  }
  const hit = Object.entries(manifest).find(([, v]) => v.exportedName === name && /receipt-template-actions|pos-actions/.test(v.filename ?? ""));
  if (!hit) throw new Error(`No server action named ${name} in the manifest`);
  return hit[0];
}

/** Calls a server action the way a browser does: POST with Next-Action. */
async function act(st, who, name, args, path = "/settings/receipt-templates") {
  const id = await actionId(name, st);
  const res = await fetch(BASE + path, {
    method: "POST", redirect: "manual",
    headers: { "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component", ...cookie(st.tokens[who]) },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  const ok = /"ok":"/.test(text) || /"id":"[0-9a-f-]{36}"/.test(text);
  const error = text.match(/"error":"((?:[^"\\]|\\.)*)"/)?.[1] ?? null;
  return { status: res.status, ok, error, text };
}
/** The same for an action taking a file. */
async function upload(st, who, file, name = "logo.png", type = "image/png", path = "/settings/receipt-templates") {
  const id = await actionId("uploadCompanyLogo", st);
  const fd = new FormData();
  fd.append("_1_logo", new Blob([file], { type }), name);
  fd.append("0", '[null,"$K1"]');
  const res = await fetch(BASE + path, { method: "POST", redirect: "manual",
    headers: { "Next-Action": id, Accept: "text/x-component", ...cookie(st.tokens[who]) }, body: fd });
  const text = await res.text();
  return { status: res.status, ok: /"ok":"/.test(text), error: text.match(/"error":"((?:[^"\\]|\\.)*)"/)?.[1] ?? null, text };
}

async function dbState(st) {
  const t = await sql`select id, name, branch_id, paper, is_active, is_default, published_version, md5(draft_config::text) as d
                        from receipt_template where company_id = ${st.companyId} order by id`;
  const v = (await sql`select count(*)::int n from receipt_template_version v join receipt_template t on t.id = v.template_id where t.company_id = ${st.companyId}`)[0].n;
  const a = (await sql`select count(*)::int n from receipt_template_audit where company_id = ${st.companyId}`)[0].n;
  const c = (await sql`select address, phone, md5(coalesce(logo, ''::bytea)) as l, logo_mime from company where id = ${st.companyId}`)[0];
  const docs = (await sql`select count(*)::int n from document where company_id = ${st.companyId}`)[0].n;
  return JSON.stringify({ t, v, a, c, docs });
}

async function api() {
  const st = load();
  const U = st.users;
  const b2 = st.branches.b2.id, yg = st.branches.yg.id;
  const tpl = async (name) => (await sql`select id from receipt_template where company_id = ${st.companyId} and name = ${name}`)[0]?.id;

  section("Signed-in pages (real sessions)");
  const page = async (who, path) => {
    const r = await fetch(BASE + path, { headers: cookie(st.tokens[who]), redirect: "manual" });
    return { status: r.status, loc: r.headers.get("location"), html: r.status === 200 ? await r.text() : "" };
  };
  const shows = (p) => p.status === 200 && /Receipt Templates/.test(p.html) && /rt-layout/.test(p.html);
  const anon = await page(null, "/settings/receipt-templates");
  check("not signed in: the settings page is not served", !shows(anon), `status ${anon.status} → ${anon.loc ?? ""}`);
  const pa = await page("admin", "/settings/receipt-templates");
  const pm = await page("mgr2", "/settings/receipt-templates");
  const pc = await page("cashier", "/settings/receipt-templates");
  check("administrator opens Receipt Templates", shows(pa), `status ${pa.status}`);
  check("branch manager opens Receipt Templates", shows(pm), `status ${pm.status}`);
  check("cashier cannot open Receipt Templates", !shows(pc), `status ${pc.status} → ${pc.loc ?? ""}`);
  const pcs = await page("cashier", "/settings");
  check("cashier cannot open Settings either", !(pcs.status === 200 && /Company details/i.test(pcs.html)), `status ${pcs.status}`);

  section("Administrator (direct action calls)");
  const adm = async (name, args) => act(st, "admin", name, args);
  const created = await adm("createReceiptTemplate", [{ name: `RT ${st.stamp} Company`, paper: "80", branchId: null }]);
  check("admin creates a company template", created.ok, created.error ?? created.status);
  const coId = await tpl(`RT ${st.stamp} Company`);
  const created2 = await adm("createReceiptTemplate", [{ name: `RT ${st.stamp} Branch2`, paper: "58", branchId: b2 }]);
  check("admin creates a Branch 2 template", created2.ok, created2.error ?? created2.status);
  const b2Id = await tpl(`RT ${st.stamp} Branch2`);
  const createdY = await adm("createReceiptTemplate", [{ name: `RT ${st.stamp} Yangon`, paper: "A4", branchId: yg }]);
  const ygId = await tpl(`RT ${st.stamp} Yangon`);
  check("admin creates a Yangon template", createdY.ok && Boolean(ygId), createdY.error ?? "");
  const cfg = (foot) => ({ custom: { footerText: foot, thankYou: "Thanks" } });
  for (const [id, foot] of [[coId, "CO-LIVE"], [b2Id, "B2-LIVE"], [ygId, "YG-LIVE"]]) {
    const s = await adm("saveReceiptDraft", [{ id, name: (await sql`select name from receipt_template where id = ${id}`)[0].name,
      paper: (await sql`select paper from receipt_template where id = ${id}`)[0].paper, config: cfg(foot) }]);
    const p = await adm("publishReceiptTemplate", [{ id }]);
    const d = await adm("setDefaultReceiptTemplate", [{ id }]);
    check(`admin saves, publishes and defaults ${foot}`, s.ok && p.ok && d.ok, `${s.error ?? ""} ${p.error ?? ""} ${d.error ?? ""}`);
  }
  const co = await adm("saveCompanyContact", [{ address: "RT Live Company Address", phone: "01 000 111" }]);
  check("admin saves the company's address and phone", co.ok, co.error ?? "");
  // Branch 2's own contact lives on the branch record.
  await sql`update location set address = 'RT Live Branch 2 Address', phone = '02 222 333' where id = ${b2}`;

  section("Branch manager (Branch 2) — direct action calls");
  const refusedCase = async (who, label, name, args, expect) => {
    const before = await dbState(st);
    const r = await act(st, who, name, args);
    const after = await dbState(st);
    const unchanged = before === after;
    const refused = !r.ok && (expect ? expect.test(r.error ?? r.text) : true);
    check(`${label}: refused and nothing changed`, refused && unchanged,
      `${r.status} ${r.error ?? r.text.slice(0, 100)}${unchanged ? "" : " — DATABASE CHANGED"}`);
  };
  const allowed = async (who, label, name, args) => {
    const r = await act(st, who, name, args);
    check(label, r.ok, r.error ?? r.status);
    return r;
  };
  await allowed("mgr2", "manager creates a Branch 2 template", "createReceiptTemplate", [{ name: `RT ${st.stamp} B2 mgr`, paper: "80", branchId: b2 }]);
  const mgrTpl = await tpl(`RT ${st.stamp} B2 mgr`);
  await allowed("mgr2", "manager saves and publishes their Branch 2 template", "saveReceiptDraft",
    [{ id: mgrTpl, name: `RT ${st.stamp} B2 mgr`, paper: "80", config: cfg("MGR-B2") }]);
  await allowed("mgr2", "manager publishes it", "publishReceiptTemplate", [{ id: mgrTpl }]);
  await refusedCase("mgr2", "manager creates a company-wide template", "createReceiptTemplate", [{ name: `RT ${st.stamp} sneaky`, paper: "80", branchId: null }], /administrator|own branch/i);
  await refusedCase("mgr2", "manager creates a Yangon template", "createReceiptTemplate", [{ name: `RT ${st.stamp} sneaky2`, paper: "80", branchId: yg }], /own branch/i);
  await refusedCase("mgr2", "manager edits the company template", "saveReceiptDraft", [{ id: coId, name: `RT ${st.stamp} Company`, paper: "80", config: cfg("HACKED") }], /own branch/i);
  await refusedCase("mgr2", "manager publishes the company template", "publishReceiptTemplate", [{ id: coId }], /own branch/i);
  await refusedCase("mgr2", "manager makes the company template default", "setDefaultReceiptTemplate", [{ id: coId }], /own branch/i);
  await refusedCase("mgr2", "manager turns the company template off", "setReceiptTemplateActive", [{ id: coId, active: false }], /own branch/i);
  await refusedCase("mgr2", "manager edits Yangon's template", "saveReceiptDraft", [{ id: ygId, name: `RT ${st.stamp} Yangon`, paper: "A4", config: cfg("HACKED") }], /own branch/i);
  await refusedCase("mgr2", "manager publishes Yangon's template", "publishReceiptTemplate", [{ id: ygId }], /own branch/i);
  await refusedCase("mgr2", "manager changes the company's address (admin only)", "saveCompanyContact", [{ address: "HACKED", phone: "0" }]);
  await refusedCase("mgr2", "manager removes the logo (admin only)", "removeCompanyLogo", []);
  await refusedCase("mgr2", "manager forges a branch id in a create call", "createReceiptTemplate", [{ name: `RT ${st.stamp} forged`, paper: "80", branchId: "00000000-0000-0000-0000-000000000000" }]);
  const pvM = await act(st, "mgr2", "previewSaleData", [st.sales.b2.id]);
  check("manager can preview a Branch 2 sale", pvM.status === 200 && pvM.text.includes(st.sales.b2.docNo), pvM.status);
  const pvMY = await act(st, "mgr2", "previewSaleData", [st.sales.yg.id]);
  check("manager cannot preview a Yangon sale", !pvMY.text.includes(st.sales.yg.docNo), pvMY.status);

  section("Branch manager (Yangon) cannot touch Branch 2");
  await refusedCase("mgrY", "Yangon manager edits Branch 2's template", "saveReceiptDraft", [{ id: b2Id, name: `RT ${st.stamp} Branch2`, paper: "58", config: cfg("HACKED") }], /own branch/i);
  await refusedCase("mgrY", "Yangon manager deactivates Branch 2's template", "setReceiptTemplateActive", [{ id: b2Id, active: false }], /own branch/i);

  section("Cashier — direct action calls (own branch, and the pages)");
  await refusedCase("cashier", "cashier creates a template in their own branch", "createReceiptTemplate", [{ name: `RT ${st.stamp} cashier`, paper: "80", branchId: b2 }], /cannot do this|receipts\.manage|Ask a manager/i);
  await refusedCase("cashier", "cashier edits their branch's template", "saveReceiptDraft", [{ id: b2Id, name: `RT ${st.stamp} Branch2`, paper: "58", config: cfg("HACKED") }], /cannot do this|receipts\.manage|Ask a manager/i);
  await refusedCase("cashier", "cashier publishes a template", "publishReceiptTemplate", [{ id: b2Id }], /cannot do this|receipts\.manage|Ask a manager/i);
  await refusedCase("cashier", "cashier changes the default", "setDefaultReceiptTemplate", [{ id: b2Id }], /cannot do this|receipts\.manage|Ask a manager/i);
  await refusedCase("cashier", "cashier turns a template off", "setReceiptTemplateActive", [{ id: b2Id, active: false }], /cannot do this|receipts\.manage|Ask a manager/i);
  await refusedCase("cashier", "cashier changes company details", "saveCompanyContact", [{ address: "HACKED", phone: "0" }]);
  await refusedCase("cashier", "cashier removes the logo", "removeCompanyLogo", []);
  const up0 = await dbState(st);
  const upC = await upload(st, "cashier", png());
  check("cashier cannot upload a logo", !upC.ok && (await dbState(st)) === up0, `${upC.status} ${upC.error ?? upC.text.slice(0, 80)}`);
  const pvC = await act(st, "cashier", "previewSaleData", [st.sales.b2.id]);
  check("cashier gets no preview data from the template tool", !pvC.text.includes(st.sales.b2.docNo), pvC.status);
  // The same calls sent to a page the cashier can open, in case the page path did the refusing.
  await refusedCase("cashier", "same edit sent via the till's own URL", "saveReceiptDraft", [{ id: b2Id, name: `RT ${st.stamp} Branch2`, paper: "58", config: cfg("HACKED") }]);

  section("Not signed in — direct action calls");
  const before = await dbState(st);
  for (const [n, a] of [["createReceiptTemplate", [{ name: "anon", paper: "80", branchId: null }]], ["publishReceiptTemplate", [{ id: coId }]],
    ["saveCompanyContact", [{ address: "HACKED", phone: "0" }]], ["removeCompanyLogo", []]]) {
    const r = await act(st, "nobody", n, a);
    check(`anonymous ${n} is refused`, !r.ok, `${r.status} ${r.error ?? ""}`);
  }
  const anonUp = await upload(st, "nobody", png());
  check("anonymous logo upload is refused", !anonUp.ok, anonUp.status);
  check("nothing changed after the anonymous calls", before === (await dbState(st)));

  section("Another company's administrator");
  const sees = await page("otherAdmin", "/settings/receipt-templates");
  check("other company's admin sees none of this company's templates", sees.status !== 200 || (!sees.html.includes(`RT ${st.stamp} Company`) && !sees.html.includes("B2-LIVE")), `status ${sees.status}`);
  await refusedCase("otherAdmin", "other company edits this company's template", "saveReceiptDraft", [{ id: coId, name: "x", paper: "80", config: cfg("HACKED") }], /not found/i);
  await refusedCase("otherAdmin", "other company publishes this company's template", "publishReceiptTemplate", [{ id: coId }], /not found/i);
  await refusedCase("otherAdmin", "other company makes this company's template default", "setDefaultReceiptTemplate", [{ id: coId }], /not found/i);
  const pvO = await act(st, "otherAdmin", "previewSaleData", [st.sales.b2.id]);
  check("other company's admin cannot preview this company's sale", !pvO.text.includes(st.sales.b2.docNo), pvO.status);
  const rcO = await page("otherAdmin", `/pos/receipt/${st.sales.b2.id}`);
  check("other company's admin cannot open this company's receipt", !rcO.html.includes(st.sales.b2.docNo), `status ${rcO.status}`);

  section("Receipts: who can open which sale");
  const rc = (who, key) => page(who, `/pos/receipt/${st.sales[key].id}`);
  const r1 = await rc("cashier", "b2"), r2 = await rc("cashier", "yg"), r3 = await rc("cashierY", "b2"), r4 = await rc(null, "b2");
  check("cashier opens their own branch's receipt", r1.status === 200 && r1.html.includes(st.sales.b2.docNo), r1.status);
  check("cashier cannot open another branch's receipt", !r2.html.includes(st.sales.yg.docNo), r2.status);
  check("Yangon cashier cannot open Branch 2's receipt", !r3.html.includes(st.sales.b2.docNo), r3.status);
  check("not signed in: no receipt", !r4.html.includes(st.sales.b2.docNo), r4.status);
  check("Branch 2's receipt uses Branch 2's published template", /rc-58/.test(r1.html) && r1.html.includes("B2-LIVE"));
  check("Branch 2's receipt shows Branch 2's address and phone", r1.html.includes("RT Live Branch 2 Address") && r1.html.includes("02 222 333"));
  const adminRc = await rc("admin", "yg");
  check("Yangon's receipt uses Yangon's A4 template", /rc-a4/.test(adminRc.html) && adminRc.html.includes("YG-LIVE"));

  section("Company logo");
  const logoGet = (who) => fetch(BASE + "/api/company-logo", { headers: cookie(st.tokens[who]), redirect: "manual" });
  const startLogo = await logoGet("admin");
  check("no logo yet: the logo route says so (404)", startLogo.status === 404, startLogo.status);
  const bigPng = Buffer.concat([png(), Buffer.alloc(300_001 - png().length + 1)]);
  const big = await upload(st, "admin", bigPng);
  check("a file over 300 KB is refused", !big.ok && /300 KB/.test(big.error ?? ""), big.error ?? big.status);
  const exact = Buffer.concat([png(), Buffer.alloc(300_000 - png().length)]);
  check("(boundary) exactly 300,000 bytes is allowed", exact.length === 300_000 && (await upload(st, "admin", exact)).ok);
  await act(st, "admin", "removeCompanyLogo", []);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>');
  const refusals = [
    ["SVG named .svg", svg, "logo.svg", "image/svg+xml"], ["SVG renamed .png with an image/png type", svg, "logo.png", "image/png"],
    ["HTML renamed .png", Buffer.from("<html><script>alert(1)</script></html>"), "logo.png", "image/png"],
    ["GIF", Buffer.from("GIF89a\x01\0\x01\0\0\0\0;"), "logo.gif", "image/gif"], ["WebP header", Buffer.from("RIFF\0\0\0\0WEBPVP8 "), "logo.webp", "image/webp"],
    ["PDF", Buffer.from("%PDF-1.4\n"), "logo.pdf", "application/pdf"], ["an empty file", Buffer.alloc(0), "logo.png", "image/png"],
    ["plain text", Buffer.from("hello"), "logo.png", "image/png"],
  ];
  for (const [label, buf, name, type] of refusals) {
    const b4 = await dbState(st);
    const r = await upload(st, "admin", buf, name, type);
    check(`${label} is refused and nothing is stored`, !r.ok && (await dbState(st)) === b4 && (await logoGet("admin")).status === 404, r.error ?? r.status);
  }
  const good1 = png();
  const up = await upload(st, "admin", good1);
  check("a valid PNG is accepted", up.ok, up.error ?? up.status);
  const got = await logoGet("admin");
  const bytes = Buffer.from(await got.arrayBuffer());
  check("served as image/png with the same bytes", got.status === 200 && got.headers.get("content-type") === "image/png" && sha(bytes) === sha(good1), `${got.status} ${got.headers.get("content-type")}`);
  check("served with nosniff and inline disposition", got.headers.get("x-content-type-options") === "nosniff" && /inline/.test(got.headers.get("content-disposition") ?? ""));
  const again = await logoGet("cashier");
  check("persists across requests and is available to the cashier's receipts", again.status === 200 && sha(Buffer.from(await again.arrayBuffer())) === sha(good1));
  const otherLogo = await logoGet("otherAdmin");
  check("another company does not get this company's logo", otherLogo.status === 404, otherLogo.status);
  const anonLogo = await logoGet(null);
  check("not signed in: no logo", anonLogo.status !== 200, anonLogo.status);
  await upload(st, "otherAdmin", jpeg(), "theirs.jpg", "image/jpeg");
  const mine = await logoGet("admin"), theirs = await logoGet("otherAdmin");
  check("another company's upload replaces only its own logo",
    sha(Buffer.from(await mine.arrayBuffer())) === sha(good1) && theirs.headers.get("content-type") === "image/jpeg");
  const j = await upload(st, "admin", jpeg(), "logo.jpg", "image/jpeg");
  const gotJ = await logoGet("admin");
  check("a valid JPEG is accepted and served as image/jpeg", j.ok && gotJ.headers.get("content-type") === "image/jpeg");
  await upload(st, "admin", good1);
  const printedBefore = await rc("admin", "b2");
  check("a receipt printed before the logo existed stays as printed (no logo appears on a reprint)", !/class="rc-logo"/.test(printedBefore.html));
  const firstOpen = await page("admin", `/pos/receipt/${st.sales.b2u.id}`);
  check("a sale first printed after the upload draws the logo from the signed-in route",
    /<img class="rc-logo"[^>]*src="\/api\/company-logo"/.test(firstOpen.html) || /<img[^>]*class="rc-logo"[^>]*src="\/api\/company-logo"/.test(firstOpen.html), "");
  const pol = Buffer.concat([png(), Buffer.from('<svg onload="alert(1)"></svg>')]);
  const polR = await upload(st, "admin", pol);
  const polG = await logoGet("admin");
  check("an image with markup appended is still served only as an image, never inline markup",
    polR.ok ? polG.headers.get("content-type") === "image/png" && polG.headers.get("x-content-type-options") === "nosniff" : true, polR.error ?? "");
  await upload(st, "admin", good1);
  await act(st, "admin", "removeCompanyLogo", []);
  const afterRemoval = await page("admin", `/pos/receipt/${st.sales.b2u.id}`);
  check("after the logo is removed, a receipt printed with it reprints without a broken image", !/class="rc-logo"/.test(afterRemoval.html));
  const gone = await logoGet("admin");
  check("and the logo route returns 404 again", gone.status === 404, gone.status);

  const sw = await sql`select count(*)::int n from document where company_id = ${st.companyId}`;
  check("no document was posted by any of these calls beyond the setup's own", sw[0].n >= 2);
  console.log(`\n  ${good} passed, ${bad} failed\n`);
}

// ---------------------------------------------------------------- cleanup --

async function cleanup() {
  const st = load();
  await sql`update user_session set expires_at = now() where user_id in (select id from app_user where email like ${"rt-" + st.stamp + "-%"})`;
  await sql`update app_user set is_active = false where email like ${"rt-" + st.stamp + "-%"}`;
  await sql`delete from user_session where user_id in (select id from app_user where email like ${"rt-" + st.stamp + "-%"})`;
  await sql.begin(async (tx) => {
    const mine = (await tx`select id from receipt_template where name like ${"RT " + st.stamp + "%"}`).map((r) => r.id);
    if (mine.length) {
      await tx`delete from sale_receipt where template_id = any(${mine})`.catch(() => {});
    }
  }).catch(() => {});
  await sql`truncate sale_receipt`;
  const mine = (await sql`select id from receipt_template where name like ${"RT " + st.stamp + "%"}`).map((r) => r.id);
  if (mine.length) {
    await sql.begin(async (tx) => {
      await tx`alter table receipt_template_version disable trigger trg_receipt_template_version_immutable`;
      await tx`delete from receipt_template_audit where template_id = any(${mine})`;
      await tx`delete from receipt_template_version where template_id = any(${mine})`;
      await tx`delete from receipt_template where id = any(${mine})`;
      await tx`alter table receipt_template_version enable trigger trg_receipt_template_version_immutable`;
    });
  }
  await sql`update company set address = ${st.orig.address}, phone = ${st.orig.phone}, logo = null, logo_mime = null where id = ${st.companyId}`;
  await sql`update location set address = null, phone = null where id = ${st.branches.b2.id}`;
  if (st.otherCompanyId) {
    await sql`delete from user_session where user_id in (select id from app_user where company_id = ${st.otherCompanyId})`;
    await sql`delete from receipt_template where company_id = ${st.otherCompanyId}`;
    await sql`delete from app_user where company_id = ${st.otherCompanyId}`.catch(async () =>
      sql`update app_user set is_active = false where company_id = ${st.otherCompanyId}`);
    await sql`delete from company where id = ${st.otherCompanyId}`.catch(() => {});
  }
  const left = await sql`select count(*)::int n from app_user where email like ${"rt-" + st.stamp + "-%"} and is_active`;
  console.log(`  cleaned up. active test people left: ${left[0].n}`);
}

try {
  if (mode === "setup") await setup();
  else if (mode === "api") await api();
  else if (mode === "cleanup") await cleanup();
  else throw new Error("usage: setup | api | cleanup");
} catch (e) { bad++; console.log(`  FAIL  ${e.stack ?? e.message}`); }
finally { await releaseTestLock(sql).catch(() => {}); await sql.end(); process.exit(bad ? 1 : 0); }

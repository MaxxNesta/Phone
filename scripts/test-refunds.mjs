// Paying money back to a customer for a return (migration 0142).
//
//   ALLOW_DESTRUCTIVE_TESTS=1 ./node_modules/.bin/tsx scripts/test-refunds.mjs
//
// What this proves:
//   - a return against a paid invoice, refunded to KBZPay: Dr Receivable /
//     Cr the wallet, the invoice back to zero, revenue reversed once
//   - a return against an unpaid invoice leaves nothing to refund
//   - a part-paid invoice refunds only what was paid above the new total
//   - a return on account refunds out of Customer Advances
//   - the review's dry run leaves nothing behind and matches the real posting
//   - voiding a refund reopens it; a refunded return cannot be voided first
//   - a refund reference cannot be recorded twice; refunds net the payments chart

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

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
  prepare: !url.includes("-pooler."), onnotice: () => {}, max: 1 });

await takeTestLock(sql, "test-refunds.mjs");
const P = await import("../lib/posting.ts");
const Q = await import("../lib/queries.ts");
const { postTillSale } = await import("../lib/pos-sale.ts");
const { postReturnWithRefund, refundReturn, dryRun } = await import("../lib/refund.ts");

let bad = 0;
const check = (label, ok, detail = "") => {
  if (!ok) bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};
const section = (s) => console.log(`\n  ${s}\n`);
const n = (v) => Number(v ?? 0);
const near = (a, b) => Math.abs(n(a) - n(b)) < 0.01;
const tr = (k, v) => `${k}${v ? " " + JSON.stringify(v) : ""}`;
const refused = async (f) => { try { await f(); return null; } catch (e) { return String(e.message ?? e); } };

const cleanMasters = async (co) => {
  await sql`delete from item where company_id = ${co} and code like '96%'`;
  await sql`delete from item_group where company_id = ${co} and segment = '96'`;
  await sql`delete from business_partner where company_id = ${co} and code in ('RF-SUP', 'RF-CUST')`;
};

let coId = null;
try {
  const [co] = await sql`select id, name from company order by created_at limit 1`;
  coId = co.id;
  if (!/—\s*DEV\b|\bDEV\b/i.test(String(co.name)) || process.env.ALLOW_DESTRUCTIVE_TESTS !== "1") {
    throw new Error(`This suite empties the transaction tables. "${co.name}" must be a DEV database and ALLOW_DESTRUCTIVE_TESTS=1 set.`);
  }
  console.log(`\n  ${co.name}`);

  await resetTransactions(sql);
  await sql`update number_series set next_value = 1`;
  await cleanMasters(co.id);
  const [grp] = await sql`insert into item_group (company_id, segment, code, name) values (${co.id}, '96', 'x', 'Refund test') returning id`;
  const [uom] = await sql`select id from uom where company_id = ${co.id} limit 1`;
  const [item] = await sql`insert into item (company_id, item_group_id, serial, code, name, base_uom_id)
     values (${co.id}, ${grp.id}, '001', 'x', 'Refund test item', ${uom.id}) returning id`;
  const [supp] = await sql`insert into business_partner (company_id, code, name, is_supplier) values (${co.id}, 'RF-SUP', 'Refund supplier', true) returning id`;
  const [cust] = await sql`insert into business_partner (company_id, code, name, is_customer, payment_terms_days) values (${co.id}, 'RF-CUST', 'Refund customer', true, 30) returning id`;
  const [loc] = await sql`select id from location where company_id = ${co.id} and is_stock_location and is_active order by code limit 1`;
  const today = new Date().toISOString().slice(0, 10);
  await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
    lines: [{ itemId: item.id, qty: 50, unitCost: 1000 }] });

  const channel = async (code) => (await sql`select id from payment_channel where company_id = ${co.id} and code = ${code}`)[0].id;
  const CASH = await channel("CASH"), KBZ = await channel("KBZPAY");
  let [wallet] = await sql`select id from account where company_id = ${co.id} and lower(name) = 'kbzpay' and is_cash_account`;
  if (!wallet) {
    [wallet] = await sql`insert into account (company_id, parent_id, code, name, account_type, is_cash_account, is_bank_account)
      select ${co.id}, parent_id, '1019', 'KBZPay', 'ASSET', true, true from account where company_id = ${co.id} and code = '1010' returning id`;
  }
  await sql`delete from payment_channel_account where channel_id = ${KBZ}`;
  await sql`insert into payment_channel_account (company_id, channel_id, account_id) values (${co.id}, ${KBZ}, ${wallet.id})`;
  const cashAcct = (await sql`select fn_payment_channel_account(${CASH}, ${loc.id}) as a`)[0].a;
  const arAcct = (await sql`select fn_resolve_control_account(${co.id}, 'AR_CONTROL', ${cust.id}) as a`)[0].a;
  const advAcct = (await sql`select fn_system_account(${co.id}, 'CUSTOMER_ADVANCE') as a`)[0].a;

  const bal = async (a, partner = null) => n((await sql`select coalesce(sum(base_amount), 0) as v from journal_line
     where account_id = ${a} ${partner ? sql`and partner_id = ${partner}` : sql``}`)[0].v);
  const revenue = async () => -n((await sql`select coalesce(sum(jl.base_amount), 0) as v from journal_line jl
     join account a on a.id = jl.account_id where jl.company_id = ${co.id} and a.account_type = 'REVENUE'`)[0].v);
  const open = async (id) => n((await sql`select outstanding from v_open_item where document_id = ${id}`)[0]?.outstanding);
  const sale = (price, payments) => postTillSale({
    companyId: co.id, userId: null, locationId: loc.id, partnerId: cust.id, salesmanId: null,
    priceIncludesTax: true, memo: null, attempt: Math.random().toString(36).slice(2),
    lines: [{ itemId: item.id, qty: 1, unitPrice: price, discountPct: 0, taxCodeId: null }], payments }, tr);
  const ret = (price, source, refund = null) => sql.begin((tx) => postReturnWithRefund(tx, {
    companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, sourceDocumentId: source,
    priceIncludesTax: true, lines: [{ itemId: item.id, qty: 1, unitPrice: price }] }, null, refund, tr));
  const docs = async () => n((await sql`select count(*) as c from document where company_id = ${co.id}`)[0].c);

  // ---- paid invoice, refunded to KBZPay -------------------------------------
  section("a paid sale returned and refunded to KBZPay");
  const paid = await sale(500_000, [{ channelId: CASH, amount: 500_000 }]);
  let w0 = await bal(wallet.id), ar0 = await bal(arAcct), r0 = await revenue();
  const d0 = await docs();
  const pv = await dryRun(co.id, cust.id, async (tx) => {
    const r = await postReturnWithRefund(tx, { companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today,
      sourceDocumentId: paid.id, priceIncludesTax: true, lines: [{ itemId: item.id, qty: 1, unitPrice: 500_000 }] },
      null, { channelId: KBZ, amount: 500_000, reference: "KBZ-R1" }, tr);
    return { docIds: [r.id, r.refund.id], returnId: r.id };
  });
  check("the review leaves nothing behind", (await docs()) === d0 && near(await bal(wallet.id), w0));
  check("  it shows the refund: KBZPay → customer, 500,000", pv.refund?.channel === "KBZPay" && near(pv.refund.amount, 500_000));
  const pvWallet = pv.cash.find((c) => c.name === "KBZPay");
  check("  and the wallet balance before → after", pvWallet && near(pvWallet.after - pvWallet.before, -500_000));
  check("  the customer settled → settled", near(pv.customer.before, 0) && near(pv.customer.after, 0),
    `${pv.customer.before} → ${pv.customer.after}`);
  check("  two balanced ledger entries", pv.entries.length === 2 && pv.entries.every((e) =>
    near(e.lines.reduce((s, l) => s + l.debit, 0), e.lines.reduce((s, l) => s + l.credit, 0))));

  const r1 = await ret(500_000, paid.id, { channelId: KBZ, amount: 500_000, reference: "KBZ-R1" });
  check("posted: return and refund", Boolean(r1.refund?.docNo?.startsWith("RF")), r1.refund?.docNo);
  check("  KBZPay down 500,000", near(await bal(wallet.id) - w0, -500_000));
  check("  receivable back where it was", near(await bal(arAcct), ar0));
  check("  the invoice owes nothing either way", near(await open(paid.id), 0));
  check("  revenue reversed once (500,000)", near(await revenue() - r0, -500_000), `${await revenue() - r0}`);
  const [rf] = await sql`select payment_channel_id, payment_reference from document where id = ${r1.refund.id}`;
  check("  the refund keeps channel and transaction ID", rf.payment_channel_id === KBZ && rf.payment_reference === "KBZ-R1");
  check("  and matches what the review said", near(await bal(wallet.id), pvWallet.after));

  // ---- nothing to refund ------------------------------------------------------
  section("unpaid and part-paid invoices");
  const unpaid = await sale(500_000, []);
  const r2 = await ret(200_000, unpaid.id);
  check("a return on an unpaid invoice only reduces the debt", near(await open(unpaid.id), 300_000));
  let e = await refused(() => sql.begin((tx) => refundReturn(tx, co.id, null, r2.id, today, { channelId: CASH, amount: 1000, reference: null }, tr)));
  check("  and leaves nothing to refund", /nothing to pay back/.test(e ?? ""), e ?? "refunded");

  const part = await sale(500_000, [{ channelId: CASH, amount: 300_000 }]);
  const r3 = await ret(500_000, part.id);
  check("paid 300,000 of 500,000, all returned → 300,000 owed back", near(await open(part.id), -300_000));
  e = await refused(() => sql.begin((tx) => refundReturn(tx, co.id, null, r3.id, today, { channelId: CASH, amount: 400_000, reference: null }, tr)));
  check("  refunding 400,000 is refused", /up to 300000/.test(e ?? ""), e ?? "refunded");
  let c0 = await bal(cashAcct);
  const f3 = await sql.begin((tx) => refundReturn(tx, co.id, null, r3.id, today, { channelId: CASH, amount: 300_000, reference: null }, tr));
  check("  refunding 300,000 in cash clears it", near(await open(part.id), 0) && near(await bal(cashAcct) - c0, -300_000));

  // ---- on account ---------------------------------------------------------------
  section("a return on account");
  const adv0 = await bal(advAcct, cust.id);
  const r4 = await ret(150_000, null);
  check("the credit sits on Customer Advances", near(await bal(advAcct, cust.id) - adv0, -150_000));
  c0 = await bal(cashAcct);
  await sql.begin((tx) => refundReturn(tx, co.id, null, r4.id, today, { channelId: CASH, amount: 150_000, reference: null }, tr));
  check("  refunding it pays out of the advance", near(await bal(advAcct, cust.id), adv0) && near(await bal(cashAcct) - c0, -150_000));
  const listed = await Q.getRefundableReturns(co.id);
  check("  nothing left to refund on it", near(listed.find((x) => x.id === r4.id)?.refundable, 0));

  // ---- voids -------------------------------------------------------------------
  section("voids");
  e = await refused(() => P.voidDocument({ documentId: r3.id, reason: "test", goodsBack: true }));
  check("a refunded return cannot be voided before its refund", /Void that first/.test(e ?? ""), e ?? "voided");
  await P.voidDocument({ documentId: f3.id, reason: "test" });
  check("voiding the refund: the invoice is owed 300,000 again", near(await open(part.id), -300_000));
  check("  and the return can be refunded again", near((await Q.getRefundableReturns(co.id)).find((x) => x.id === r3.id)?.refundable, 300_000));

  // ---- references and the chart -------------------------------------------------
  section("references and reporting");
  const again = await sale(100_000, [{ channelId: CASH, amount: 100_000 }]);
  e = await refused(() => ret(100_000, again.id, { channelId: KBZ, amount: 100_000, reference: "kbz-r1" }));
  check("a refund reference already recorded is refused", /already been recorded/.test(e ?? ""), e ?? "posted");
  await sale(800_000, [{ channelId: KBZ, amount: 800_000, reference: "KBZ-S1" }]);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const kbz = (await Q.getReceiptsByAccount(co.id, today, tomorrow)).find((x) => x.name === "KBZPay");
  check("the KBZPay slice is sales less refunds (800,000 − 500,000)", near(kbz?.revenue, 300_000), `${kbz?.revenue}`);
  const cf = await Q.getCashFlowStatement(co.id, today, today);
  const fromCustomers = cf.rows.filter((x) => x.category === "Received from customers").reduce((s, x) => s + n(x.amount), 0);
  check("cash flow: refunds count against money from customers", near(fromCustomers, 500_000 + 300_000 + 100_000 + 800_000 - 500_000 - 150_000),
    `${fromCustomers}`);
} catch (err) {
  bad++;
  console.error("\n  ERROR", err);
} finally {
  await resetTransactions(sql).catch(() => {});
  if (coId) await cleanMasters(coId).catch(() => {});
  await releaseTestLock(sql);
  await sql.end();
  const { sql: appSql } = await import("../lib/db.ts");
  await appSql.end({ timeout: 1 }).catch(() => {});
  console.log(bad ? `\n  ${bad} FAILED\n` : "\n  all passed\n");
  process.exit(bad ? 1 : 0);
}

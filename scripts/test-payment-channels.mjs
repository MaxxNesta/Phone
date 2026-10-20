// Payment channels (migration 0141): cash, bank, card and the Myanmar wallets.
//
//   ALLOW_DESTRUCTIVE_TESTS=1 ./node_modules/.bin/tsx scripts/test-payment-channels.mjs
//
// A channel is resolved to its cash or bank account before posting; the
// engine never names a provider. What this proves:
//   - the tender rules (reference, unmapped, overpay, split change) as pure functions
//   - cash, wallet and split sales post revenue once, and the money lands in
//     each channel's own account, labelled with the channel and reference
//   - a wallet reference cannot be recorded twice; a retry posts once
//   - a credit sale part-paid by wallet, then settled by a receipt: Dr wallet,
//     Cr receivable, revenue untouched
//   - voiding a split sale reverses every tender and frees its reference
//   - wallet → bank transfer: no revenue, cash flow sections unchanged
//   - a branch can pay into its own account; mappings refuse non-cash accounts

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

await takeTestLock(sql, "test-payment-channels.mjs");
const P = await import("../lib/posting.ts");
const Q = await import("../lib/queries.ts");
const C = await import("../lib/payment-channels.ts");
const { postTillSale } = await import("../lib/pos-sale.ts");
const { splitTender } = await import("../lib/pos-cash.ts");

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

try {
  const [co] = await sql`select id, name from company order by created_at limit 1`;
  const disposable = /—\s*DEV\b|\bDEV\b/i.test(String(co.name));
  if (!disposable || process.env.ALLOW_DESTRUCTIVE_TESTS !== "1") {
    throw new Error(`This suite empties the transaction tables. "${co.name}" must be a DEV database and ALLOW_DESTRUCTIVE_TESTS=1 set.`);
  }
  console.log(`\n  ${co.name}`);

  // ---- pure rules ---------------------------------------------------------
  section("tender rules");
  const ch = (o) => ({ id: o.id ?? "c", code: "X", name: o.name ?? "KBZPay", kind: o.kind ?? "WALLET",
    requiresReference: o.req ?? true, merchantName: null, merchantNumber: null,
    accountId: "accountId" in o ? o.accountId : "a", accountName: "A" });
  check("a wallet without its transaction ID is refused",
    C.checkTenders([{ channel: ch({}), amount: 100, reference: null }], 100)?.key === "referenceRequired");
  check("a channel with no account here is refused",
    C.checkTenders([{ channel: ch({ accountId: null }), amount: 100, reference: "R" }], 100)?.key === "channelUnmapped");
  check("the same reference twice in one sale is refused",
    C.checkTenders([{ channel: ch({}), amount: 50, reference: "R1" }, { channel: ch({}), amount: 50, reference: "r1" }], 100)?.key === "referenceTwice");
  check("tenders past the total are refused",
    C.checkTenders([{ channel: ch({ kind: "CASH", req: false }), amount: 101, reference: null }], 100)?.key === "overpaid");
  check("an exact split passes",
    C.checkTenders([{ channel: ch({ kind: "CASH", req: false, id: "k" }), amount: 1_000_000, reference: null },
                    { channel: ch({}), amount: 1_850_000, reference: "T" }], 2_850_000) === null);

  let s = splitTender(2_850_000, [{ cash: true, amount: "1000000" }, { cash: false, amount: "1850000" }]);
  check("split 1,000,000 cash + 1,850,000 KBZPay of 2,850,000 → remaining 0, no change",
    s.remainingCents === 0 && s.changeCents === 0 && s.overCents === 0);
  s = splitTender(2_850_000, [{ cash: true, amount: "1200000" }, { cash: false, amount: "1850000" }]);
  check("cash handed over past what is due is change: posts 1,000,000, change 200,000",
    s.postedCents[0] === 100_000_000 && s.changeCents === 20_000_000);
  s = splitTender(2_850_000, [{ cash: true, amount: "500000" }, { cash: false, amount: "3000000" }]);
  check("a wallet past the total is an overpayment, not change", s.overCents === 15_000_000 && s.changeCents === 50_000_000);

  // ---- set up -------------------------------------------------------------
  await resetTransactions(sql);
  await sql`update number_series set next_value = 1`;
  const [loc] = await sql`select id from location where company_id = ${co.id} and is_stock_location and is_active order by code limit 1`;
  const branchId = (await sql`select fn_location_branch(${loc.id}) as b`)[0].b;
  // Its own item and partners, removed at the end: master data is not this suite's to keep.
  const cleanMasters = async () => {
    await sql`delete from item where company_id = ${co.id} and code like '98%'`;
    await sql`delete from item_group where company_id = ${co.id} and segment = '98'`;
    await sql`delete from business_partner where company_id = ${co.id} and code in ('PC-SUP', 'PC-CUST')`;
  };
  await cleanMasters();
  const [grp] = await sql`insert into item_group (company_id, segment, code, name) values (${co.id}, '98', 'x', 'Payment test') returning id`;
  const [uom] = await sql`select id from uom where company_id = ${co.id} limit 1`;
  const [item] = await sql`insert into item (company_id, item_group_id, serial, code, name, base_uom_id)
     values (${co.id}, ${grp.id}, '001', 'x', 'Payment test item', ${uom.id}) returning id`;
  const [supp] = await sql`insert into business_partner (company_id, code, name, is_supplier) values (${co.id}, 'PC-SUP', 'Payment test supplier', true) returning id`;
  const [cust] = await sql`insert into business_partner (company_id, code, name, is_customer, payment_terms_days) values (${co.id}, 'PC-CUST', 'Payment test customer', true, 30) returning id`;
  const today = new Date().toISOString().slice(0, 10);
  await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
    lines: [{ itemId: item.id, qty: 100, unitCost: 1000 }] });

  const channel = async (code) => (await sql`select id from payment_channel where company_id = ${co.id} and code = ${code}`)[0].id;
  const CASH = await channel("CASH"), KBZ = await channel("KBZPAY"), BANK = await channel("BANK");
  // The wallet's own account: reused if the chart has it, else made, as Settings does.
  let [wallet] = await sql`select id from account where company_id = ${co.id} and lower(name) = 'kbzpay' and is_cash_account`;
  if (!wallet) {
    [wallet] = await sql`insert into account (company_id, parent_id, code, name, account_type, is_cash_account, is_bank_account)
      select ${co.id}, parent_id, '1019', 'KBZPay', 'ASSET', true, true from account where company_id = ${co.id} and code = '1010'
      returning id`;
  }
  await sql`delete from payment_channel_account where channel_id = ${KBZ}`;
  await sql`insert into payment_channel_account (company_id, channel_id, account_id) values (${co.id}, ${KBZ}, ${wallet.id})`;
  const cashAcct = (await sql`select fn_payment_channel_account(${CASH}, ${loc.id}) as a`)[0].a;
  const bankAcct = (await sql`select fn_payment_channel_account(${BANK}, ${loc.id}) as a`)[0].a;

  const bal = async (accountId) => n((await sql`select coalesce(sum(base_amount), 0) as v from journal_line where account_id = ${accountId}`)[0].v);
  const revenue = async () => -n((await sql`select coalesce(sum(jl.base_amount), 0) as v from journal_line jl
     join account a on a.id = jl.account_id where jl.company_id = ${co.id} and a.account_type = 'REVENUE'`)[0].v);
  const sale = (price, payments, extra = {}) => postTillSale({
    companyId: co.id, userId: null, locationId: loc.id, partnerId: null, salesmanId: null,
    priceIncludesTax: true, memo: null, attempt: Math.random().toString(36).slice(2),
    lines: [{ itemId: item.id, qty: 1, unitPrice: price, discountPct: 0, taxCodeId: null }],
    payments, ...extra }, tr);
  const receiptsOf = (id) => sql`select id, status, payment_channel_id, payment_reference, gross_total::float as amount
     from document where doc_type = 'CUSTOMER_RECEIPT' and lifecycle_owner_id = ${id} order by doc_no`;

  // ---- cash, wallet, split -------------------------------------------------
  section("cash, wallet and split sales");
  let r0 = await revenue(), c0 = await bal(cashAcct), w0 = await bal(wallet.id);
  const cashSale = await sale(500_000, [{ channelId: CASH, amount: 500_000 }]);
  let rc = await receiptsOf(cashSale.id);
  check("cash sale: one receipt, labelled Cash", rc.length === 1 && rc[0].payment_channel_id === CASH);
  check("  Cash on Hand up 500,000", near(await bal(cashAcct) - c0, 500_000));
  check("  revenue booked once", near(await revenue() - r0, 500_000), `${await revenue() - r0}`);

  r0 = await revenue();
  const kbzSale = await sale(500_000, [{ channelId: KBZ, amount: 500_000, reference: "KBZ-0001" }]);
  rc = await receiptsOf(kbzSale.id);
  check("KBZPay sale: Dr the KBZPay wallet 500,000", near(await bal(wallet.id) - w0, 500_000));
  check("  revenue credited 500,000, once", near(await revenue() - r0, 500_000));
  check("  the receipt keeps channel and transaction ID", rc[0]?.payment_channel_id === KBZ && rc[0]?.payment_reference === "KBZ-0001");
  const [ar] = await sql`select coalesce(sum(outstanding), 0)::float as o from v_open_item where document_id = ${kbzSale.id}`;
  check("  nothing left on the receivable", near(ar.o, 0));

  c0 = await bal(cashAcct); w0 = await bal(wallet.id); r0 = await revenue();
  const split = await sale(2_850_000, [{ channelId: CASH, amount: 1_000_000 }, { channelId: KBZ, amount: 1_850_000, reference: "KBZ-0002" }]);
  rc = await receiptsOf(split.id);
  check("split 2,850,000: two receipts, both owned by the sale", rc.length === 2);
  check("  cash 1,000,000 and KBZPay 1,850,000", near(await bal(cashAcct) - c0, 1_000_000) && near(await bal(wallet.id) - w0, 1_850_000));
  check("  revenue 2,850,000 once", near(await revenue() - r0, 2_850_000));

  // ---- refusals -------------------------------------------------------------
  section("refused before anything posts");
  const docs = async () => n((await sql`select count(*) as c from document where company_id = ${co.id}`)[0].c);
  let d0 = await docs();
  let e = await refused(() => sale(100_000, [{ channelId: KBZ, amount: 100_000, reference: "kbz-0001" }]));
  check("a KBZPay reference already recorded is refused", /already been recorded/.test(e ?? ""), e ?? "posted");
  check("  and leaves nothing behind", (await docs()) === d0);
  e = await refused(() => sale(100_000, [{ channelId: KBZ, amount: 100_000 }]));
  check("a wallet payment with no transaction ID is refused", /referenceRequired/.test(e ?? ""), e ?? "posted");
  e = await refused(() => sale(100_000, [{ channelId: KBZ, amount: 150_000, reference: "KBZ-9" }]));
  check("paying 150,000 by wallet for 100,000 is refused", e !== null, e ?? "posted");
  check("  and leaves nothing behind", (await docs()) === d0);
  e = await refused(() => sale(100_000, [{ channelId: KBZ, amount: 40_000, reference: "KBZ-10" }]));
  check("a walk-in who pays part is refused", /walkInFull/.test(e ?? ""), e ?? "posted");

  // ---- retries --------------------------------------------------------------
  section("a retry posts once");
  const attempt = "retry-" + Date.now();
  const once = (ref) => sale(200_000, [{ channelId: KBZ, amount: 200_000, reference: ref }], { attempt });
  const [a1, a2] = await Promise.all([once("KBZ-0003"), once("KBZ-0003")]);
  check("the same attempt twice is the same sale", a1.id === a2.id);
  check("  with one receipt", (await receiptsOf(a1.id)).length === 1);

  // ---- partial and later receipt -------------------------------------------
  section("credit sale, part paid, settled later");
  const credit = await sale(500_000, [{ channelId: KBZ, amount: 300_000, reference: "KBZ-0004" }], { partnerId: cust.id });
  let [open] = await sql`select outstanding::float as o from v_open_item where document_id = ${credit.id}`;
  check("300,000 by KBZPay leaves 200,000 owing", near(open?.o, 200_000));
  r0 = await revenue(); w0 = await bal(wallet.id);
  const arAcct = (await sql`select fn_resolve_control_account(${co.id}, 'AR_CONTROL', ${cust.id}) as a`)[0].a;
  const ar0 = await bal(arAcct);
  const res = await C.resolveTenders(co.id, loc.id, [{ channelId: KBZ, amount: 200_000, reference: "KBZ-0005" }], null);
  const later = await sql.begin(async (tx) => {
    const p = await P.postCustomerReceipt({ companyId: co.id, partnerId: cust.id, docDate: today,
      cashAccountId: res.tenders[0].channel.accountId, allocations: [{ invoiceId: credit.id, amount: 200_000 }] }, tx);
    await C.stampReceipt(tx, p.id, KBZ, "KBZ-0005");
    return p;
  });
  [open] = await sql`select outstanding::float as o from v_open_item where document_id = ${credit.id}`;
  check("the receipt: Dr KBZPay 200,000", near(await bal(wallet.id) - w0, 200_000));
  check("  Cr receivable 200,000", near(await bal(arAcct) - ar0, -200_000));
  check("  revenue untouched", near(await revenue() - r0, 0));
  check("  invoice settled", near(open?.o ?? 0, 0));
  check("  receipt labelled", (await sql`select payment_reference from document where id = ${later.id}`)[0].payment_reference === "KBZ-0005");

  // ---- void -------------------------------------------------------------------
  section("voiding a split sale");
  // The latest sale: stock rules refuse voiding one that later sales drew from.
  const toVoid = await sale(2_850_000, [{ channelId: CASH, amount: 1_000_000 }, { channelId: KBZ, amount: 1_850_000, reference: "KBZ-0006" }]);
  c0 = await bal(cashAcct); w0 = await bal(wallet.id); r0 = await revenue();
  await P.voidDocument({ companyId: co.id, documentId: toVoid.id, reason: "test" });
  rc = await receiptsOf(toVoid.id);
  check("both tenders are reversed", rc.every((x) => x.status === "REVERSED"), rc.map((x) => x.status).join(","));
  check("  cash and wallet back down", near(await bal(cashAcct) - c0, -1_000_000) && near(await bal(wallet.id) - w0, -1_850_000));
  check("  revenue reversed", near(await revenue() - r0, -2_850_000));
  const again = await sale(1_850_000, [{ channelId: KBZ, amount: 1_850_000, reference: "KBZ-0006" }]);
  check("  its reference can be recorded again", Boolean(again.id));

  // ---- wallet to bank ------------------------------------------------------
  section("wallet money moved to the bank");
  r0 = await revenue();
  const cf0 = await Q.getCashFlowStatement(co.id, today, today);
  const wb = await bal(wallet.id), bb = await bal(bankAcct);
  await P.postCashTransfer({ companyId: co.id, docDate: today, fromAccountId: wallet.id, toAccountId: bankAcct,
    fromLocationId: loc.id, toLocationId: loc.id, amount: 1_000_000, memo: "KBZPay settlement" });
  const cf1 = await Q.getCashFlowStatement(co.id, today, today);
  check("the wallet down 1,000,000, the bank up 1,000,000", near(await bal(wallet.id) - wb, -1_000_000) && near(await bal(bankAcct) - bb, 1_000_000));
  check("  no revenue", near(await revenue() - r0, 0));
  const sum = (cf) => cf.rows.reduce((t, x) => t + n(x.amount), 0);
  check("  cash flow sections unchanged (an internal move)", near(sum(cf1), sum(cf0)), `${sum(cf0)} → ${sum(cf1)}`);
  check("  total cash unchanged", near(cf1.endingCash, cf0.endingCash));

  // ---- branches and mappings -----------------------------------------------
  section("branch accounts and mapping rules");
  await sql`insert into payment_channel_account (company_id, channel_id, branch_id, account_id) values (${co.id}, ${KBZ}, ${branchId}, ${bankAcct})`;
  const here = (await C.channelsAt(co.id, loc.id)).find((c) => c.id === KBZ);
  const elsewhere = (await C.channelsAt(co.id, null)).find((c) => c.id === KBZ);
  check("a branch's own account wins at its locations", here?.accountId === bankAcct);
  check("  the default applies elsewhere", elsewhere?.accountId === wallet.id);
  await sql`delete from payment_channel_account where channel_id = ${KBZ} and branch_id is not null`;
  const [rev] = await sql`select id from account where company_id = ${co.id} and account_type = 'REVENUE' and is_postable limit 1`;
  e = await refused(() => sql`update payment_channel_account set account_id = ${rev.id} where channel_id = ${KBZ}`);
  check("a channel cannot pay into a revenue account", /cash or bank/.test(e ?? ""), e ?? "allowed");
  e = await refused(() => sql`insert into payment_channel_account (company_id, channel_id, branch_id, account_id)
                               values (${co.id}, ${KBZ}, ${loc.id}, ${wallet.id})`);
  const isRoot = (await sql`select parent_id is null as r from location where id = ${loc.id}`)[0].r;
  check("an account set per branch must name a branch", isRoot || /branch/.test(e ?? ""), e ?? "allowed");
  const unmapped = (await C.channelsAt(co.id, loc.id)).find((c) => c.code === "MMQR");
  e = await refused(() => sale(100_000, [{ channelId: unmapped.id, amount: 100_000, reference: "Q1" }]));
  check("a channel with no account is refused at the till", /channelUnmapped/.test(e ?? ""), e ?? "posted");

  // ---- reporting ---------------------------------------------------------------
  section("the dashboard chart groups by channel");
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const by = await Q.getReceiptsByAccount(co.id, today, tomorrow);
  const kbzRow = by.find((x) => x.name === "KBZPay");
  check("KBZPay is its own slice", Boolean(kbzRow), by.map((x) => `${x.name}:${x.revenue}`).join(" "));
} catch (err) {
  bad++;
  console.error("\n  ERROR", err);
} finally {
  await resetTransactions(sql).catch(() => {});
  await sql`delete from item where code like '98%'`.catch(() => {});
  await sql`delete from item_group where segment = '98'`.catch(() => {});
  await sql`delete from business_partner where code in ('PC-SUP', 'PC-CUST')`.catch(() => {});
  await releaseTestLock(sql);
  await sql.end();
  const { sql: appSql } = await import("../lib/db.ts");
  await appSql.end({ timeout: 1 }).catch(() => {});
  console.log(bad ? `\n  ${bad} FAILED\n` : "\n  all passed\n");
  process.exit(bad ? 1 : 0);
}

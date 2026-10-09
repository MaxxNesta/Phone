// The indirect cash flow statement, scenario by scenario.
//
//   ALLOW_DESTRUCTIVE_TESTS=1 npx tsx scripts/test-cash-flow-indirect.mjs
//
// Destructive like every suite here: it empties transactions on whatever
// DATABASE_URL points at. Never run it against pilot or production.
//
// Each scenario is posted through lib/posting.ts — the real engine, nothing
// written to the ledger by hand — and after each one the statement is read
// for that day alone and for the period so far. Every time it proves:
//
//   Indirect closing cash = Direct closing cash = GL cash/bank closing,
//   and the indirect statement's own reconciliation difference is nil.
//
// Then the line the scenario should move is checked by amount.
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
await takeTestLock(sql, "test-cash-flow-indirect.mjs");
const P = await import("../lib/posting.ts");
const Q = await import("../lib/queries.ts");
const I = await import("../lib/indirect-cash-flow.ts");

let bad = 0;
const check = (label, ok, detail = "") => {
  if (!ok) bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
const n = (v) => Number(v).toLocaleString("en-US");

try {
  await resetTransactions(sql);
  const [co] = await sql`select id, name from company order by created_at limit 1`;
  const [branch] = await sql`select id from location where company_id = ${co.id} and parent_id is null and is_active order by code limit 1`;
  const [wh] = await sql`select id from location where company_id = ${co.id} and is_stock_location and is_active order by code limit 1`;
  const one = async (q, what) => { const [r] = await q; if (!r) throw new Error(`no ${what} on this chart`); return r; };
  const acc = (where, what) => one(sql`select id, code, name from account where company_id = ${co.id} and is_postable and is_active and ${where} order by code limit 1`, what);
  const cash = await acc(sql`is_cash_account and not is_bank_account`, "cash account");
  const bank = await acc(sql`is_bank_account`, "bank account");
  const equip = await acc(sql`indirect_role = 'FIXED_ASSET' and lower(name) not like '%accum%' and account_type = 'ASSET'`, "fixed asset");
  const accum = await acc(sql`indirect_role = 'FIXED_ASSET' and lower(name) like '%accum%'`, "accumulated depreciation");
  const depExp = await acc(sql`indirect_role = 'NON_CASH'`, "depreciation expense");
  const loan = await acc(sql`indirect_role = 'BORROWING'`, "loan");
  const capital = await acc(sql`indirect_role = 'CAPITAL'`, "capital");
  const obe = await acc(sql`indirect_role = 'OPENING_BALANCE'`, "opening balance equity");
  const incomeTax = await acc(sql`indirect_role = 'INCOME_TAX'`, "income tax payable");
  // Where an asset bought on credit is owed: classified with the asset, so
  // the credit purchase is no cash flow and paying it is an investing one.
  let [assetPayable] = await sql`select id from account where company_id = ${co.id} and code = '2070'`;
  if (!assetPayable) {
    const [cl] = await sql`select id from account where company_id = ${co.id} and code = '2-CL'`;
    [assetPayable] = await sql`
      insert into account (company_id, parent_id, code, name, account_type, is_postable, cash_flow_class, indirect_role, cash_flow_confirmed)
      values (${co.id}, ${cl?.id ?? null}, '2070', 'Fixed Asset Payable', 'LIABILITY', true, 'INVESTING', 'FIXED_ASSET', true)
      returning id`;
  }
  const item = await one(sql`select id from item where company_id = ${co.id} and is_stocked and not tracks_serial
     and not exists (select 1 from item c where c.parent_item_id = item.id) order by code limit 1`, "plain stocked item");
  const party = async (code, name, cust) => {
    const [p] = await sql`select id from business_partner where company_id = ${co.id} and code = ${code}`;
    if (p) return p;
    return (await sql`insert into business_partner (company_id, code, name, is_customer, is_supplier)
      values (${co.id}, ${code}, ${name}, ${cust}, ${!cust}) returning id`)[0];
  };
  const cust = await party("CFCUST", "Cash Flow Customer", true);
  const supp = await party("CFSUPP", "Cash Flow Supplier", false);
  console.log(`\n  ${co.name}\n`);

  const day = (d) => `2026-06-${String(d).padStart(2, "0")}`;
  const glCash = async (to) => Number((await sql`
    select coalesce(sum(jl.base_amount), 0)::float as b from journal_line jl
      join journal_entry je on je.id = jl.journal_entry_id join account a on a.id = jl.account_id
     where jl.company_id = ${co.id} and (a.is_cash_account or a.is_bank_account) and je.entry_date <= ${to}::date`)[0].b);
  const line = (st, key) => [...st.operating, ...st.investing, ...st.financing].find((l) => l.key === key)?.amount ?? 0;

  /** The three closings agree, and the indirect statement explains itself. */
  const prove = async (label, from, to, branchId = null) => {
    const ind = await I.getIndirectCashFlow(co.id, from, to, branchId);
    const dir = await Q.getCashFlowStatement(co.id, from, to, branchId);
    const gl = branchId ? ind.endingCash : await glCash(to);
    const dirNet = dir.rows.reduce((s, r) => s + Number(r.amount), 0);
    check(`${label}: indirect = direct = GL closing cash`,
      near(ind.endingCash, dir.endingCash) && near(ind.endingCash, gl),
      `${n(ind.endingCash)} / ${n(dir.endingCash)} / ${n(gl)}`);
    check(`${label}: indirect reconciles (difference nil) and agrees with direct's net change`,
      near(ind.difference, 0) && near(ind.netChange, dirNet),
      `diff ${n(ind.difference)}, net ${n(ind.netChange)} vs ${n(dirNet)}`);
    return ind;
  };
  /** Post, then check the day's statement moved exactly the expected lines. */
  const scenario = async (title, d, post, expect) => {
    console.log(`\n  ${title}`);
    await post(day(d));
    const st = await prove(`${day(d)}`, day(d), day(d));
    await prove(`to date`, day(1), day(d));
    for (const [key, want] of Object.entries(expect)) {
      const got = key === "operating" ? st.netOperating : key === "investing" ? st.netInvesting
        : key === "financing" ? st.netFinancing : key === "change" ? st.netChange : line(st, key);
      check(`${key} = ${n(want)}`, near(got, want), `got ${n(got)}`);
    }
  };
  const jv = (date, lines, memo) => P.postJournalVoucher({
    companyId: co.id, locationId: branch.id, docDate: date, memo, lines });

  await scenario("opening balances: cash, bank and equity on day 1", 1,
    (d) => jv(d, [{ accountId: cash.id, amount: 5_000_000 }, { accountId: bank.id, amount: 20_000_000 },
                  { accountId: obe.id, amount: -25_000_000 }], "opening balances"),
    { change: 25_000_000, "fin:other": 25_000_000, operating: 0 });

  await scenario("owner puts in capital", 2,
    (d) => jv(d, [{ accountId: bank.id, amount: 1_000_000 }, { accountId: capital.id, amount: -1_000_000 }], "capital"),
    { "fin:capital": 1_000_000, change: 1_000_000 });

  let creditPi;
  await scenario("cash purchase: goods received and billed, paid on the bill", 3, async (d) => {
    const gr = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: d,
      lines: [{ itemId: item.id, qty: 10, unitCost: 100_000 }] });
    await P.postPurchaseInvoice({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: d, dueDate: d,
      goodsReceiptId: gr.id, cashOut: 1_000_000, cashAccountId: cash.id,
      lines: [{ itemId: item.id, qty: 10, unitPrice: 100_000 }] });
  }, { operating: -1_000_000, "wc:inv": -1_000_000, np: 0, change: -1_000_000 });

  await scenario("credit purchase: goods received and billed, nothing paid", 4, async (d) => {
    const gr = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: d,
      lines: [{ itemId: item.id, qty: 10, unitCost: 100_000 }] });
    creditPi = await P.postPurchaseInvoice({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: d, dueDate: d,
      goodsReceiptId: gr.id, lines: [{ itemId: item.id, qty: 10, unitPrice: 100_000 }] });
  }, { operating: 0, "wc:inv": -1_000_000, "wc:ap": 1_000_000, change: 0 });

  await scenario("supplier paid later", 5,
    (d) => P.postSupplierPayment({ companyId: co.id, partnerId: supp.id, docDate: d, cashAccountId: bank.id,
      allocations: [{ invoiceId: creditPi.id, amount: 1_000_000 }] }),
    { operating: -1_000_000, "wc:ap": -1_000_000, change: -1_000_000 });

  await scenario("cash sale at the counter", 6,
    (d) => P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: wh.id, docDate: d, dueDate: d,
      // As the till does: what was handed over, and the drawer it went into.
      paymentType: "CASH", cashIn: 600_000, cashAccountId: cash.id,
      lines: [{ itemId: item.id, qty: 2, unitPrice: 300_000 }] }),
    { np: 400_000, "wc:inv": 200_000, operating: 600_000, change: 600_000 });

  let creditSi;
  await scenario("credit sale, no receipt", 7, async (d) => {
    creditSi = await P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: wh.id, docDate: d, dueDate: d,
      paymentType: "CREDIT", lines: [{ itemId: item.id, qty: 3, unitPrice: 300_000 }] });
  }, { np: 600_000, "wc:ar": -900_000, "wc:inv": 300_000, operating: 0, change: 0 });

  await scenario("the credit sale paid later", 8,
    (d) => P.postCustomerReceipt({ companyId: co.id, partnerId: cust.id, docDate: d, cashAccountId: cash.id,
      allocations: [{ invoiceId: creditSi.id, amount: 900_000 }] }),
    { "wc:ar": 900_000, operating: 900_000, change: 900_000 });

  await scenario("stock found and stock lost: inventory up, then down", 9, async (d) => {
    await P.postStockAdjustment({ companyId: co.id, locationId: wh.id, docDate: d,
      lines: [{ itemId: item.id, qty: 2, unitCost: 100_000 }] });
    await P.postStockAdjustment({ companyId: co.id, locationId: wh.id, docDate: d,
      lines: [{ itemId: item.id, qty: -1 }] });
  }, { "wc:inv": -100_000, np: 100_000, operating: 0, change: 0 });

  await scenario("depreciation journal", 10,
    (d) => jv(d, [{ accountId: depExp.id, amount: 50_000 }, { accountId: accum.id, amount: -50_000 }], "depreciation"),
    { np: -50_000, dep: 50_000, operating: 0, investing: 0, change: 0 });

  await scenario("fixed asset bought for cash", 11,
    (d) => jv(d, [{ accountId: equip.id, amount: 2_000_000 }, { accountId: bank.id, amount: -2_000_000 }], "equipment, cash"),
    { "inv:purchase": -2_000_000, operating: 0, change: -2_000_000 });

  await scenario("fixed asset bought on credit: no cash flow yet", 12,
    (d) => jv(d, [{ accountId: equip.id, amount: 1_500_000 }, { accountId: assetPayable.id, amount: -1_500_000 }], "equipment, credit"),
    { investing: 0, operating: 0, financing: 0, change: 0 });

  await scenario("the asset on credit paid: investing outflow now", 13,
    (d) => jv(d, [{ accountId: assetPayable.id, amount: 1_500_000 }, { accountId: bank.id, amount: -1_500_000 }], "pay for equipment"),
    { "inv:purchase": -1_500_000, operating: 0, change: -1_500_000 });

  await scenario("equipment part cash, part credit", 14,
    (d) => jv(d, [{ accountId: equip.id, amount: 1_000_000 }, { accountId: bank.id, amount: -400_000 },
                  { accountId: assetPayable.id, amount: -600_000 }], "equipment, part paid"),
    { "inv:purchase": -400_000, operating: 0, change: -400_000 });

  await scenario("loan received", 15,
    (d) => jv(d, [{ accountId: bank.id, amount: 10_000_000 }, { accountId: loan.id, amount: -10_000_000 }], "loan in"),
    { "fin:loan_in": 10_000_000, change: 10_000_000 });

  await scenario("loan repaid", 16,
    (d) => jv(d, [{ accountId: loan.id, amount: 2_000_000 }, { accountId: bank.id, amount: -2_000_000 }], "loan out"),
    { "fin:loan_out": -2_000_000, change: -2_000_000 });

  await scenario("equipment bought entirely with a loan: no cash flow at all", 17,
    (d) => jv(d, [{ accountId: equip.id, amount: 3_000_000 }, { accountId: loan.id, amount: -3_000_000 }], "equipment on loan"),
    { investing: 0, financing: 0, operating: 0, change: 0 });

  await scenario("income tax paid", 18,
    (d) => jv(d, [{ accountId: incomeTax.id, amount: 100_000 }, { accountId: bank.id, amount: -100_000 }], "income tax paid"),
    { tax: -100_000, change: -100_000 });

  console.log("\n  periods");
  const full = await prove("whole run", day(1), day(30));
  const mid = await prove("days 6–9 only", day(6), day(9));
  const glBefore = await glCash(day(5));
  check("beginning cash of a later window is the GL balance the day before",
    near(mid.beginningCash, glBefore), `${n(mid.beginningCash)} vs ${n(glBefore)}`);
  await prove("before anything", "2026-04-01", "2026-05-31");
  await prove("branch view", day(1), day(30), branch.id);
  check("operating + investing + financing = net change",
    near(full.netOperating + full.netInvesting + full.netFinancing, full.netChange));

  console.log("\n  drill-downs add up to their lines");
  for (const key of ["np", "dep", "wc:ar", "wc:inv", "wc:ap", "tax", "inv:purchase", "fin:loan_in", "fin:loan_out", "fin:capital", "fin:other"]) {
    const d = await I.getIndirectDrill(co.id, day(1), day(30), null, key);
    const sumRows = d.balances ? d.balances.adjustment : d.rows.reduce((s, r) => s + r.amount, 0);
    check(`${key}: drill-down ${n(sumRows)} = line ${n(line(full, key))}`, near(sumRows, line(full, key)));
  }
  const ar = await I.getIndirectDrill(co.id, day(1), day(30), null, "wc:ar");
  check("AR drawer: closing − opening = change, adjustment = −change",
    near(ar.balances.closing - ar.balances.opening, ar.balances.change) && near(ar.balances.adjustment, -ar.balances.change));
  check("AR drawer: running balance ends at the closing balance",
    near(ar.rows.at(-1)?.balance ?? ar.balances.opening, ar.balances.closing));
} catch (e) {
  bad++;
  console.log(`\n  error: ${e.message}\n${e.stack?.split("\n").slice(1, 4).join("\n")}`);
} finally {
  await releaseTestLock(sql);
  await sql.end();
  console.log(`\n  ${bad === 0 ? "all passed" : `${bad} failed`}\n`);
  process.exit(bad === 0 ? 0 : 1);
}

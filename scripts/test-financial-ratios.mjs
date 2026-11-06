// Financial ratios from postings with known answers: an owner's capital, a
// loan, a credit purchase, a credit sale of part of it, part of each
// settled, rent and interest. Every ratio is worked out by hand below.
//
// Runs inside one transaction that is always rolled back, so it leaves
// nothing behind. The exact figures need a ledger with nothing before the
// window; on one that has some they are skipped.
//
//   npx tsx --env-file=.env scripts/test-financial-ratios.mjs

const { sql } = await import("../lib/db.ts");
const P = await import("../lib/posting.ts");
const { getFinancialRatios } = await import("../lib/financial-ratios.ts");

let failed = 0;
const check = (what, ok, got) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : `  (got ${JSON.stringify(got)})`}`); if (!ok) failed++; };
const near = (a, b, tol = 0.001) => a !== null && a !== undefined && Math.abs(Number(a) - Number(b)) < tol;
class Rollback extends Error {}

const iso = (d) => d.toISOString().slice(0, 10);
const now = new Date();
const day = iso(now);
const from = iso(new Date(now.getTime() - 29 * 86_400_000));
const to = iso(new Date(now.getTime() + 86_400_000));

try {
  await sql.begin(async (tx) => {
    const [co] = await tx`select id from company order by created_at limit 1`;
    const one = async (q) => (await q)[0];
    const acc = async (code) => (await one(tx`select id from account where company_id = ${co.id} and code = ${code}`)).id;
    const charger = await one(tx`select id from item where company_id = ${co.id} and code = 'AKN01'`);
    const wh = await one(tx`select id from location where company_id = ${co.id} and code = 'MAIN-WH'`);
    const supplier = await one(tx`select id from business_partner where company_id = ${co.id} and is_supplier order by code limit 1`);
    const customer = await one(tx`select id from business_partner where company_id = ${co.id} and is_customer order by code limit 1`);
    const cash = await one(tx`select id from account where company_id = ${co.id} and is_cash_account and is_postable and is_active order by code limit 1`);
    const [{ n: before }] = await tx`select count(*)::int as n from journal_line where company_id = ${co.id}`;
    const v = (lines, memo) => P.postJournalVoucher({ companyId: co.id, docDate: day, memo, locationId: wh.id, lines }, tx);

    await v([{ accountId: cash.id, amount: 5_000_000 }, { accountId: await acc("31105"), amount: -5_000_000 }], "capital");
    await v([{ accountId: cash.id, amount: 2_000_000 }, { accountId: await acc("23001"), amount: -2_000_000 }], "loan");
    const bill = await P.postPurchaseWithReceipt({
      companyId: co.id, partnerId: supplier.id, locationId: wh.id, docDate: day, dueDate: day,
      memo: "ratios test", reference: null, cashOut: 0, cashAccountId: null,
      lines: [{ itemId: charger.id, qty: 10, unitPrice: 80000 }],
    }, tx);
    const sale = await P.postSaleWithDelivery({
      companyId: co.id, partnerId: customer.id, locationId: wh.id, docDate: day, dueDate: day,
      paymentType: "CREDIT", memo: "ratios test", reference: null, cashIn: 0, cashAccountId: null,
      lines: [{ itemId: charger.id, qty: 4, unitPrice: 150000 }],
    }, tx);
    await P.postSupplierPayment({ companyId: co.id, partnerId: supplier.id, docDate: day, cashAccountId: cash.id, locationId: wh.id,
      allocations: [{ invoiceId: bill.id, amount: 300000 }] }, tx);
    await P.postCustomerReceipt({ companyId: co.id, partnerId: customer.id, docDate: day, cashAccountId: cash.id, locationId: wh.id,
      allocations: [{ invoiceId: sale.id, amount: 200000 }] }, tx);
    const [rent] = await tx`select id from account where company_id = ${co.id} and account_type = 'EXPENSE' and is_postable and code like '6%' and code not like '67%' order by code limit 1`;
    await v([{ accountId: rent.id, amount: 50_000 }, { accountId: cash.id, amount: -50_000 }], "rent");
    await v([{ accountId: await acc("67101"), amount: 10_000 }, { accountId: cash.id, amount: -10_000 }], "interest");

    const { current: c, previous, trend } = await getFinancialRatios(co.id, { from, to, compare: "previous", branchId: null }, tx);
    const r = c.ratios;
    if (before === 0) {
      check("cash 6,840,000 · receivable 400,000 · stock 480,000", near(c.cash, 6_840_000) && near(c.receivable, 400_000) && near(c.inventory, 480_000), c);
      check("current assets 7,720,000 · current liabilities 500,000", near(c.currentAssets, 7_720_000) && near(c.currentLiabilities, 500_000), c);
      check("debt 2,000,000 · assets 7,720,000 · equity 5,220,000", near(c.debt, 2_000_000) && near(c.totalAssets, 7_720_000) && near(c.equity, 5_220_000), c);
      check("sales 600,000 · gross 280,000 · operating 230,000 · net 220,000",
        near(c.netSales, 600_000) && near(c.grossProfit, 280_000) && near(c.operatingProfit, 230_000) && near(c.netProfit, 220_000), c);
      check("interest 10,000 kept out of operating expenses", near(c.interest, 10_000) && near(c.operatingExpenses, 50_000), c);
      check("current ratio 15.44", near(r.current, 15.44), r.current);
      check("quick ratio 14.48", near(r.quick, 14.48), r.quick);
      check("cash ratio 13.68", near(r.cash, 13.68), r.cash);
      check("receivable turnover 600,000 ÷ 200,000 = 3", near(r.receivableTurnover, 3), r.receivableTurnover);
      check("debtors turnover 200,000 collected ÷ 200,000 = 1", near(r.debtorsTurnover, 1), r.debtorsTurnover);
      check("creditors turnover 800,000 billed ÷ 250,000 = 3.2", near(r.creditorsTurnover, 3.2), r.creditorsTurnover);
      check("gross margin 46.67%", near(r.grossMargin, 280 / 6), r.grossMargin);
      check("net (earning) margin 36.67%", near(r.netMargin, 220 / 6), r.netMargin);
      check("ROA 220,000 ÷ 3,860,000 = 5.70%", near(r.roa, 22_000_000 / 3_860_000), r.roa);
      check("ROE 220,000 ÷ 2,610,000 = 8.43%", near(r.roe, 22_000_000 / 2_610_000), r.roe);
      check("ROI 220,000 ÷ 3,610,000 = 6.09%", near(r.roi, 22_000_000 / 3_610_000), r.roi);
      check("debt to equity 0.383", near(r.debtToEquity, 2 / 5.22), r.debtToEquity);
      check("debt to assets 0.259", near(r.debtToAssets, 2 / 7.72), r.debtToAssets);
      check("liabilities to equity 0.479", near(r.liabilitiesToEquity, 2.5 / 5.22), r.liabilitiesToEquity);
      check("interest cover 230,000 ÷ 10,000 = 23", near(r.interestCover, 23), r.interestCover);
      check("financial leverage 3.86 ÷ 2.61 = 1.479", near(r.financialLeverage, 3.86 / 2.61), r.financialLeverage);
      check("operating leverage 280,000 ÷ 230,000 = 1.217", near(r.operatingLeverage, 280 / 230), r.operatingLeverage);
      check("the period before had no trading: no margin", previous.ratios.grossMargin === null, previous.ratios.grossMargin);
    } else {
      console.log(`  (exact figures skipped: ${before} lines already on the ledger)`);
    }
    check("the trend ends on the period's figures", trend.length > 0 && near(trend.at(-1).current, r.current), trend.at(-1));
    const branch = await getFinancialRatios(co.id, { from, to, compare: "year", branchId: (await one(tx`select parent_id from location where id = ${wh.id}`)).parent_id }, tx);
    check("the branch holding everything gives the same net profit", near(branch.current.netProfit, c.netProfit), branch.current.netProfit);
    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) { console.log(`  FAIL ${e.message}`); failed++; }
}
console.log(failed ? `\n  ${failed} failed\n` : "\n  all passed — rolled back, nothing kept\n");
await sql.end();
process.exit(failed ? 1 : 0);

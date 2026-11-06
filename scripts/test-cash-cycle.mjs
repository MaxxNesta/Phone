// The cash conversion cycle from postings with known answers: a credit
// purchase, a credit sale of part of it, part of each settled. Days on the
// shelf, days to be paid and days to pay are worked out by hand below and
// compared with what the page shows.
//
// Runs inside one transaction that is always rolled back, so it leaves
// nothing behind and can run on a database holding real data. The exact
// figures need a window with no other trading; on a database that has some,
// they are skipped and only the shape is checked.
//
//   npx tsx scripts/test-cash-cycle.mjs

const { sql } = await import("../lib/db.ts");
const { postPurchaseWithReceipt, postSaleWithDelivery, postSupplierPayment, postCustomerReceipt } = await import("../lib/posting.ts");
const { getCashConversionCycle } = await import("../lib/queries.ts");

let failed = 0;
const check = (what, ok, got) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : `  (got ${JSON.stringify(got)})`}`); if (!ok) failed++; };
const near = (a, b) => a !== null && Math.abs(Number(a) - Number(b)) < 0.001;
class Rollback extends Error {}

const iso = (d) => d.toISOString().slice(0, 10);
const today = new Date();
const day = iso(today);
const from = iso(new Date(today.getTime() - 29 * 86_400_000));
const to = iso(new Date(today.getTime() + 86_400_000));

try {
  await sql.begin(async (tx) => {
    const [co] = await tx`select id from company order by created_at limit 1`;
    const one = async (q) => (await q)[0];
    const charger = await one(tx`select id from item where company_id = ${co.id} and code = 'AKN01'`);
    const wh = await one(tx`select id from location where company_id = ${co.id} and code = 'MAIN-WH'`);
    const supplier = await one(tx`select id from business_partner where company_id = ${co.id} and is_supplier order by code limit 1`);
    const customer = await one(tx`select id from business_partner where company_id = ${co.id} and is_customer order by code limit 1`);
    const cash = await one(tx`select id from account where company_id = ${co.id} and is_cash_account and is_postable and is_active order by code limit 1`);
    const [{ n: before }] = await tx`select count(*)::int as n from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
                                      where jl.company_id = ${co.id} and je.entry_date < ${to}::date`;

    const empty = await getCashConversionCycle(co.id, from, to, tx);
    if (before === 0) check("no trading: no cycle, not a zero", empty.current.ccc === null, empty.current);

    // Bought 10 at 80,000 on credit: 800,000 on the shelf and owed.
    const bill = await postPurchaseWithReceipt({
      companyId: co.id, partnerId: supplier.id, locationId: wh.id, docDate: day, dueDate: day,
      memo: "cash cycle test", reference: null, cashOut: 0, cashAccountId: null,
      lines: [{ itemId: charger.id, qty: 10, unitPrice: 80000 }],
    }, tx);
    // Sold 4 at 150,000 on credit: 600,000 revenue, 320,000 cost, 480,000 left.
    const sale = await postSaleWithDelivery({
      companyId: co.id, partnerId: customer.id, locationId: wh.id, docDate: day, dueDate: day,
      paymentType: "CREDIT", memo: "cash cycle test", reference: null, cashIn: 0, cashAccountId: null,
      lines: [{ itemId: charger.id, qty: 4, unitPrice: 150000 }],
    }, tx);
    // 300,000 paid to the supplier, 200,000 in from the customer.
    await postSupplierPayment({ companyId: co.id, partnerId: supplier.id, docDate: day, cashAccountId: cash.id,
      allocations: [{ invoiceId: bill.id, amount: 300000 }] }, tx);
    await postCustomerReceipt({ companyId: co.id, partnerId: customer.id, docDate: day, cashAccountId: cash.id,
      allocations: [{ invoiceId: sale.id, amount: 200000 }] }, tx);

    const { current: c, previous, trend } = await getCashConversionCycle(co.id, from, to, tx);
    check("the window is 30 days", c.days === 30, c.days);
    if (before === 0) {
      check("revenue 600,000", near(c.revenue, 600000), c.revenue);
      check("cost of sales 320,000", near(c.cogs, 320000), c.cogs);
      // Nothing before the window, so each average is half the closing balance.
      check("stock averaged: (0 + 480,000) / 2", near(c.inventory, 240000), c.inventory);
      check("receivable averaged: (0 + 400,000) / 2", near(c.receivable, 200000), c.receivable);
      check("payable averaged: (0 + 500,000) / 2", near(c.payable, 250000), c.payable);
      check("DIO = 240,000 / 320,000 × 30 = 22.5", near(c.dio, 22.5), c.dio);
      check("DSO = 200,000 / 600,000 × 30 = 10", near(c.dso, 10), c.dso);
      check("DPO = 250,000 / 320,000 × 30 = 23.44", near(c.dpo, 23.4375), c.dpo);
      check("CCC = 22.5 + 10 − 23.44 = 9.06", near(c.ccc, 9.0625), c.ccc);
      check("the month before had no trading, so no cycle", previous.ccc === null, previous.ccc);
    } else {
      console.log(`  (exact figures skipped: ${before} lines already in the window)`);
    }
    check("CCC is DIO + DSO − DPO", near(c.ccc, c.dio + c.dso - c.dpo), c);
    check("twelve trend points", trend.length === 12, trend.length);
    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) { console.log(`  FAIL ${e.message}`); failed++; }
}
console.log(failed ? `\n  ${failed} failed\n` : "\n  all passed — rolled back, nothing kept\n");
await sql.end();
process.exit(failed ? 1 : 0);

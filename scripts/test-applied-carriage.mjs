// What a receipt and its bill show of the carriage applied to their goods:
// a charge paid on the spot and one owed to the courier, each with every
// item's share. Rolled back: leaves nothing behind.
//
//   npx tsx --env-file=.env scripts/test-applied-carriage.mjs

const { sql } = await import("../lib/db.ts");
const P = await import("../lib/posting.ts");
const C = await import("../lib/courier-payables.ts");

let failed = 0;
const check = (what, ok, got) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : `  (got ${JSON.stringify(got)})`}`); if (!ok) failed++; };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
class Rollback extends Error {}

try {
  await sql.begin(async (tx) => {
    const one = async (q) => (await q)[0];
    const [co] = await tx`select id from company order by created_at limit 1`;
    const charger = await one(tx`select id from item where company_id = ${co.id} and code = 'AKN01'`);
    const phone = await one(tx`select id from item where company_id = ${co.id} and code = 'IPC006'`);
    const wh = await one(tx`select id from location where company_id = ${co.id} and code = 'MAIN-WH'`);
    const supplier = await one(tx`select id from business_partner where company_id = ${co.id} and is_supplier order by code limit 1`);
    const cash = await one(tx`select id, name from account where company_id = ${co.id} and is_cash_account and is_postable and is_active order by code limit 1`);
    const day = new Date().toISOString().slice(0, 10);

    const bill = await P.postPurchaseWithReceipt({
      companyId: co.id, partnerId: supplier.id, locationId: wh.id, docDate: day, dueDate: day,
      memo: "applied carriage test", reference: null, cashOut: 0, cashAccountId: null,
      lines: [
        { itemId: charger.id, qty: 10, unitPrice: 80000 },
        { itemId: phone.id, qty: 2, unitPrice: 3000000, serials: ["990000000000017", "990000000000025"] },
      ],
    }, tx);
    const receipts = await C.receiptsOfBill(bill.id, tx);
    check("the bill finds the receipt it billed", receipts.length === 1, receipts);

    // Paid on the spot, 120,000 over 12 items equally; then 60,000 owed, by item cost.
    await C.courierBill(tx, { companyId: co.id, userId: null, partnerId: null, docDate: day, receiptIds: receipts,
      amount: 120000, method: "EQUAL", reference: "SLIP-1", paidFromAccountId: cash.id });
    await C.courierBill(tx, { companyId: co.id, userId: null, partnerId: null, docDate: day, receiptIds: receipts,
      amount: 60000, method: "VALUE", reference: "SLIP-2" });

    const onReceipt = await C.appliedCarriage(co.id, receipts, tx);
    check("the receipt shows both charges", onReceipt.length === 2, onReceipt.map((c) => c.docNo));
    const [paid, owed] = onReceipt;
    check("the first was paid now, from the cash account", paid.paidFrom === cash.name, paid.paidFrom);
    check("  120,000, spread equally, slip SLIP-1", near(paid.total, 120000) && paid.method === "EQUAL" && paid.reference === "SLIP-1", paid);
    check("  every item has its share: 10 chargers on one line, 2 phones each", paid.shares.length === 3
      && near(paid.shares.reduce((t, x) => t + x.amount, 0), 120000), paid.shares);
    check("  10,000 per item, the chargers' line 100,000", paid.shares.some((x) => x.qty === 10 && near(x.amount, 100000)), paid.shares);
    check("the second is owed, by item cost", owed.paidFrom === null && owed.method === "VALUE" && near(owed.total, 60000), owed);
    const onBill = await C.appliedCarriage(co.id, await C.receiptsOfBill(bill.id, tx), tx);
    check("the bill shows the same charges as its receipt", onBill.length === 2 && onBill[0].id === paid.id, onBill.map((c) => c.docNo));
    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) { console.log(`  FAIL ${e.message}`); failed++; }
}
console.log(failed ? `\n  ${failed} failed\n` : "\n  all passed — rolled back, nothing kept\n");
await sql.end();
process.exit(failed ? 1 : 0);

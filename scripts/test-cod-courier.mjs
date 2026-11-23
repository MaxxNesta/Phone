// Cash on delivery by courier (0232): the courier collects, the debt moves to
// COD Receivable under it, and it pays in later keeping its fee, which is
// Carriage Outward.
//
// One transaction, always rolled back: safe on a database with real data.
//
//   npx tsx scripts/test-cod-courier.mjs

const { sql } = await import("../lib/db.ts");
const P = await import("../lib/posting.ts");
const C = await import("../lib/cod-couriers.ts");

let failed = 0;
const check = (what, ok, got) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${ok ? "" : `   (got ${JSON.stringify(got)})`}`); if (!ok) failed++; };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
class Rollback extends Error {}

try {
  await sql.begin(async (tx) => {
    const one = async (q) => (await q)[0];
    const co = await one(tx`select id from company order by created_at limit 1`);
    const wh = await one(tx`select id from location where company_id = ${co.id} and is_stock_location and not is_quarantine and is_active order by code limit 1`);
    const item = await one(tx`select id from item where company_id = ${co.id} and is_stocked and not tracks_serial and not tracks_batch and parent_item_id is null and is_active order by code limit 1`);
    const supplier = await one(tx`select id from business_partner where company_id = ${co.id} and is_supplier order by code limit 1`);
    const cash = await one(tx`select id from account where company_id = ${co.id} and is_cash_account and not is_bank_account and is_postable and is_active order by code limit 1`);
    const role = async (r) => (await one(tx`select account_id from system_account where company_id = ${co.id} and role = ${r}`))?.account_id;
    const COD = await role("COD_RECEIVABLE"), CARR = await role("CARRIAGE_OUTWARD"), DI = await role("DELIVERY_INCOME");
    check("COD Receivable and Carriage Outward roles are set", Boolean(COD && CARR), { COD, CARR });
    const day = new Date().toISOString().slice(0, 10);
    const tag = Date.now() % 100000;
    const courier = await one(tx`insert into business_partner (company_id, code, name, is_courier)
                                 values (${co.id}, ${"CRT" + tag}, 'Test Express', true) returning id`);
    const custA = await one(tx`insert into business_partner (company_id, code, name, is_customer) values (${co.id}, ${"CA" + tag}, 'COD A', true) returning id`);
    const custB = await one(tx`insert into business_partner (company_id, code, name, is_customer) values (${co.id}, ${"CB" + tag}, 'COD B', true) returning id`);
    await P.postPurchaseWithReceipt({ companyId: co.id, partnerId: supplier.id, locationId: wh.id, docDate: day, dueDate: day,
      memo: "cod courier test stock", reference: null, cashOut: 0, cashAccountId: null, lines: [{ itemId: item.id, qty: 10, unitPrice: 40000 }] }, tx);
    const sale = (partnerId, qty, extra) => P.postSaleWithDelivery({ companyId: co.id, partnerId, locationId: wh.id, docDate: day, dueDate: day,
      memo: null, reference: null, cashIn: 0, cashAccountId: null, paymentType: "COD", courierId: courier.id,
      lines: [{ itemId: item.id, qty, unitPrice: 95000 }], ...extra }, tx);
    const owed = async (id) => (await one(tx`select coalesce((select outstanding::float from v_open_item where document_id = ${id}), 0) as v`)).v;
    const held = async () => (await one(tx`select coalesce(sum(base_amount), 0)::float as v from journal_line where account_id = ${COD} and partner_id = ${courier.id}`)).v;
    const on = async (docId, acct) => (await one(tx`select coalesce(sum(jl.base_amount), 0)::float as v from journal_line jl
                                                     join journal_entry e on e.id = jl.journal_entry_id where e.source_id = ${docId} and jl.account_id = ${acct}`)).v;

    // 1. Two COD invoices carried by the courier.
    const a = await sale(custA.id, 2, { deliveryFee: 5000 });
    const b = await sale(custB.id, 1, {});
    const stored = await one(tx`select courier_id from document where id = ${a.id}`);
    check("the invoice remembers its courier", stored.courier_id === courier.id, stored);
    check("the customer owes it until the courier collects (195,000)", near(await owed(a.id), 195000), await owed(a.id));
    check("the delivery fee is still Delivery Income", near(await on(a.id, DI), -5000), await on(a.id, DI));

    // 2. Courier collected A: the customer's debt is the courier's.
    const [r] = await C.courierCollected(tx, { companyId: co.id, courierId: courier.id, docDate: day, invoiceIds: [a.id] });
    check("courier collected: the customer owes nothing", near(await owed(a.id), 0), await owed(a.id));
    check("and COD Receivable under the courier holds 195,000", near(await held(), 195000), await held());
    const rcp = await one(tx`select doc_type, partner_id from document where id = ${r.id}`);
    check("it is a customer receipt of the customer", rcp.doc_type === "CUSTOMER_RECEIPT" && rcp.partner_id === custA.id, rcp);
    const again = await C.courierCollected(tx, { companyId: co.id, courierId: courier.id, docDate: day, invoiceIds: [a.id] }).then(() => "posted", (e) => e.message);
    check("collecting it twice is refused", again !== "posted", again);

    // 3. Pay-in: B collected with it, fee kept back.
    const v = await C.remitCourier({ companyId: co.id, courierId: courier.id, docDate: day, locationId: wh.id, moneyAccountId: cash.id,
      received: 187000, fee: 8000, collectInvoiceIds: [b.id] }, tx);
    check("B is collected with the pay-in", near(await owed(b.id), 0), await owed(b.id));
    check("the till took 187,000", near(await on(v.id, cash.id), 187000), await on(v.id, cash.id));
    check("the fee is Carriage Outward (8,000)", near(await on(v.id, CARR), 8000), await on(v.id, CARR));
    check("the courier still holds 95,000 of 290,000", near(await held(), 95000), await held());

    // 4. More than it holds is refused.
    const over = await C.remitCourier({ companyId: co.id, courierId: courier.id, docDate: day, locationId: wh.id, moneyAccountId: cash.id,
      received: 95001, fee: 0, collectInvoiceIds: [] }, tx).then(() => "posted", (e) => e.message);
    check("paying in more than it holds is refused", over !== "posted", over);

    // 5. Void the pay-in: the courier holds it all again.
    await P.voidDocument({ documentId: v.id, reason: "test" }, tx);
    check("voiding the pay-in: the courier holds all 290,000 again", near(await held(), 290000), await held());

    // 6. Own driver COD carries no courier, even if one is passed with another payment type.
    const credit2 = await P.postSaleWithDelivery({ companyId: co.id, partnerId: custA.id, locationId: wh.id, docDate: day, dueDate: day,
      memo: null, reference: null, cashIn: 0, cashAccountId: null, paymentType: "CREDIT", courierId: courier.id,
      allowOverCreditLimit: true, creditOverrideReason: "test", lines: [{ itemId: item.id, qty: 1, unitPrice: 95000 }] }, tx);
    const c2 = await one(tx`select courier_id from document where id = ${credit2.id}`);
    check("a credit invoice ignores a courier", c2.courier_id === null, c2);

    const tb = await one(tx`select coalesce(sum(balance), 0)::float as v from v_trial_balance where company_id = ${co.id}`);
    check("the trial balance still nets to zero", near(tb.v, 0), tb);
    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) { console.error("  error:", e.message); failed++; }
} finally {
  await sql.end();
}
console.log(failed ? `\n  ${failed} failed\n` : "\n  all passed, rolled back, nothing kept\n");
process.exitCode = failed ? 1 : 0;

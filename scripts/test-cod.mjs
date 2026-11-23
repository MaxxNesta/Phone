// Cash on delivery (0230): a sales invoice collected at the door by the
// shop's own driver. Credit in the books, no credit limit, closed by the
// ordinary customer receipt; refused, it is returned.
//
// One transaction, always rolled back: safe on a database with real data.
//
//   npx tsx scripts/test-cod.mjs

const { sql } = await import("../lib/db.ts");
const P = await import("../lib/posting.ts");

let failed = 0;
const check = (what, ok, got) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${ok ? "" : `   (got ${JSON.stringify(got)})`}`); if (!ok) failed++; };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
class Rollback extends Error {}

try {
  await sql.begin(async (tx) => {
    const one = async (q) => (await q)[0];
    const co = await one(tx`select id from company order by created_at limit 1`);
    const wh = await one(tx`select id from location where company_id = ${co.id} and is_stock_location and not is_quarantine and is_active order by code limit 1`);
    const item = await one(tx`select id from item where company_id = ${co.id} and is_stocked and not tracks_serial and parent_item_id is null and is_active order by code limit 1`);
    const supplier = await one(tx`select id from business_partner where company_id = ${co.id} and is_supplier order by code limit 1`);
    const cash = await one(tx`select id from account where company_id = ${co.id} and is_cash_account and not is_bank_account and is_postable and is_active order by code limit 1`);
    const day = new Date().toISOString().slice(0, 10);
    // A customer whose credit limit a credit sale of this size would break.
    const cust = await one(tx`insert into business_partner (company_id, code, name, is_customer, credit_limit)
                              values (${co.id}, ${"CODT" + Date.now() % 100000}, 'COD test customer', true, 1000) returning id`);
    await P.postPurchaseWithReceipt({ companyId: co.id, partnerId: supplier.id, locationId: wh.id, docDate: day, dueDate: day,
      memo: "cod test stock", reference: null, cashOut: 0, cashAccountId: null, lines: [{ itemId: item.id, qty: 10, unitPrice: 40000 }] }, tx);

    const sale = (extra) => P.postSaleWithDelivery({ companyId: co.id, partnerId: cust.id, locationId: wh.id, docDate: day, dueDate: day,
      memo: null, reference: null, cashIn: 0, cashAccountId: null, lines: [{ itemId: item.id, qty: 2, unitPrice: 95000 }], ...extra }, tx);

    // 1. Credit over the limit is refused; COD of the same size is not.
    const credit = await sale({ paymentType: "CREDIT" }).then(() => "posted", (e) => e.message);
    check("credit sale over the customer's 1,000 limit is refused", credit !== "posted", credit);
    const inv = await sale({ paymentType: "COD", deliveryFee: 5000 });
    const doc = await one(tx`select payment_type, gross_total::float as total, status from document where id = ${inv.id}`);
    check("the same sale as cash on delivery posts", doc?.status === "POSTED" && doc.payment_type === "COD", doc);
    check("its total includes the 5,000 delivery fee", near(doc.total, 195000), doc.total);
    const open = await one(tx`select outstanding::float as v from v_open_item where document_id = ${inv.id}`);
    check("all of it is owed until collected (190,000 + 5,000)", near(open?.v, 195000), open);
    const fee = await one(tx`select coalesce(sum(jl.base_amount), 0)::float as v from journal_line jl
                               join journal_entry e on e.id = jl.journal_entry_id
                               join system_account s on s.account_id = jl.account_id and s.role = 'DELIVERY_INCOME' and s.company_id = ${co.id}
                              where e.source_id = ${inv.id}`);
    check("the fee is Delivery Income (credit 5,000)", near(fee.v, -5000), fee);

    // 2. Part collected, then the rest: the ordinary customer receipt.
    const r1 = await P.postCustomerReceipt({ companyId: co.id, partnerId: cust.id, docDate: day, cashAccountId: cash.id,
      allocations: [{ invoiceId: inv.id, amount: 100000 }], memo: "Cash on delivery collected" }, tx);
    const after1 = await one(tx`select outstanding::float as v from v_open_item where document_id = ${inv.id}`);
    check("part collected leaves 95,000 to collect", near(after1?.v, 95000), after1);
    await P.postCustomerReceipt({ companyId: co.id, partnerId: cust.id, docDate: day, cashAccountId: cash.id,
      allocations: [{ invoiceId: inv.id, amount: 95000 }], memo: "Cash on delivery collected" }, tx);
    const after2 = await one(tx`select coalesce((select outstanding::float from v_open_item where document_id = ${inv.id}), 0) as v`);
    check("collected in full, nothing left", near(after2.v, 0), after2);
    const till = await one(tx`select coalesce(sum(jl.base_amount), 0)::float as v from journal_line jl join journal_entry e on e.id = jl.journal_entry_id
                               where e.source_type = 'CUSTOMER_RECEIPT' and jl.account_id = ${cash.id} and e.source_id in (
                                 select d.id from document d where d.partner_id = ${cust.id} and d.doc_type = 'CUSTOMER_RECEIPT')`);
    check("the till took 195,000 in two receipts", near(till.v, 195000), till);
    check("each is a customer receipt", Boolean(r1?.id), r1);

    // 3. Refused at the door: returned, nothing left owed, the goods back.
    const inv2 = await sale({ paymentType: "COD" });
    const onHandBefore = await one(tx`select coalesce(sum(qty_on_hand), 0)::float as q from v_stock_on_hand where item_id = ${item.id} and location_id = ${wh.id}`);
    await P.postSalesReturn({ companyId: co.id, partnerId: cust.id, locationId: wh.id, docDate: day, sourceDocumentId: inv2.id,
      lines: [{ itemId: item.id, qty: 2, unitPrice: 95000 }] }, tx);
    const owed2 = await one(tx`select coalesce((select outstanding::float from v_open_item where document_id = ${inv2.id}), 0) as v`);
    const onHandAfter = await one(tx`select coalesce(sum(qty_on_hand), 0)::float as q from v_stock_on_hand where item_id = ${item.id} and location_id = ${wh.id}`);
    check("not delivered: the return leaves nothing to collect", near(owed2.v, 0), owed2);
    check("and the 2 units are back in stock", near(onHandAfter.q - onHandBefore.q, 2), [onHandBefore.q, onHandAfter.q]);

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

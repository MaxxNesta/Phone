// What posts to 2210 Sale Advance and 2230 Billed Not Delivered, and what
// clears them — shown by posting the real flows and rolling them back.
//
//   npx tsx scripts/explain-advances.mjs      (nothing is kept)

import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
const P = await import("../lib/posting.ts");
const ROLLBACK = new Error("rollback");

try {
  await sql.begin(async (tx) => {
    const [co] = await tx`select id from company order by created_at limit 1`;
    const [loc] = await tx`select id from location where company_id = ${co.id} and is_stock_location and not is_quarantine and not is_transit and is_active order by code limit 1`;
    const [cust] = await tx`select id, name from business_partner where company_id = ${co.id} and is_customer order by code limit 1`;
    const [supp] = await tx`select id from business_partner where company_id = ${co.id} and is_supplier order by code limit 1`;
    const [cash] = await tx`select id from account where company_id = ${co.id} and code = '1110'`;
    const [item] = await tx`select id from item where company_id = ${co.id} and is_stocked and not tracks_serial and not tracks_batch
        and not exists (select 1 from item c where c.parent_item_id = item.id) order by code limit 1`;
    const d = new Date().toISOString().slice(0, 10);
    await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: d,
      lines: [{ itemId: item.id, qty: 10, unitCost: 400_000 }] }, tx);

    const fmt = (n) => Math.round(n).toLocaleString("en-US").padStart(12);
    const show = async (label, docId) => {
      const rows = await tx`select a.code, a.name, sum(jl.base_amount)::float as v from journal_line jl
        join journal_entry je on je.id = jl.journal_entry_id join account a on a.id = jl.account_id
        where je.source_id = ${docId} group by a.code, a.name order by sum(jl.base_amount) desc`;
      const [bal] = await tx`select
          coalesce(sum(jl.base_amount) filter (where a.code = '2210'), 0)::float as adv,
          coalesce(sum(jl.base_amount) filter (where a.code = '2220'), 0)::float as pre,
          coalesce(sum(jl.base_amount) filter (where a.code = '2230'), 0)::float as bnd
        from journal_line jl join account a on a.id = jl.account_id where jl.company_id = ${co.id}`;
      console.log(`\n${label}`);
      for (const r of rows) console.log(`   ${r.v > 0 ? "Dr" : "   Cr"} ${r.code} ${r.name.padEnd(40)} ${fmt(Math.abs(r.v))}`);
      console.log(`   → balances  2210 ${fmt(-bal.adv)}   2220 ${fmt(-bal.pre)}   2230 ${fmt(-bal.bnd)}  (credit = owed to customers)`);
    };
    const owing = async (id) => Number((await tx`select outstanding from v_open_item where document_id = ${id}`)[0]?.outstanding ?? 0);

    console.log(`Customer: ${cust.name}`);

    // 2210 — money before an invoice.
    const rc = await P.postCustomerReceipt({ companyId: co.id, partnerId: cust.id, docDate: d,
      cashAccountId: cash.id, allocations: [], advance: 300_000, locationId: loc.id }, tx);
    await show("1. Customer pays 300,000 before any invoice (receipt on account → advance)", rc.id);

    const inv = await P.postSalesInvoice({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: d, dueDate: d,
      paymentType: "CREDIT", allowOverCreditLimit: true, creditOverrideReason: "explain", issueStock: true,
      lines: [{ itemId: item.id, qty: 2, unitPrice: 500_000 }] }, tx);
    await show("2. Invoice 1,000,000 on credit (advance untouched until applied)", inv.id);
    console.log(`   invoice still owed: ${fmt(await owing(inv.id))}`);

    const app = await P.applyAdvance({ companyId: co.id, invoiceId: inv.id, docDate: d,
      allocations: [{ paymentId: rc.id, amount: 300_000 }] }, tx);
    await show("3. Advance applied to the invoice (clears 2210 against the receivable)", app.id);
    console.log(`   invoice still owed: ${fmt(await owing(inv.id))}`);

    // 2230 — an invoice before the goods.
    const dl = await P.postSalesInvoice({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: d, dueDate: d,
      toDeliver: true, paymentType: "CREDIT", allowOverCreditLimit: true, creditOverrideReason: "explain",
      lines: [{ itemId: item.id, qty: 2, unitPrice: 500_000 }] }, tx);
    await show("4. Invoice 1,000,000 to deliver later (the price waits in 2230, no sale yet)", dl.id);
    const [line] = await tx`select id from document_line where document_id = ${dl.id}`;
    const d1 = await P.postDelivery({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: d,
      sourceDocumentId: dl.id, lines: [{ itemId: item.id, qty: 1, sourceLineId: line.id }] }, tx);
    await show("5. Deliver 1 of 2 (half moves from 2230 to Sales, with its cost)", d1.id);
    const d2 = await P.postDelivery({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: d,
      sourceDocumentId: dl.id, lines: [{ itemId: item.id, qty: 1, sourceLineId: line.id }] }, tx);
    await show("6. Deliver the other (2230 back to zero for this invoice)", d2.id);

    throw ROLLBACK;
  });
} catch (e) { if (e !== ROLLBACK) throw e; }
console.log("\n(rolled back — nothing kept)");
await sql.end();

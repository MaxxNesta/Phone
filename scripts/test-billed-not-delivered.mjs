// Deliver-later invoices hold their price in 21303 Billed Not Delivered until
// the goods go (migration 0191). Runs inside one transaction that is rolled
// back, so DEV's books are left exactly as they were.
//
//   npx tsx scripts/test-billed-not-delivered.mjs        (DATABASE_URL or .env — DEV only)

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
if (!process.env.DATABASE_URL && existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
    if (m) { process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, ""); break; }
  }
}
const P = await import("../lib/posting.ts");
const { sql } = await import("../lib/db.ts");
const [co] = await sql`select id, name from company`;
if (co.name !== "MTK — DEV") { console.error(`Refusing: this is "${co.name}", not MTK — DEV.`); process.exit(1); }

const today = new Date().toISOString().slice(0, 10);
const ROLLBACK = new Error("ROLLBACK");

try {
  await sql.begin(async (tx) => {
    const [loc] = await tx`select id from location where company_id = ${co.id} and code = 'MAIN-WH'`;
    const [cust] = await tx`select id from business_partner where company_id = ${co.id} and is_customer order by code limit 1`;
    // A stocked product without serials, with plenty on the shelf.
    const [item] = await tx`
      select i.id, i.code from item i join v_stock_on_hand s on s.item_id = i.id
       where i.company_id = ${co.id} and i.is_stocked and not i.tracks_serial and not i.tracks_batch and s.qty_on_hand >= 20
       order by s.qty_on_hand desc limit 1`;
    const acct = async (code) => (await tx`select id from account where company_id = ${co.id} and code = ${code}`)[0].id;
    const BND = await acct("21303"), GSNI = await acct("14303");
    const [rev] = await tx`select fn_resolve_account_for_item(${co.id}, 'REVENUE', ${item.id}) as a`;
    const sum = async (docIds, accountId) => Number((await tx`
      select coalesce(sum(jl.base_amount), 0) as s from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
       where je.source_id = any(${docIds}) and jl.account_id = ${accountId}`)[0].s);
    const docs = [];

    // 1. Invoice 10 to deliver later, at 35,000: the price waits in 21303, no cost, no 14303.
    const inv = await P.postSalesInvoice({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
      toDeliver: true, paymentType: "CREDIT", allowOverCreditLimit: true, creditOverrideReason: "test",
      lines: [{ itemId: item.id, qty: 10, unitPrice: 35000 }] }, tx);
    docs.push(inv.id);
    assert.equal(await sum([inv.id], BND), -350000, "invoice holds 350,000 in 21303");
    assert.equal(await sum([inv.id], rev.a), 0, "invoice books no sale");
    assert.equal(await sum([inv.id], GSNI), 0, "invoice books no cost ahead");
    const [invLine] = await tx`select id from document_line where document_id = ${inv.id}`;
    console.log("1 invoice: 350,000 held in 21303, no sale, no cost ahead");

    // 2. Deliver 4: 140,000 moves to Sales; cost at actual; 14303 nets to nothing.
    const d1 = await P.postDelivery({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, sourceDocumentId: inv.id,
      lines: [{ itemId: item.id, qty: 4, sourceLineId: invLine.id }] }, tx);
    docs.push(d1.id);
    assert.equal(await sum([d1.id], BND), 140000, "delivery of 4 releases 140,000");
    assert.equal(await sum([d1.id], rev.a), -140000, "and books it as a sale");
    assert.equal(await sum([d1.id], GSNI), 0, "14303 nets to zero on the delivery");
    console.log("2 deliver 4: 140,000 released to Sales, cost booked, 14303 nets to 0");

    // 3. Credit note 50,000 before the rest goes: comes off 21303, not Sales Return.
    const cn = await P.postCreditNote({ companyId: co.id, partnerId: cust.id, docDate: today, sourceDocumentId: inv.id,
      amount: 50000, category: "DISCOUNT", reason: "test allowance" }, tx);
    docs.push(cn.id);
    assert.equal(await sum([cn.id], BND), 50000, "credit note takes 50,000 off what is held");
    console.log("3 credit note 50,000: taken off 21303");

    // 4. Deliver the last 6: releases everything left (210,000 - 50,000).
    const d2 = await P.postDelivery({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, sourceDocumentId: inv.id,
      lines: [{ itemId: item.id, qty: 6, sourceLineId: invLine.id }] }, tx);
    docs.push(d2.id);
    assert.equal(await sum([d2.id], rev.a), -160000, "last delivery releases what is left");
    assert.equal(await sum(docs, BND), 0, "nothing left in 21303");
    assert.equal(await sum(docs, rev.a), -300000, "Sales over the whole life: 350,000 - 50,000");
    assert.equal(await sum(docs, GSNI), 0, "14303 clear");
    console.log("4 deliver 6: 160,000 released; 21303 back to 0; Sales 300,000 in all");

    // 5. Void the last delivery: its release comes back into 21303, ready to go again.
    await P.voidDocument({ documentId: d2.id, reason: "test", goodsBack: true }, tx);
    const [m] = await tx`select id from document where reverses_document_id = ${d2.id}`;
    assert.equal(await sum([...docs, m.id], BND), -160000, "voided delivery puts 160,000 back in 21303");
    const [open] = await tx`
      select sum(r.net) as n from sales_revenue_deferred r join document d on d.id = r.document_id and d.status = 'POSTED'
       where r.invoice_line_id = ${invLine.id}`;
    assert.equal(Number(open.n), 160000, "and the open figure agrees");
    console.log("5 void delivery: 160,000 back in 21303, open figure agrees");

    throw ROLLBACK;
  });
} catch (e) {
  if (e !== ROLLBACK) { console.error("FAILED:", e.message); await sql.end(); process.exit(1); }
}
console.log("billed-not-delivered: all checks pass (rolled back)");
await sql.end();
process.exit(0);

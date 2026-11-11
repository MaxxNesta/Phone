// Order vs invoice price variance, proved inside a rolled-back transaction:
// nothing it posts survives, so it is safe on a database with real data.
//
//   npx tsx scripts/check-order-variance.mjs        (DATABASE_URL or .env)
//
// Two routes from an order to a bill, at prices that differ from the order:
//   A  order 1,000 → goods receipt → bill 1,100     (invoice names the receipt line)
//   B  order 2,000 → bill with goods                 (invoice names the order line;
//      a different price is refused, so it bills 2,000)
// and one bill with no order, which must not appear.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

if (!process.env.DATABASE_URL && existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
    if (m) { process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, ""); break; }
  }
}
const P = await import("../lib/posting.ts");
const Q = await import("../lib/queries.ts");
const { sql } = await import("../lib/db.ts");
const ROLLBACK = new Error("rollback");
const today = new Date().toISOString().slice(0, 10);
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log("  ✓", m); };

const [co] = await sql`select id, name from company`;
const [supp] = await sql`select id from business_partner where company_id = ${co.id} and is_supplier and is_active order by code limit 1`;
const [loc] = await sql`select id from location where company_id = ${co.id} and is_stock_location and is_active order by code limit 1`;
// Plain items without serials, so the receipt needs no IMEI.
const items = await sql`select id from item where company_id = ${co.id} and is_active and is_stocked and not tracks_serial and not tracks_batch
                          and not exists (select 1 from item c where c.parent_item_id = item.id) order by code limit 3`;
console.log(`${co.name} · ${items.length} items`);
const base = { companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today };

await sql.begin(async (tx) => {
  // A: order → receipt → bill
  const poA = await P.postPurchaseOrder({ ...base, dueDate: today, lines: [{ itemId: items[0].id, qty: 10, unitPrice: 1000 }] }, tx);
  const [olA] = await tx`select id from document_line where document_id = ${poA.id}`;
  const gr = await P.postGoodsReceipt({ ...base, sourceDocumentId: poA.id, lines: [{ itemId: items[0].id, qty: 10, unitCost: 1000, sourceLineId: olA.id }] }, tx);
  const [grl] = await tx`select id from document_line where document_id = ${gr.id}`;
  const piA = await P.postPurchaseInvoice({ ...base, dueDate: null, goodsReceiptId: gr.id,
    lines: [{ itemId: items[0].id, qty: 10, unitPrice: 1100, sourceLineId: grl.id }] }, tx);

  // B: a bill raised straight from an order keeps the order's price — the
  // engine refuses a different one, so this route can never show a variance.
  const poB = await P.postPurchaseOrder({ ...base, dueDate: today, lines: [{ itemId: items[1].id, qty: 5, unitPrice: 2000 }] }, tx);
  const [olB] = await tx`select id from document_line where document_id = ${poB.id}`;
  await tx`savepoint b`;
  const refused = await P.postPurchaseWithReceipt({ ...base, dueDate: null, sourceDocumentId: poB.id,
    lines: [{ itemId: items[1].id, qty: 5, unitPrice: 1900, sourceLineId: olB.id }] }, tx).then(() => null, (e) => e.message);
  await tx`rollback to savepoint b`;
  ok(refused && /agreed 2000/.test(refused), "B: a bill straight from an order at another price is refused");
  const piB = await P.postPurchaseWithReceipt({ ...base, dueDate: null, sourceDocumentId: poB.id,
    lines: [{ itemId: items[1].id, qty: 5, unitPrice: 2000, sourceLineId: olB.id }] }, tx);

  // C: a bill with no order
  const piC = await P.postPurchaseWithReceipt({ ...base, dueDate: null, lines: [{ itemId: items[2].id, qty: 1, unitPrice: 500 }] }, tx);

  const rows = await Q.getOrderInvoiceVariance(co.id, { from: today, to: today }, tx);
  const a = rows.find((r) => r.doc_id === piA.id), b = rows.find((r) => r.doc_id === piB.id);
  ok(a && a.order_no === poA.docNo, `A: ${piA.docNo} traced through the receipt to ${poA.docNo}`);
  ok(a && a.order_price === 1000 && a.invoice_price === 1100, "A: ordered 1,000, billed 1,100");
  ok(b && b.order_no === poB.docNo, `B: ${piB.docNo} traced straight to ${poB.docNo}`);
  ok(b && b.order_price === 2000 && b.invoice_price === 2000, "B: listed at the agreed 2,000, no difference");
  ok(!rows.some((r) => r.doc_id === piC.id), "C: a bill with no order is not listed");
  throw ROLLBACK;
}).catch((e) => { if (e !== ROLLBACK) throw e; });

console.log(`rolled back — nothing kept · ${n} checks passed`);
await sql.end();
process.exit(0);

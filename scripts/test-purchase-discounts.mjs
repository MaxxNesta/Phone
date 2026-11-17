// Supplier discounts and free units, under the NET method (0204).
//
//   npx tsx scripts/test-purchase-discounts.mjs
//
// Everything runs inside one transaction that is rolled back at the end, so
// it leaves nothing on the database it runs against — no reset, no imports to
// redo. Each check reads only the journal of the documents it just posted.
//
//   1. A discount on the bill lowers the FIFO cost; nothing to Purchase Discounts.
//   2. Billed after some were sold: the discount splits stock / cost of sales.
//   3. Free units share the price: 10 for 10,000,000 + 1 free, exact to the kyat.
//   4. A later supplier discount (debit note) follows the goods, never the bill.
//   5. A debit note on goods not yet received goes to price variance.
//   6. A free item of a different product is weighted by its last cost.
//   7. The GROSS method still posts the way it always did.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

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
const P = await import("../lib/posting.ts");
const { allocateFreeUnits, spreadByWeight } = await import("../lib/discount.ts");

let bad = 0;
const check = (label, ok, detail = "") => {
  if (!ok) bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};
const n = (v) => Number(v ?? 0);
const near = (a, b, tol = 0.01) => Math.abs(n(a) - n(b)) < tol;

// ---- the arithmetic on its own -------------------------------------------
console.log("\n  allocation arithmetic\n");
{
  const a = allocateFreeUnits([
    { itemId: "p", qty: 10, cost: 10_000_000, free: false },
    { itemId: "p", qty: 1, cost: 0, free: true },
  ], () => null, 2);
  check("10 paid + 1 free: 9,090,909.09 / 909,090.91", a[0] === 9090909.09 && a[1] === 909090.91, JSON.stringify(a));
  check("  adds back to exactly 10,000,000", Math.round((a[0] + a[1]) * 100) === 1_000_000_000);
  const z = allocateFreeUnits([
    { itemId: "p", qty: 10, cost: 10_000_000, free: false },
    { itemId: "p", qty: 1, cost: 0, free: true },
  ], () => null, 0);
  check("in whole kyat: 9,090,909 / 909,091", z[0] === 9090909 && z[1] === 909091, JSON.stringify(z));
  const s = spreadByWeight(100, [1, 1, 1], 2);
  check("100 over three: 33.34 / 33.33 / 33.33 — exact", s.reduce((t, v) => t + v, 0) === 100, JSON.stringify(s));
  const none = allocateFreeUnits([{ itemId: "p", qty: 2, cost: 50, free: false }], () => null, 2);
  check("no free line: costs untouched", none[0] === 50);
}

const ROLLBACK = new Error("rollback");
try {
  await sql.begin(async (tx) => {
    const [co] = await tx`select id, name from company order by created_at limit 1`;
    await tx`update company set purchase_discount_policy = 'NET' where id = ${co.id}`;
    const [loc] = await tx`select id from location
       where company_id = ${co.id} and is_stock_location and is_active order by code limit 1`;
    // An item with no stock history, so FIFO starts with these receipts (one
    // already sold short would have its new units cover that shortage), and
    // a different one that has been bought before, to weigh a free unit by.
    const plain = tx`company_id = ${co.id} and is_stocked and not tracks_serial and not tracks_batch and is_active
         and not exists (select 1 from item c where c.parent_item_id = item.id)`;
    const [item] = await tx`select id, code from item where ${plain}
         and not exists (select 1 from stock_movement m where m.item_id = item.id) order by code limit 1`;
    // Bought before if any such item exists; on an emptied database, any other.
    const [other] = await tx`select id, code from item where ${plain} and id <> ${item.id}
         order by exists (select 1 from stock_lot l where l.item_id = item.id and l.unit_cost > 0) desc, code limit 1`;
    const [supp] = await tx`select id from business_partner where company_id = ${co.id} and is_supplier order by code limit 1`;
    const [cust] = await tx`select id from business_partner where company_id = ${co.id} and is_customer order by code limit 1`;
    const today = new Date().toISOString().slice(0, 10);
    // Scenario 1 a day earlier: in one transaction now() never moves, so lots
    // received "together" would leave FIFO order between them to chance.
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    console.log(`\n  ${co.name}  ·  ${item.code}, ${other.code}  ·  rolled back at the end\n`);

    /** What one document posted, by account code. */
    const posted = async (docId) => {
      const rows = await tx`
        select a.code, sum(jl.base_amount)::float as v
          from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
          join account a on a.id = jl.account_id
         where je.source_id = ${docId} group by a.code`;
      return Object.fromEntries(rows.map((r) => [r.code, Math.round(r.v * 100) / 100]));
    };
    const lotCost = async (receiptId) => {
      // What a unit carries now: the lot's own cost plus every correction to it.
      const [r] = await tx`select (sl.unit_cost + coalesce((select sum(a.delta_unit_cost) from stock_lot_adjustment a
                                    where a.lot_id = sl.id), 0))::float as u, sl.qty_received::float as q
         from stock_lot sl join stock_movement sm on sm.id = sl.stock_movement_id where sm.document_id = ${receiptId}
         order by sl.created_at limit 1`;
      return r;
    };
    const lineOf = async (docId) => (await tx`select id from document_line where document_id = ${docId} order by line_no`).map((r) => r.id);

    // 1 -----------------------------------------------------------------------
    console.log("  1. bill first, 10 at 1,000 less 10%\n");
    const b1 = await P.postPurchaseInvoice({
      companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: yesterday, dueDate: null,
      lines: [{ itemId: item.id, qty: 10, unitPrice: 1000, discountPct: 10 }],
    }, tx);
    const j1 = await posted(b1.id);
    check("GR/IR debited at the discounted 9,000", j1["1410"] === 9000, JSON.stringify(j1));
    check("  supplier owed 9,000", j1["2110"] === -9000);
    check("  nothing to Purchase Discounts", !j1["5130"]);
    const g1 = await P.postGoodsReceipt({
      companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: yesterday, sourceDocumentId: b1.id,
      lines: [{ itemId: item.id, qty: 10, unitCost: 1000 }],
    }, tx);
    check("  the phones arrive at 900 each", near((await lotCost(g1.id)).u, 900), JSON.stringify(await lotCost(g1.id)));
    check("  and GR/IR clears exactly", (await posted(g1.id))["1410"] === -9000);

    // 2 -----------------------------------------------------------------------
    console.log("\n  2. received 10 at 1,000, 4 delivered, billed less 1,000 on the bill\n");
    const g2 = await P.postGoodsReceipt({
      companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
      lines: [{ itemId: item.id, qty: 10, unitCost: 1000 }],
    }, tx);
    const [g2line] = await lineOf(g2.id);
    // FIFO: the 10 from scenario 1 go first, so take them out of the way.
    await P.postDelivery({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today,
      lines: [{ itemId: item.id, qty: 10, unitPrice: 2000 }] }, tx);
    await P.postDelivery({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today,
      lines: [{ itemId: item.id, qty: 4, unitPrice: 2000 }] }, tx);
    const b2 = await P.postPurchaseInvoice({
      companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today, dueDate: null, goodsReceiptId: g2.id,
      billDiscountAmount: 1000,
      lines: [{ itemId: item.id, qty: 10, unitPrice: 1000, sourceLineId: g2line }],
    }, tx);
    const j2 = await posted(b2.id);
    check("GR/IR relieved at what it held, 10,000", j2["1410"] === 10000, JSON.stringify(j2));
    check("  6 still held: inventory −600", j2["1310"] === -600);
    // Delivered, not yet invoiced: 1420 holds the cost the invoice will claim
    // and must keep equalling it, so the correction goes to cost of sales.
    check("  4 delivered: cost of sales −400, 1420 untouched", j2["5110"] === -400 && !j2["1420"]);
    check("  supplier owed 9,000, nothing to 5130 or PPV", j2["2110"] === -9000 && !j2["5130"] && !j2["5940"]);

    // 4 (on the same bill) ----------------------------------------------------
    console.log("\n  4. the supplier allows 500 more afterwards (debit note, DISCOUNT)\n");
    const dn = await P.postDebitNote({ companyId: co.id, partnerId: supp.id, docDate: today,
      sourceDocumentId: b2.id, amount: 500, category: "DISCOUNT", reason: "Volume rebate agreed after billing" }, tx);
    const jd = await posted(dn.id);
    check("supplier owed 500 less", jd["2110"] === 500, JSON.stringify(jd));
    check("  6 held: inventory −300", jd["1310"] === -300);
    check("  4 delivered: cost of sales −200, 1420 untouched", jd["5110"] === -200 && !jd["1420"]);
    check("  not to Purchase Discounts, not to PPV", !jd["5130"] && !jd["5940"]);
    const [b2after] = await tx`select net_total::float as v from document where id = ${b2.id}`;
    check("  the bill itself is untouched", b2after.v === 9000);

    // 3 -----------------------------------------------------------------------
    console.log("\n  3. 10 phones for 10,000,000 and one free\n");
    const b3 = await P.postPurchaseInvoice({
      companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today, dueDate: null,
      lines: [
        { itemId: item.id, qty: 10, unitPrice: 1_000_000 },
        { itemId: item.id, qty: 1, unitPrice: 0, focReasonId: (await tx`select id from foc_reason where company_id = ${co.id} and applies_to = 'PURCHASE' limit 1`)[0]?.id },
      ],
    }, tx);
    const sc = await tx`select stock_cost::float as c from document_line where document_id = ${b3.id} order by line_no`;
    check("paid line carries 10/11, free line 1/11", sc.length === 2 && sc[1].c > 0, JSON.stringify(sc.map((r) => r.c)));
    check("  together exactly 10,000,000", Math.round((sc[0].c + sc[1].c) * 100) === 1_000_000_000);
    const j3 = await posted(b3.id);
    check("  supplier owed 10,000,000; GR/IR 10,000,000; nothing to FOC Received", j3["2110"] === -10_000_000 && j3["1410"] === 10_000_000 && !j3["5140"], JSON.stringify(j3));
    const g3 = await P.postGoodsReceipt({
      companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today, sourceDocumentId: b3.id,
      lines: [{ itemId: item.id, qty: 11, unitCost: 0 }],
    }, tx);
    check("  all eleven arrive at 909,090.91", near((await lotCost(g3.id)).u, 909090.9091, 0.01), JSON.stringify(await lotCost(g3.id)));
    check("  and GR/IR clears to the kyat", near((await posted(g3.id))["1410"], -10_000_000, 0.01), JSON.stringify(await posted(g3.id)));

    // 5 -----------------------------------------------------------------------
    console.log("\n  5. a discount note on a bill whose goods have not arrived\n");
    const b5 = await P.postPurchaseInvoice({
      companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today, dueDate: null,
      lines: [{ itemId: item.id, qty: 2, unitPrice: 5000 }],
    }, tx);
    const d5 = await P.postDebitNote({ companyId: co.id, partnerId: supp.id, docDate: today,
      sourceDocumentId: b5.id, amount: 1000, category: "DISCOUNT", reason: "Late delivery allowance" }, tx);
    const j5 = await posted(d5.id);
    check("no goods to lower: 1,000 to price variance", j5["5940"] === -1000 && j5["2110"] === 1000, JSON.stringify(j5));

    // 6 -----------------------------------------------------------------------
    console.log("\n  6. a free item of a different product\n");
    const foc = (await tx`select id from foc_reason where company_id = ${co.id} and applies_to = 'PURCHASE' limit 1`)[0]?.id;
    const [last] = await tx`select unit_cost::float as u from stock_lot where item_id = ${other.id} and unit_cost > 0 order by created_at desc limit 1`;
    const b6 = await P.postPurchaseInvoice({
      companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today, dueDate: null,
      lines: [{ itemId: item.id, qty: 4, unitPrice: 1000 }, { itemId: other.id, qty: 1, unitPrice: 0, focReasonId: foc }],
    }, tx);
    const s6 = (await tx`select stock_cost::float as c from document_line where document_id = ${b6.id} order by line_no`).map((r) => r.c);
    if (last) {
      const want = 4000 * last.u / (4000 + last.u);
      check(`weighted by its last cost (${last.u}): free line ${s6[1]}`, near(s6[1], want, 1), `want ≈ ${want.toFixed(2)}`);
    } else {
      check("no cost history for it: the free item stays at zero", s6[1] === 0 && s6[0] === 4000, JSON.stringify(s6));
    }
    check("  the bill's cost still adds to 4,000", Math.round((s6[0] + s6[1]) * 100) === 400000);

    // 8 -----------------------------------------------------------------------
    console.log("\n  8. a discount on a bill already paid, and the supplier pays it back\n");
    const [cashAcct] = await tx`select id, code from account where company_id = ${co.id} and is_cash_account and not is_bank_account and is_postable order by code limit 1`;
    const b8 = await P.postPurchaseInvoice({
      companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today, dueDate: null,
      cashOut: 5000, cashAccountId: cashAcct.id,
      lines: [{ itemId: item.id, qty: 5, unitPrice: 1000 }],
    }, tx);
    const owing = async (id) => Number((await tx`select outstanding from v_open_item where document_id = ${id}`)[0]?.outstanding ?? 0);
    check("paid in full", (await owing(b8.id)) === 0);
    const d8 = await P.postDebitNote({ companyId: co.id, partnerId: supp.id, docDate: today,
      sourceDocumentId: b8.id, amount: 500, category: "DISCOUNT", reason: "Price protection" }, tx);
    check("the note posts and the supplier owes 500 back", (await owing(b8.id)) === -500, String(await owing(b8.id)));
    const { refundable } = await P.refundableOnDebitNote(tx, d8.id);
    check("  500 to come back", refundable === 500, String(refundable));
    const tooMuch = await P.postSupplierRefund({ companyId: co.id, noteId: d8.id, docDate: today, cashAccountId: cashAcct.id, amount: 600 }, tx)
      .then(() => null, (e) => e.message);
    check("  600 is refused", /600 was entered/.test(tooMuch ?? ""), tooMuch ?? "posted");
    const rf = await P.postSupplierRefund({ companyId: co.id, noteId: d8.id, docDate: today, cashAccountId: cashAcct.id, amount: 500 }, tx);
    const jr = await posted(rf.id);
    check("  refund: Dr cash 500 / Cr payables 500, the bill settles", jr[cashAcct.code] === 500 && jr["2110"] === -500 && (await owing(b8.id)) === 0, JSON.stringify(jr));
    const [no] = await tx`select doc_no from document where id = ${rf.id}`;
    check("  numbered as a supplier refund", /^SRF/.test(no.doc_no), no.doc_no);

    // 9 (brief 4) -----------------------------------------------------------
    console.log("");
    console.log("  9. a later discount with every unit still in stock");
    console.log("");
    const g9 = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
      lines: [{ itemId: other.id, qty: 5, unitCost: 1000 }] }, tx);
    const [g9l] = await lineOf(g9.id);
    const b9 = await P.postPurchaseInvoice({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today, dueDate: null,
      goodsReceiptId: g9.id, lines: [{ itemId: other.id, qty: 5, unitPrice: 1000, sourceLineId: g9l }] }, tx);
    const d9 = await P.postDebitNote({ companyId: co.id, partnerId: supp.id, docDate: today, sourceDocumentId: b9.id,
      amount: 300, category: "DISCOUNT", reason: "Allowance, all on the shelf" }, tx);
    const j9 = await posted(d9.id);
    check("all 300 off stock, nothing to cost of sales", j9["1310"] === -300 && !j9["5110"] && !j9["5940"], JSON.stringify(j9));
    check("  the lot now costs 940 a unit", near((await lotCost(g9.id)).u, 940), JSON.stringify(await lotCost(g9.id)));

    // 10 (brief 6) ----------------------------------------------------------
    console.log("");
    console.log("  10. the discounted goods were moved to another warehouse");
    console.log("");
    const [wh] = await tx`select parent_id from location where id = ${loc.id}`;
    const [loc2] = await tx`insert into location (company_id, parent_id, code, name, is_stock_location)
      values (${co.id}, ${wh.parent_id}, 'ZDF-WH2', 'Discount test warehouse', true) returning id`;
    // Received two days ago, so FIFO moves exactly this receipt's units.
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const g10 = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: twoDaysAgo,
      lines: [{ itemId: other.id, qty: 4, unitCost: 2000 }] }, tx);
    const [g10l] = await lineOf(g10.id);
    await P.postStockTransfer({ companyId: co.id, fromLocationId: loc.id, toLocationId: loc2.id, docDate: today,
      lines: [{ itemId: other.id, qty: 2 }] }, tx);
    const b10 = await P.postPurchaseInvoice({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today, dueDate: null,
      goodsReceiptId: g10.id, lines: [{ itemId: other.id, qty: 4, unitPrice: 2000, sourceLineId: g10l }] }, tx);
    const d10 = await P.postDebitNote({ companyId: co.id, partnerId: supp.id, docDate: today, sourceDocumentId: b10.id,
      amount: 400, category: "DISCOUNT", reason: "Allowance after a transfer" }, tx);
    const j10 = await posted(d10.id);
    check("all 400 off stock: the moved units are still ours", j10["1310"] === -400 && !j10["5110"], JSON.stringify(j10));
    const at = async (l) => Number((await tx`select coalesce(sum(total_cost), 0)::float as v from stock_movement
      where document_id = ${d10.id} and location_id = ${l}`)[0].v);
    check("  200 at each warehouse, following the goods", (await at(loc.id)) === -200 && (await at(loc2.id)) === -200,
      `${await at(loc.id)} / ${await at(loc2.id)}`);

    // 11 (brief 12) ---------------------------------------------------------
    console.log("");
    console.log("  11. reversal and a closed period");
    console.log("");
    await P.voidDocument({ documentId: d9.id, reason: "Entered twice" }, tx);
    check("voiding the note puts the lot back at 1,000", near((await lotCost(g9.id)).u, 1000), JSON.stringify(await lotCost(g9.id)));
    const [fp] = await tx`select id from fiscal_period where company_id = ${co.id}
      and start_date <= ${today}::date and end_date >= ${today}::date`;
    await tx`update fiscal_period set status = 'CLOSED' where id = ${fp.id}`;
    const closed = await tx.savepoint((sp) => P.postDebitNote({ companyId: co.id, partnerId: supp.id, docDate: today,
      sourceDocumentId: b9.id, amount: 100, category: "DISCOUNT", reason: "Into a closed month" }, sp)).then(() => null, (e) => e.message);
    check("a note into a closed period is refused", !!closed, closed ?? "posted");
    await tx`update fiscal_period set status = 'OPEN' where id = ${fp.id}`;

    // 12 (brief 13) ---------------------------------------------------------
    const gaps = await tx`select * from v_check_inventory_reconciliation`;
    check("stock ledger and inventory account still tie after all of it", gaps.length === 0, JSON.stringify(gaps).slice(0, 300));

    // 7 -----------------------------------------------------------------------
    console.log("\n  7. GROSS still posts as before\n");
    await tx`update company set purchase_discount_policy = 'GROSS' where id = ${co.id}`;
    const b7 = await P.postPurchaseInvoice({
      companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today, dueDate: null,
      lines: [{ itemId: item.id, qty: 10, unitPrice: 1000, discountPct: 10 }],
    }, tx);
    const j7 = await posted(b7.id);
    check("GR/IR at 10,000, 5130 credited 1,000, owed 9,000", j7["1410"] === 10000 && j7["5130"] === -1000 && j7["2110"] === -9000, JSON.stringify(j7));

    throw ROLLBACK;
  });
} catch (e) {
  if (e !== ROLLBACK) { bad++; console.error("\n  ERROR", e); }
} finally {
  await sql.end();
}
console.log(bad ? `\n  ${bad} failed\n` : "\n  all passed — nothing kept\n");
process.exit(bad ? 1 : 0);

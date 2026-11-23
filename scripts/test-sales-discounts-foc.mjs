// Sales-side discounts after the sale, and free goods given with a sale or alone.
//
//   npx tsx scripts/test-sales-discounts-foc.mjs
//
// One transaction, rolled back at the end: nothing is kept.
//
//   1. A discount agreed after the sale (credit note, DISCOUNT) → 4190 Sales Discounts.
//      Any other credit note → 4180 Sales Returns.
//   2. On a paid invoice the note leaves a credit, and Refund pays it out.
//   3. A note cannot pass what is left of the sale.
//   4. Deliver-later: a discount note keeps Sales gross; the delivery books it to 4190.
//   5. A free item given with a sale: its cost is cost of sales (5110).
//   6. A standalone giveaway (delivery of nothing but free goods): its reason's account.
//   7. The free item coming back on a return: back to 5110.

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
const { discountReport } = await import("../lib/discount-report.ts");

let bad = 0;
const check = (label, ok, detail = "") => {
  if (!ok) bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};
const refused = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

const ROLLBACK = new Error("rollback");
try {
  await sql.begin(async (tx) => {
    const [co] = await tx`select id, name from company order by created_at limit 1`;
    const [loc] = await tx`select id from location where company_id = ${co.id} and is_stock_location and not is_quarantine and not is_transit and is_active order by code limit 1`;
    const [item] = await tx`select id, code from item where company_id = ${co.id} and is_stocked and not tracks_serial and not tracks_batch and is_active
         and not exists (select 1 from item c where c.parent_item_id = item.id)
         and not exists (select 1 from stock_movement m where m.item_id = item.id) order by code limit 1`;
    const [supp] = await tx`select id from business_partner where company_id = ${co.id} and is_supplier order by code limit 1`;
    const [cust] = await tx`select id from business_partner where company_id = ${co.id} and is_customer order by code limit 1`;
    const [cash] = await tx`select id from account where company_id = ${co.id} and is_cash_account and not is_bank_account and is_postable order by code limit 1`;
    const [promo] = await tx`select id, account_id from foc_reason where company_id = ${co.id} and applies_to = 'SALE' and code = 'PROMOTION'`;
    const today = new Date().toISOString().slice(0, 10);
    // The company-wide reconciliation as found: another suite may have left
    // its own gap, so what is checked is that these documents add none.
    const gapNow = async () => (await tx`select coalesce(sum(gl_balance - stock_value), 0)::float as g
                                          from v_check_inventory_reconciliation`)[0].g;
    const gapBefore = await gapNow();
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const [promoAcct] = await tx`select code from account where id = ${promo.account_id}`;
    console.log(`\n  ${co.name}  ·  ${item.code}  ·  giveaways to ${promoAcct.code}  ·  rolled back at the end\n`);

    const posted = async (docId) => Object.fromEntries((await tx`
      select a.code, sum(jl.base_amount)::float as v from journal_line jl
        join journal_entry je on je.id = jl.journal_entry_id join account a on a.id = jl.account_id
       where je.source_id = ${docId} group by a.code`).map((r) => [r.code, Math.round(r.v * 100) / 100]));
    const outstanding = async (id) => Number((await tx`select outstanding from v_open_item where document_id = ${id}`)[0]?.outstanding ?? 0);
    const sale = (lines, extra = {}) => P.postSalesInvoice({ companyId: co.id, partnerId: cust.id, locationId: loc.id,
      docDate: today, dueDate: today, paymentType: "CREDIT", allowOverCreditLimit: true, creditOverrideReason: "test",
      issueStock: true, lines, ...extra }, tx);

    // Stock to sell: 30 at 1,000.
    await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: yesterday,
      lines: [{ itemId: item.id, qty: 30, unitCost: 1000 }] }, tx);

    // 1 -------------------------------------------------------------------------
    console.log("  1. credit notes after the sale\n");
    const s1 = await sale([{ itemId: item.id, qty: 2, unitPrice: 5000 }]);
    const c1 = await P.postCreditNote({ companyId: co.id, partnerId: cust.id, docDate: today, sourceDocumentId: s1.id,
      amount: 1000, category: "DISCOUNT", reason: "Loyalty discount agreed after the sale" }, tx);
    const j1 = await posted(c1.id);
    check("DISCOUNT: Dr 4190 Sales Discounts 1,000 / Cr receivable", j1["4190"] === 1000 && j1["1210"] === -1000 && !j1["4180"], JSON.stringify(j1));
    const c1b = await P.postCreditNote({ companyId: co.id, partnerId: cust.id, docDate: today, sourceDocumentId: s1.id,
      amount: 500, category: "BILLING_ERROR", reason: "Overcharged" }, tx);
    const j1b = await posted(c1b.id);
    check("BILLING_ERROR: Dr 4180 Sales Returns", j1b["4180"] === 500 && !j1b["4190"], JSON.stringify(j1b));
    check("  the invoice owes 8,500", (await outstanding(s1.id)) === 8500);

    // 2 -------------------------------------------------------------------------
    console.log("\n  2. a discount on an invoice already paid\n");
    const s2 = await sale([{ itemId: item.id, qty: 1, unitPrice: 5000 }], { paymentType: "CASH", cashIn: 5000, cashAccountId: cash.id });
    check("paid in full", (await outstanding(s2.id)) === 0);
    const c2 = await P.postCreditNote({ companyId: co.id, partnerId: cust.id, docDate: today, sourceDocumentId: s2.id,
      amount: 700, category: "DISCOUNT", reason: "Price match" }, tx);
    check("the note posts and leaves the customer 700 in credit", (await outstanding(s2.id)) === -700, String(await outstanding(s2.id)));
    const { refundable } = await P.refundableOnReturn(tx, c2.id);
    check("  Refund can pay out the 700", refundable === 700, String(refundable));
    const f2 = await P.postCustomerRefund({ companyId: co.id, returnId: c2.id, docDate: today, cashAccountId: cash.id, amount: 700 }, tx);
    const jf = await posted(f2.id);
    check("  refund: Dr receivable / Cr cash 700, the invoice settles", jf["1210"] === 700 && Object.values(jf).includes(-700) && (await outstanding(s2.id)) === 0, JSON.stringify(jf));

    // 3 -------------------------------------------------------------------------
    console.log("\n  3. no further than the sale\n");
    const e3 = await refused(() => P.postCreditNote({ companyId: co.id, partnerId: cust.id, docDate: today, sourceDocumentId: s2.id,
      amount: 4400, category: "DISCOUNT", reason: "Too much" }, tx));
    check("a note past what is left of the sale (4,300) is refused", /left after earlier/.test(e3 ?? ""), e3 ?? "posted");

    // 4 -------------------------------------------------------------------------
    console.log("\n  4. deliver later, discount before the goods go\n");
    const s4 = await P.postSalesInvoice({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
      toDeliver: true, paymentType: "CREDIT", allowOverCreditLimit: true, creditOverrideReason: "test",
      lines: [{ itemId: item.id, qty: 4, unitPrice: 5000 }] }, tx);
    const c4 = await P.postCreditNote({ companyId: co.id, partnerId: cust.id, docDate: today, sourceDocumentId: s4.id,
      amount: 2000, category: "DISCOUNT", reason: "Discount before dispatch" }, tx);
    const j4 = await posted(c4.id);
    check("the note comes off 2230, not Sales", j4["2230"] === 2000 && !j4["4110"] && !j4["4190"], JSON.stringify(j4));
    const [l4] = await tx`select id from document_line where document_id = ${s4.id}`;
    const d4 = await P.postDelivery({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, sourceDocumentId: s4.id,
      lines: [{ itemId: item.id, qty: 4, sourceLineId: l4.id }] }, tx);
    const jd4 = await posted(d4.id);
    check("delivery: Sales at the full 20,000, Sales Discounts 2,000", jd4["4110"] === -20000 && jd4["4190"] === 2000 && jd4["2230"] === 18000, JSON.stringify(jd4));

    // 5 -------------------------------------------------------------------------
    console.log("\n  5. a free item with a sale\n");
    const s5 = await sale([{ itemId: item.id, qty: 1, unitPrice: 5000 }, { itemId: item.id, qty: 1, unitPrice: 0, focReasonId: promo.id }]);
    const j5 = await posted(s5.id);
    check("both units' cost to 5110 (2,000), nothing to the promotion account", j5["5110"] === 2000 && !j5[promoAcct.code], JSON.stringify(j5));
    const [fl] = await tx`select foc_reason_id from document_line where document_id = ${s5.id} and foc_reason_id is not null`;
    check("  the reason stays on the line for the FOC reports", fl?.foc_reason_id === promo.id);

    // 6 -------------------------------------------------------------------------
    console.log("\n  6. a standalone giveaway, and free goods on a delivery with a sale\n");
    const d6 = await P.postDelivery({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today,
      lines: [{ itemId: item.id, qty: 2, unitPrice: 0, focReasonId: promo.id }] }, tx);
    const j6 = await posted(d6.id);
    check(`giveaway: 2,000 to ${promoAcct.code}, nothing to cost of sales`, j6[promoAcct.code] === 2000 && !j6["5110"] && !j6["1420"], JSON.stringify(j6));
    const d6b = await P.postDelivery({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today,
      lines: [{ itemId: item.id, qty: 1, unitPrice: 5000 }, { itemId: item.id, qty: 1, unitPrice: 0, focReasonId: promo.id }] }, tx);
    const j6b = await posted(d6b.id);
    check("with a sold line: the free unit to 5110, the sold one waits in 1420", j6b["5110"] === 1000 && j6b["1420"] === 1000 && !j6b[promoAcct.code], JSON.stringify(j6b));

    // 7 -------------------------------------------------------------------------
    console.log("\n  7. the free item comes back\n");
    const r7 = await P.postSalesReturn({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, sourceDocumentId: s5.id,
      lines: [{ itemId: item.id, qty: 1, unitPrice: 0, focReasonId: promo.id }] }, tx);
    const j7 = await posted(r7.id);
    check("its cost leaves 5110, not the promotion account", j7["5110"] === -1000 && !j7[promoAcct.code], JSON.stringify(j7));

    // 8 -------------------------------------------------------------------------
    console.log("\n  8. IFRS 15: a phone and a free case share the sale by list price\n");
    const [caseItem] = await tx`select id, code, base_uom_id from item where company_id = ${co.id} and is_stocked and not tracks_serial
         and not tracks_batch and is_active and id <> ${item.id}
         and not exists (select 1 from item c where c.parent_item_id = item.id) order by code limit 1`;
    const [phoneUom] = await tx`select base_uom_id from item where id = ${item.id}`;
    const [lvl] = await tx`select id from price_level where company_id = ${co.id} order by (code = 'RETAIL') desc, sort_order, code limit 1`;
    for (const [it, uom, price] of [[item.id, phoneUom.base_uom_id, 1_000_000], [caseItem.id, caseItem.base_uom_id, 50_000]]) {
      await tx`insert into item_price (company_id, item_id, price_level_id, uom_id, currency, price, valid_from)
               values (${co.id}, ${it}, ${lvl.id}, ${uom}, 'MMK', ${price}, ${yesterday}::date)`;
    }
    await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: yesterday,
      lines: [{ itemId: caseItem.id, qty: 5, unitCost: 10_000 }] }, tx);
    const s8 = await sale([{ itemId: item.id, qty: 1, unitPrice: 1_000_000 }, { itemId: caseItem.id, qty: 1, unitPrice: 0, focReasonId: promo.id }]);
    const l8 = await tx`select net_amount::float as net, revenue_amount::float as rev from document_line where document_id = ${s8.id} order by line_no`;
    check("the invoice still charges 1,000,000 and the case 0", l8[0].net === 1_000_000 && l8[1].net === 0, JSON.stringify(l8));
    check("revenue split 952,381 / 47,619 by list price", Math.abs(l8[0].rev - 952381) <= 1 && Math.abs(l8[1].rev - 47619) <= 1, JSON.stringify(l8));
    check("  together exactly 1,000,000", l8[0].rev + l8[1].rev === 1_000_000);
    const j8 = await posted(s8.id);
    check("  the ledger: 4110 credited 1,000,000 in all", j8["4110"] === -1_000_000, JSON.stringify(j8));
    const s8b = await sale([{ itemId: item.id, qty: 1, unitPrice: 1_000_000 }]);
    const [l8b] = await tx`select revenue_amount from document_line where document_id = ${s8b.id}`;
    check("  no free line: no allocation recorded", l8b.revenue_amount === null);

    // 9 (brief 1) ------------------------------------------------------------
    console.log("");
    console.log("  9. a discount on the invoice itself");
    console.log("");
    const s9 = await sale([{ itemId: item.id, qty: 2, unitPrice: 5000, discountPct: 10 }]);
    const j9 = await posted(s9.id);
    check("Sales at the full 10,000, 1,000 to 4190, receivable 9,000", j9["4110"] === -10000 && j9["4190"] === 1000 && j9["1210"] === 9000, JSON.stringify(j9));

    // 10 (brief 14) ----------------------------------------------------------
    console.log("");
    console.log("  10. the report against the books, nothing counted twice");
    console.log("");
    const s10 = await P.postSalesInvoice({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
      toDeliver: true, paymentType: "CREDIT", allowOverCreditLimit: true, creditOverrideReason: "test",
      lines: [{ itemId: item.id, qty: 1, unitPrice: 5000 }, { itemId: item.id, qty: 1, unitPrice: 0, focReasonId: promo.id }] }, tx);
    const l10 = await tx`select id from document_line where document_id = ${s10.id} order by line_no`;
    await P.postDelivery({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, sourceDocumentId: s10.id,
      lines: [{ itemId: item.id, qty: 1, sourceLineId: l10[0].id }, { itemId: item.id, qty: 1, unitPrice: 0, focReasonId: promo.id, sourceLineId: l10[1].id }] }, tx);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const rep = await discountReport(co.id, "sales", today, tomorrow, null, tx);
    const mine = (id) => rep.free.filter((f) => f.document_id === id).length;
    const [d10] = await tx`select id from document where source_document_id = ${s10.id} and doc_type = 'DELIVERY'`;
    check("the deliver-later free unit counted once (on its delivery)", mine(s10.id) + mine(d10.id) === 1, `${mine(s10.id)} + ${mine(d10.id)}`);
    const [gl] = await tx`select coalesce(sum(jl.base_amount), 0)::float as v from journal_line jl
      join journal_entry je on je.id = jl.journal_entry_id join account a on a.id = jl.account_id
      where a.code = '4190' and je.entry_date = ${today}::date and jl.company_id = ${co.id}`;
    check("discounts in the report = 4190 in the ledger for the day", Math.abs(rep.totals.total - gl.v) < 0.01, `${rep.totals.total} vs ${gl.v}`);
    check("  and the report reads the same as the ledger figure it shows", Math.abs(rep.ledger[0].v - gl.v) < 0.01);
    const gapAfter = await gapNow();
    check("stock ledger and inventory account tie (no new gap)", Math.abs(gapAfter - gapBefore) < 0.01, `before ${gapBefore}, after ${gapAfter}`);

    throw ROLLBACK;
  });
} catch (e) {
  if (e !== ROLLBACK) { bad++; console.error("\n  ERROR", e); }
} finally {
  await sql.end();
}
console.log(bad ? `\n  ${bad} failed\n` : "\n  all passed — nothing kept\n");
process.exit(bad ? 1 : 0);

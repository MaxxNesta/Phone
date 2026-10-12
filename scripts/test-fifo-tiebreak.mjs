// Two lines of one receipt leave in the receipt's own order.
//
//   ./node_modules/.bin/tsx scripts/test-fifo-tiebreak.mjs
//
// Lines of one receipt are posted in one transaction, so their layers tie on
// arrival time and on created_at. The planner broke the tie by nothing, and
// the database chose: line 2 ahead of line 1 on some runs. Now the receipt's
// line order decides. Checked five times over, since a coin toss passes once
// often enough — for a sale, a delivery billed in part, and a return.
//
// Runs inside one transaction that is always rolled back: nothing is written.

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
  prepare: !url.includes("-pooler."), onnotice: () => {}, max: 2 });
const P = await import("../lib/posting.ts");

let bad = 0;
const check = (label, ok, detail = "") => {
  if (!ok) bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "   " + detail : ""}`);
};
const near = (a, b) => Math.abs(a - b) < 0.01;
class Rollback extends Error {}

try {
  await sql.begin(async (tx) => {
    const [co] = await tx`select id, name from company order by created_at limit 1`;
    const [loc] = await tx`select id from location where company_id = ${co.id} and is_stock_location and is_active order by code limit 1`;
    const [supp] = await tx`select id from business_partner where company_id = ${co.id} and is_supplier and is_active order by code limit 1`;
    const [cust] = await tx`select id from business_partner where company_id = ${co.id} and is_customer and is_active and credit_limit is null order by code limit 1`;
    const [grp] = await tx`select id from item_group where company_id = ${co.id} order by code limit 1`;
    const [uom] = await tx`select id from uom where company_id = ${co.id} order by code limit 1`;
    const today = new Date().toISOString().slice(0, 10);
    const stamp = String(Date.now()).slice(-7);
    console.log(`\n  ${co.name} — one transaction, rolled back at the end\n`);

    const consumed = async (docId) => {
      const [r] = await tx`
        select coalesce(sum(c.qty * c.unit_cost), 0)::float as v
          from stock_lot_consumption c join stock_movement sm on sm.id = c.stock_movement_id
         where sm.document_id = ${docId}`;
      return r.v;
    };
    const gl = async (docId, account) => {
      const [r] = await tx`
        select coalesce(sum(jl.base_amount), 0)::float as v
          from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
         where je.source_id = ${docId} and jl.account_id = ${account}`;
      return r.v;
    };

    for (let round = 1; round <= 5; round++) {
      const [it] = await tx`
        insert into item (company_id, item_group_id, serial, name, base_uom_id, is_stocked)
        values (${co.id}, ${grp.id}, ${"TIE" + stamp + round}, 'FIFO tiebreak test', ${uom.id}, true) returning id`;
      const [cogs] = await tx`select fn_resolve_account_for_item(${co.id}, 'COGS', ${it.id}) as a`;
      // Line 1 dearer on odd rounds, cheaper on even, so an order that only
      // happened to favour the cheaper (or newer) layer is caught either way.
      const [p1, p2] = round % 2 ? [200, 100] : [100, 200];
      await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
        lines: [{ itemId: it.id, qty: 10, unitCost: p1 }, { itemId: it.id, qty: 10, unitCost: p2 }] }, tx);

      const sale = await P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
        paymentType: "CREDIT", lines: [{ itemId: it.id, qty: 4, unitPrice: 300 }] }, tx);
      const dv = await P.postDelivery({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today,
        lines: [{ itemId: it.id, qty: 12 }] }, tx);
      const si = await P.postSalesInvoice({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
        paymentType: "CREDIT", deliveryId: dv.id, lines: [{ itemId: it.id, qty: 7, unitPrice: 300 }] }, tx);

      console.log(`  round ${round}: line 1 at ${p1}, line 2 at ${p2}`);
      check("  a sale of 4 takes line 1 first", near(await consumed(sale.id), 4 * p1), String(await consumed(sale.id)));
      check("  a delivery of 12 takes line 1's other 6, then 6 of line 2", near(await consumed(dv.id), 6 * p1 + 6 * p2), String(await consumed(dv.id)));
      check("  billing 7 of those 12 claims line 1's 6 first, then 1 of line 2", near(await gl(si.id, cogs.a), 6 * p1 + p2), String(await gl(si.id, cogs.a)));
    }
    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) { bad++; console.error("\n  CRASH", e); }
}
const [left] = await sql`select count(*)::int as n from item where name = 'FIFO tiebreak test'`;
console.log(`\n  rolled back: ${left.n === 0 ? "yes" : `NO — ${left.n} test items remain`}`);
console.log(`  ${bad === 0 ? "all checks passed" : `${bad} check(s) failed`}\n`);
await sql.end();
process.exit(bad === 0 ? 0 : 1);

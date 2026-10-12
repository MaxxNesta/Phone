// A supplier bill that disagrees with the receipt corrects the receipt line it
// bills, and only that line.
//
//   ./node_modules/.bin/tsx scripts/test-bill-cost-by-line.mjs
//
// Before: the correction was matched by receipt and item, so a receipt with
// three phones on three lines spread one phone's correction over all three.
// Also covers the split between units still on the shelf (inventory), units
// already sold (cost of sales) and units that covered a shortage (the
// shortage's account), and that nothing falls to price variance that has goods
// behind it.
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
const fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 4 });
const luhn = (body) => {
  let sum = 0;
  for (let i = 0; i < 14; i++) { let d = Number(body[13 - i]); if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return body + ((10 - (sum % 10)) % 10);
};
class Rollback extends Error {}

try {
  await sql.begin(async (tx) => {
    const [co] = await tx`select id, name from company order by created_at limit 1`;
    const [loc] = await tx`select id from location where company_id = ${co.id} and is_stock_location and is_active order by code limit 1`;
    const [supp] = await tx`select id from business_partner where company_id = ${co.id} and is_supplier and is_active order by code limit 1`;
    const [cust] = await tx`select id from business_partner where company_id = ${co.id} and is_customer and is_active and credit_limit is null order by code limit 1`;
    const [grp] = await tx`select id from item_group where company_id = ${co.id} order by code limit 1`;
    const [uom] = await tx`select id from uom where company_id = ${co.id} order by code limit 1`;
    const [ppv] = await tx`select fn_system_account(${co.id}, 'PURCHASE_PRICE_VARIANCE') as a`;
    const today = new Date().toISOString().slice(0, 10);
    const stamp = String(Date.now()).slice(-7);
    console.log(`\n  ${co.name} — one transaction, rolled back at the end`);

    let n = 0;
    const newItem = async (phone) => {
      const [it] = await tx`
        insert into item (company_id, item_group_id, serial, name, base_uom_id, is_stocked, tracks_serial, identity)
        values (${co.id}, ${grp.id}, ${"BCL" + stamp + n++}, 'Bill-by-line test', ${uom.id}, true, ${phone}, ${phone ? "IMEI" : "NONE"})
        returning id`;
      const [inv] = await tx`select fn_resolve_account_for_item(${co.id}, 'INVENTORY', ${it.id}) as a`;
      const [cogs] = await tx`select fn_resolve_account_for_item(${co.id}, 'COGS', ${it.id}) as a`;
      return { id: it.id, inv: inv.a, cogs: cogs.a };
    };
    const imei = (k) => luhn("35" + stamp + String(k).padStart(5, "0"));
    const lineCost = async (lineId) => {
      const [r] = await tx`
        select (l.unit_cost + coalesce((select sum(a.delta_unit_cost) from stock_lot_adjustment a where a.lot_id = l.id), 0))::float as c
          from stock_lot l join stock_movement sm on sm.id = l.stock_movement_id
         where sm.document_line_id = ${lineId}`;
      return r?.c;
    };
    const gl = async (docId, account) => {
      const [r] = await tx`
        select coalesce(sum(jl.base_amount), 0)::float as v
          from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
         where je.source_id = ${docId} and jl.account_id = ${account}`;
      return r.v;
    };
    const reconciles = async (itemId) => {
      const [l] = await tx`
        select coalesce(sum((l.qty_received - coalesce((select sum(c.qty) from stock_lot_consumption c where c.lot_id = l.id), 0))
                 * (l.unit_cost + coalesce((select sum(a.delta_unit_cost) from stock_lot_adjustment a where a.lot_id = l.id), 0))), 0)::float as v
          from stock_lot l where l.item_id = ${itemId}`;
      const [m] = await tx`select coalesce(sum(total_cost), 0)::float as v from stock_movement where item_id = ${itemId}`;
      return { ok: near(l.v, m.v), detail: `layers ${fmt(l.v)}, stock ledger ${fmt(m.v)}` };
    };
    const lines = async (docId) => (await tx`select id from document_line where document_id = ${docId} order by line_no`).map((r) => r.id);
    const bill = (grId, ls, prices) => P.postPurchaseInvoice({
      companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today, dueDate: today,
      goodsReceiptId: grId,
      lines: ls.map((id, i) => ({ itemId: prices[i][0], qty: prices[i][1], unitPrice: prices[i][2], sourceLineId: id })),
    }, tx);
    const scenario = async (title, fn) => {
      console.log(`\n  ${title}`);
      try { await tx.savepoint(fn); } catch (e) { check("posted", false, e.message); }
    };
    const [before] = await tx`select coalesce(sum(difference), 0)::float as d from v_check_inventory_reconciliation where company_id = ${co.id}`;

    await scenario("1. Three phones on three lines; the bill corrects only the middle one, +300,000", async () => {
      const it = await newItem(true);
      const gr = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
        lines: [1, 2, 3].map((k) => ({ itemId: it.id, qty: 1, unitCost: 1_000_000, serials: [imei(k)] })) }, tx);
      const ls = await lines(gr.id);
      const pi = await bill(gr.id, ls, [[it.id, 1, 1_000_000], [it.id, 1, 1_300_000], [it.id, 1, 1_000_000]]);
      const [d, e, f] = [await lineCost(ls[0]), await lineCost(ls[1]), await lineCost(ls[2])];
      check("the corrected phone costs 1,300,000", near(e, 1_300_000), fmt(e));
      check("the other two are untouched at 1,000,000", near(d, 1_000_000) && near(f, 1_000_000), `${fmt(d)}, ${fmt(f)}`);
      check("Dr Inventory 300,000", near(await gl(pi.id, it.inv), 300_000), fmt(await gl(pi.id, it.inv)));
      check("nothing to price variance", near(await gl(pi.id, ppv.a), 0), fmt(await gl(pi.id, ppv.a)));
      const r = await reconciles(it.id); check("layers = stock ledger", r.ok, r.detail);
    });

    await scenario("2. The same, but the corrected phone was sold before the bill came", async () => {
      const it = await newItem(true);
      const gr = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
        lines: [11, 12, 13].map((k) => ({ itemId: it.id, qty: 1, unitCost: 1_000_000, serials: [imei(k)] })) }, tx);
      const ls = await lines(gr.id);
      await P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
        paymentType: "CREDIT", lines: [{ itemId: it.id, qty: 1, unitPrice: 1_500_000, serials: [imei(12)] }] }, tx);
      const pi = await bill(gr.id, ls, [[it.id, 1, 1_000_000], [it.id, 1, 1_300_000], [it.id, 1, 1_000_000]]);
      check("the 300,000 goes to cost of sales: that phone is gone", near(await gl(pi.id, it.cogs), 300_000), fmt(await gl(pi.id, it.cogs)));
      check("inventory does not move", near(await gl(pi.id, it.inv), 0), fmt(await gl(pi.id, it.inv)));
      check("the phones still on the shelf stay at 1,000,000", near(await lineCost(ls[0]), 1_000_000) && near(await lineCost(ls[2]), 1_000_000));
      check("nothing to price variance", near(await gl(pi.id, ppv.a), 0));
      const r = await reconciles(it.id); check("layers = stock ledger", r.ok, r.detail);
    });

    await scenario("3. Untracked goods, two lines of one item (10 at 100, 10 at 200); 15 sold; line 2 billed at 230", async () => {
      const it = await newItem(false);
      const gr = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
        lines: [{ itemId: it.id, qty: 10, unitCost: 100 }, { itemId: it.id, qty: 10, unitCost: 200 }] }, tx);
      const ls = await lines(gr.id);
      await P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
        paymentType: "CREDIT", lines: [{ itemId: it.id, qty: 15, unitPrice: 300 }] }, tx);
      const pi = await bill(gr.id, ls, [[it.id, 10, 100], [it.id, 10, 230]]);
      check("line 1's layer is untouched at 100", near(await lineCost(ls[0]), 100), fmt(await lineCost(ls[0])));
      check("line 2's layer is 230", near(await lineCost(ls[1]), 230), fmt(await lineCost(ls[1])));
      check("the 5 still on the shelf: Dr Inventory 150", near(await gl(pi.id, it.inv), 150), fmt(await gl(pi.id, it.inv)));
      check("the 5 of line 2 already sold: Dr Cost of sales 150", near(await gl(pi.id, it.cogs), 150), fmt(await gl(pi.id, it.cogs)));
      check("nothing to price variance", near(await gl(pi.id, ppv.a), 0), fmt(await gl(pi.id, ppv.a)));
      const r = await reconciles(it.id); check("layers = stock ledger", r.ok, r.detail);
    });

    await scenario("4. A receipt that first covers a shortage: 4 sold short, then 10 received at 100, billed at 120", async () => {
      const it = await newItem(false);
      await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
        lines: [{ itemId: it.id, qty: 2, unitCost: 100 }] }, tx);
      await P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
        paymentType: "CREDIT", allowNegativeStock: true, negativeStockReason: "test: on the shelf, not yet received",
        lines: [{ itemId: it.id, qty: 6, unitPrice: 300 }] }, tx);
      const gr = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
        lines: [{ itemId: it.id, qty: 10, unitCost: 100 }] }, tx);
      const ls = await lines(gr.id);
      const pi = await bill(gr.id, ls, [[it.id, 10, 120]]);
      check("the 6 on the shelf are 120 each, not 133.33", near(await lineCost(ls[0]), 120), fmt(await lineCost(ls[0])));
      check("Dr Inventory 120 (6 × 20)", near(await gl(pi.id, it.inv), 120), fmt(await gl(pi.id, it.inv)));
      check("the 4 that covered the shortage: Dr Cost of sales 80", near(await gl(pi.id, it.cogs), 80), fmt(await gl(pi.id, it.cogs)));
      check("nothing to price variance", near(await gl(pi.id, ppv.a), 0), fmt(await gl(pi.id, ppv.a)));
      const r = await reconciles(it.id); check("layers = stock ledger", r.ok, r.detail);
    });

    await scenario("5. A bill for more than arrived is refused, and nothing moves", async () => {
      const it = await newItem(false);
      const gr = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
        lines: [{ itemId: it.id, qty: 10, unitCost: 100 }] }, tx);
      const ls = await lines(gr.id);
      let err = null;
      try { await tx.savepoint(() => bill(gr.id, ls, [[it.id, 12, 100]])); } catch (e) { err = e; }
      check("refused", !!err && /left to bill/.test(err.message), err ? err.message : "it posted");
      check("the layer is unchanged at 100", near(await lineCost(ls[0]), 100), fmt(await lineCost(ls[0])));
    });

    const [after] = await tx`select coalesce(sum(difference), 0)::float as d from v_check_inventory_reconciliation where company_id = ${co.id}`;
    console.log("");
    check("company: Inventory GL − stock ledger unchanged", near(after.d, before.d), `before ${fmt(before.d)}, after ${fmt(after.d)}`);
    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) { bad++; console.error("\n  CRASH", e); }
}
const [left] = await sql`select count(*)::int as n from item where name = 'Bill-by-line test'`;
console.log(`\n  rolled back: ${left.n === 0 ? "yes" : `NO — ${left.n} test items remain`}`);
console.log(`  ${bad === 0 ? "all checks passed" : `${bad} check(s) failed`}\n`);
await sql.end();
process.exit(bad === 0 ? 0 : 1);

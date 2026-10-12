// Read-only audit: what does an IMEI-tracked phone cost when it is sold?
//
//   ./node_modules/.bin/tsx scripts/audit-imei-costing.mjs
//
// Everything — the item, the receipts, the sales, the returns — happens inside
// one transaction that is always rolled back, so nothing is left in the
// database and nothing already there is touched. Each scenario runs in its own
// savepoint, so one that the engine refuses is reported and the rest still run.
//
// It measures and prints; it asserts only what the audit claims, so a FAIL is
// a finding, not a broken test.

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
const note = (s) => console.log(`        ${s}`);
const fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
const luhn = (body) => {
  let sum = 0;
  for (let i = 0; i < 14; i++) { let d = Number(body[13 - i]); if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return body + ((10 - (sum % 10)) % 10);
};
class Rollback extends Error {}

const A = 2_000_000, B = 2_150_000, C = 2_100_000;

try {
  await sql.begin(async (tx) => {
    const [co] = await tx`select id, name from company order by created_at limit 1`;
    const locs = await tx`select id, name from location where company_id = ${co.id} and is_stock_location and is_active order by code limit 2`;
    const loc = locs[0], loc2 = locs[1];
    const [supp] = await tx`select id from business_partner where company_id = ${co.id} and is_supplier and is_active order by code limit 1`;
    const [cust] = await tx`select id from business_partner where company_id = ${co.id} and is_customer and is_active and credit_limit is null order by code limit 1`;
    const [grp] = await tx`select id from item_group where company_id = ${co.id} order by code limit 1`;
    const [uom] = await tx`select id from uom where company_id = ${co.id} order by code limit 1`;
    const today = new Date().toISOString().slice(0, 10);
    const stamp = String(Date.now()).slice(-7);
    const [item] = await tx`
      insert into item (company_id, item_group_id, serial, name, base_uom_id, is_stocked, tracks_serial, identity)
      values (${co.id}, ${grp.id}, ${"AUD" + stamp}, 'Audit iPhone', ${uom.id}, true, true, 'IMEI') returning id`;
    const imei = (n) => luhn("35" + stamp + String(n).padStart(5, "0"));
    const [inv] = await tx`select fn_resolve_account_for_item(${co.id}, 'INVENTORY', ${item.id}) as a`;
    const [cogs] = await tx`select fn_resolve_account_for_item(${co.id}, 'COGS', ${item.id}) as a`;
    console.log(`\n  ${co.name} — one transaction, rolled back at the end\n`);

    // ---- helpers -----------------------------------------------------------
    const lotOf = async (sn) => {
      const [r] = await tx`
        select s.stock_lot_id as lot, l.unit_cost::float + coalesce((select sum(delta_unit_cost) from stock_lot_adjustment a where a.lot_id = l.id), 0)::float as cost,
               v.status, l.location_id
          from stock_serial s join stock_lot l on l.id = s.stock_lot_id
          join v_stock_serial v on v.serial_id = s.id
         where s.serial_no = ${sn}`;
      return r;
    };
    // What the documents consumed off the layers (the subledger's view of COGS).
    const consumed = async (docId) => {
      const [r] = await tx`
        select coalesce(sum(c.qty * c.unit_cost), 0)::float as v
          from stock_lot_consumption c join stock_movement sm on sm.id = c.stock_movement_id
         where sm.document_id = ${docId}`;
      return r.v;
    };
    // What the ledger posted to an account for a document.
    const gl = async (docId, account) => {
      const [r] = await tx`
        select coalesce(sum(jl.base_amount), 0)::float as v
          from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
         where je.source_id = ${docId} and jl.account_id = ${account}`;
      return r.v;
    };
    // The item's value three ways: open FIFO layers, the stock ledger, and
    // what is on the shelf by IMEI.
    const valuation = async () => {
      const [layers] = await tx`
        select coalesce(sum((l.qty_received - coalesce((select sum(c.qty) from stock_lot_consumption c where c.lot_id = l.id), 0))
                 * (l.unit_cost + coalesce((select sum(a.delta_unit_cost) from stock_lot_adjustment a where a.lot_id = l.id), 0))), 0)::float as v,
               coalesce(sum(l.qty_received - coalesce((select sum(c.qty) from stock_lot_consumption c where c.lot_id = l.id), 0)), 0)::float as q
          from stock_lot l where l.item_id = ${item.id}`;
      const [ledger] = await tx`select coalesce(sum(total_cost), 0)::float as v, coalesce(sum(qty), 0)::float as q from stock_movement where item_id = ${item.id}`;
      const shelf = await tx`select imei as serial_no from v_stock_serial where item_id = ${item.id} and status = 'IN_STOCK' order by imei`;
      return { layers: layers.v, layerQty: layers.q, ledger: ledger.v, ledgerQty: ledger.q, shelf: shelf.map((s) => s.serial_no) };
    };
    const [glBefore] = await tx`select * from v_check_inventory_reconciliation where company_id = ${co.id}`;
    const step = async (title, fn) => {
      console.log(`\n  ${title}`);
      try { await tx.savepoint(fn); } catch (e) { check("the engine posted it", false, e.message); }
    };
    const names = { [imei(1)]: "IMEI-A", [imei(2)]: "IMEI-B", [imei(3)]: "IMEI-C" };
    const label = (list) => list.map((s) => names[s] ?? s).join(", ") || "none";

    // ---- 1. receipt --------------------------------------------------------
    let gr;
    await step("1. Goods receipt: three identical iPhones, one line each at its own cost", async () => {
      gr = await P.postGoodsReceipt({
        companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
        lines: [
          { itemId: item.id, qty: 1, unitCost: A, serials: [imei(1)] },
          { itemId: item.id, qty: 1, unitCost: B, serials: [imei(2)] },
          { itemId: item.id, qty: 1, unitCost: C, serials: [imei(3)] },
        ],
      }, tx);
      for (const [n, cost] of [[1, A], [2, B], [3, C]]) {
        const l = await lotOf(imei(n));
        check(`${names[imei(n)]} points at a layer costing ${fmt(cost)}`, Math.abs(l.cost - cost) < 0.01, `layer ${l.lot.slice(0, 8)} = ${fmt(l.cost)}`);
      }
      const lots = new Set([await lotOf(imei(1)), await lotOf(imei(2)), await lotOf(imei(3))].map((l) => l.lot));
      check("each IMEI is on its own layer (one layer per GR line)", lots.size === 3);
    });

    // ---- 2. sell B first ---------------------------------------------------
    let sale;
    await step("2. Counter sale of IMEI-B first", async () => {
      sale = await P.postRetailSale({
        companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
        paymentType: "CREDIT",
        lines: [{ itemId: item.id, qty: 1, unitPrice: 2_500_000, serials: [imei(2)] }],
      }, tx);
      const cost = await consumed(sale.id);
      const dr = await gl(sale.id, cogs.a), cr = await gl(sale.id, inv.a);
      check("COGS = 2,150,000 (IMEI-B's own cost), not 2,000,000 (oldest layer)", Math.abs(cost - B) < 0.01, `consumed ${fmt(cost)}`);
      check("journal: Dr COGS 2,150,000", Math.abs(dr - B) < 0.01, `COGS ${fmt(dr)}`);
      check("journal: Cr Inventory 2,150,000", Math.abs(cr + B) < 0.01, `Inventory ${fmt(cr)}`);
      const v = await valuation();
      check("left on the shelf: IMEI-A and IMEI-C", label(v.shelf) === "IMEI-A, IMEI-C", label(v.shelf));
      check("remaining value 4,100,000 in layers and in the stock ledger", Math.abs(v.layers - (A + C)) < 0.01 && Math.abs(v.ledger - (A + C)) < 0.01,
        `layers ${fmt(v.layers)}, ledger ${fmt(v.ledger)}`);
      check("IMEI-A's layer untouched", (await lotOf(imei(1))).status === "IN_STOCK");
    });

    // ---- 3. return B -------------------------------------------------------
    let ret;
    await step("3. Customer returns IMEI-B against that sale", async () => {
      ret = await P.postSalesReturn({
        companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today,
        sourceDocumentId: sale.id,
        lines: [{ itemId: item.id, qty: 1, unitPrice: 2_500_000, serials: [imei(2)] }],
      }, tx);
      const l = await lotOf(imei(2));
      check("IMEI-B comes back in stock", l.status === "IN_STOCK", l.status);
      check("on a layer at its own cost, 2,150,000", Math.abs(l.cost - B) < 0.01, fmt(l.cost));
      const cr = await gl(ret.id, cogs.a), dr = await gl(ret.id, inv.a);
      check("journal: Dr Inventory 2,150,000 / Cr COGS 2,150,000", Math.abs(dr - B) < 0.01 && Math.abs(cr + B) < 0.01, `Inv ${fmt(dr)}, COGS ${fmt(cr)}`);
      const v = await valuation();
      check("value back to 6,250,000 in layers and ledger", Math.abs(v.layers - (A + B + C)) < 0.01 && Math.abs(v.ledger - (A + B + C)) < 0.01,
        `layers ${fmt(v.layers)}, ledger ${fmt(v.ledger)}`);
    });

    // ---- 4. sell B again and void ------------------------------------------
    await step("4. Sell IMEI-B again, then void that sale", async () => {
      const s2 = await P.postRetailSale({
        companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
        paymentType: "CREDIT",
        lines: [{ itemId: item.id, qty: 1, unitPrice: 2_500_000, serials: [imei(2)] }],
      }, tx);
      check("the second sale costs 2,150,000 too (the returned layer)", Math.abs((await consumed(s2.id)) - B) < 0.01, fmt(await consumed(s2.id)));
      await P.voidDocument({ documentId: s2.id, reason: "audit", goodsBack: true }, tx);
      const l = await lotOf(imei(2));
      check("after the void IMEI-B is in stock", l.status === "IN_STOCK", l.status);
      check("at 2,150,000", Math.abs(l.cost - B) < 0.01, fmt(l.cost));
      const v = await valuation();
      check("value 6,250,000 in layers and ledger, 3 units", Math.abs(v.layers - (A + B + C)) < 0.01 && Math.abs(v.ledger - (A + B + C)) < 0.01 && v.layerQty === 3 && v.ledgerQty === 3,
        `layers ${fmt(v.layers)} / ${v.layerQty}, ledger ${fmt(v.ledger)} / ${v.ledgerQty}`);
    });

    // ---- 5. transfer C -----------------------------------------------------
    if (loc2) await step(`5. Transfer IMEI-C to ${loc2.name}`, async () => {
      await P.postStockTransfer({
        companyId: co.id, fromLocationId: loc.id, toLocationId: loc2.id, docDate: today,
        lines: [{ itemId: item.id, qty: 1, serials: [imei(3)] }],
      }, tx);
      const l = await lotOf(imei(3));
      check("IMEI-C sits at the destination at 2,100,000", l.location_id === loc2.id && Math.abs(l.cost - C) < 0.01, fmt(l.cost));
      const v = await valuation();
      check("total value unchanged at 6,250,000", Math.abs(v.layers - (A + B + C)) < 0.01 && Math.abs(v.ledger - (A + B + C)) < 0.01);
      // Bring it back so the next steps have all three in one place.
      await P.postStockTransfer({
        companyId: co.id, fromLocationId: loc2.id, toLocationId: loc.id, docDate: today,
        lines: [{ itemId: item.id, qty: 1, serials: [imei(3)] }],
      }, tx);
    });

    // ---- 6. deliver all three, bill one ------------------------------------
    await step("6. Deliver all three on one delivery, then invoice only IMEI-B", async () => {
      const dv = await P.postDelivery({
        companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today,
        lines: [{ itemId: item.id, qty: 3, serials: [imei(2), imei(3), imei(1)] }],
      }, tx);
      check("the delivery relieves 6,250,000, each unit at its own cost", Math.abs((await consumed(dv.id)) - (A + B + C)) < 0.01, fmt(await consumed(dv.id)));
      let refusal = null;
      try {
        await tx.savepoint(() => P.postSalesInvoice({
          companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
          paymentType: "CREDIT", deliveryId: dv.id,
          lines: [{ itemId: item.id, qty: 1, unitPrice: 2_500_000 }],
        }, tx));
      } catch (e) { refusal = e; }
      check("billing one of the three without naming it is refused", !!refusal, refusal?.message ?? "it posted");
      const si = await P.postSalesInvoice({
        companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
        paymentType: "CREDIT", deliveryId: dv.id,
        lines: [{ itemId: item.id, qty: 1, unitPrice: 2_500_000, serials: [imei(2)] }],
      }, tx);
      const dr = await gl(si.id, cogs.a);
      check("an invoice naming IMEI-B claims 2,150,000 (specific identification)", Math.abs(dr - B) < 0.01, fmt(dr));
    });

    // ---- 7. supplier bills one line at a different price --------------------
    await step("7. A second receipt (D, E, F at 1,000,000 each, one line each); the bill corrects only E's line to 1,300,000", async () => {
      const gr2 = await P.postGoodsReceipt({
        companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
        lines: [4, 5, 6].map((n) => ({ itemId: item.id, qty: 1, unitCost: 1_000_000, serials: [imei(n)] })),
      }, tx);
      const lines = await tx`select id, line_no from document_line where document_id = ${gr2.id} order by line_no`;
      await P.postPurchaseInvoice({
        companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today, dueDate: today,
        goodsReceiptId: gr2.id,
        lines: [
          { itemId: item.id, qty: 1, unitPrice: 1_000_000, sourceLineId: lines[0].id },
          { itemId: item.id, qty: 1, unitPrice: 1_300_000, sourceLineId: lines[1].id },
          { itemId: item.id, qty: 1, unitPrice: 1_000_000, sourceLineId: lines[2].id },
        ],
      }, tx);
      const [d, e, f] = [await lotOf(imei(4)), await lotOf(imei(5)), await lotOf(imei(6))];
      note(`after the bill: D ${fmt(d.cost)}, E ${fmt(e.cost)}, F ${fmt(f.cost)}  (total ${fmt(d.cost + e.cost + f.cost)})`);
      check("total cost of the three is right (3,300,000)", Math.abs(d.cost + e.cost + f.cost - 3_300_000) < 1);
      check("E alone carries the 300,000 correction (specific identification)",
        Math.abs(e.cost - 1_300_000) < 1 && Math.abs(d.cost - 1_000_000) < 1 && Math.abs(f.cost - 1_000_000) < 1,
        Math.abs(d.cost - 1_100_000) < 1 ? "spread 100,000 to each of D, E, F" : "");
    });

    // ---- reconciliation ------------------------------------------------------
    console.log("\n  Reconciliation");
    const v = await valuation();
    check("item: open layers = stock ledger", Math.abs(v.layers - v.ledger) < 0.01 && v.layerQty === v.ledgerQty,
      `layers ${fmt(v.layers)} / ${v.layerQty}, ledger ${fmt(v.ledger)} / ${v.ledgerQty}`);
    const [byImei] = await tx`
      select count(*)::int as n from v_stock_serial where item_id = ${item.id} and status = 'IN_STOCK'`;
    check("item: units in stock by IMEI = units in the layers", byImei.n === v.layerQty, `${byImei.n} IMEIs, ${v.layerQty} in layers`);
    const [dup] = await tx`
      select count(*)::int as n from (
        select si.serial_id from stock_serial_issue si join stock_serial s on s.id = si.serial_id
         where s.item_id = ${item.id} and fn_serial_issue_stands(si.stock_movement_id)
         group by si.serial_id, si.consumption_id having count(*) > 1) x`;
    check("no IMEI issued twice against one consumption", dup.n === 0);
    const [glAfter] = await tx`select * from v_check_inventory_reconciliation where company_id = ${co.id}`;
    const before = Number(glBefore?.difference ?? 0), after = Number(glAfter?.difference ?? 0);
    check("company: Inventory GL − stock ledger did not move during the audit", Math.abs(after - before) < 0.01,
      `before ${fmt(before)}, after ${fmt(after)}`);

    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) { bad++; console.error("\n  CRASH", e); }
}
const [left] = await sql`select count(*)::int as n from item where name = 'Audit iPhone'`;
console.log(`\n  rolled back: ${left.n === 0 ? "yes, nothing left behind" : `NO — ${left.n} audit items remain`}`);
console.log(`  ${bad === 0 ? "all checks passed" : `${bad} check(s) failed — each FAIL is a finding`}\n`);
await sql.end();
process.exit(bad === 0 ? 0 : 1);

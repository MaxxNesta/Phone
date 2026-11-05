// Landed cost on goods without an IMEI: the receipt line carries its share,
// and posting follows the goods — stock value for what is on the shelf, cost
// of sales for what has been sold. Phones on the same receipt keep their
// share each. Reversal takes it all back out.
//
// Runs inside one transaction that is always rolled back, so it leaves
// nothing behind and can run on a database holding real data.
//
//   npx tsx scripts/test-landed-cost-lines.mjs

const { sql } = await import("../lib/db.ts");
const { postPurchaseWithReceipt, postSaleWithDelivery } = await import("../lib/posting.ts");
const L = await import("../lib/landed-cost.ts");

let failed = 0;
const check = (what, ok, got) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : `  (got ${JSON.stringify(got)})`}`); if (!ok) failed++; };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
class Rollback extends Error {}

try {
  await sql.begin(async (tx) => {
    const [co] = await tx`select id from company order by created_at limit 1`;
    const one = async (q) => (await q)[0];
    const charger = await one(tx`select id from item where company_id = ${co.id} and code = 'AKN01'`);
    const phone = await one(tx`select id from item where company_id = ${co.id} and code = 'IPC006'`);
    const wh = await one(tx`select id from location where company_id = ${co.id} and code = 'MAIN-WH'`);
    const supplier = await one(tx`select id from business_partner where company_id = ${co.id} and is_supplier order by code limit 1`);
    const customer = await one(tx`select id from business_partner where company_id = ${co.id} and is_customer order by code limit 1`);
    const user = await one(tx`select id from app_user where company_id = ${co.id} order by created_at limit 1`);
    const type = await one(tx`select id from landed_cost_type where company_id = ${co.id} and is_active order by name limit 1`);
    const day = new Date().toISOString().slice(0, 10);
    const actor = { companyId: co.id, userId: user?.id ?? null };

    await postPurchaseWithReceipt({
      companyId: co.id, partnerId: supplier.id, locationId: wh.id, docDate: day, dueDate: day,
      memo: "landed cost lines test", reference: null, cashOut: 0, cashAccountId: null,
      lines: [
        { itemId: charger.id, qty: 10, unitPrice: 80000 },
        { itemId: phone.id, qty: 2, unitPrice: 3000000, serials: ["990000000000017", "990000000000025"] },
      ],
    }, tx);
    const gr = await one(tx`select id from document where company_id = ${co.id} and doc_type = 'GOODS_RECEIPT'
                             and memo = 'landed cost lines test' order by created_at desc limit 1`);
    await postSaleWithDelivery({
      companyId: co.id, partnerId: customer.id, locationId: wh.id, docDate: day, dueDate: day,
      paymentType: "CREDIT", memo: null, reference: null, cashIn: 0, cashAccountId: null,
      lines: [{ itemId: charger.id, qty: 4, unitPrice: 95000 }],
    }, tx);

    // 120,000 equal per unit over 12 units: 10,000 each — 100,000 on the chargers' line, 10,000 per phone.
    const lc = await L.createLandedCost({ ...actor, docDate: day, receiptIds: [gr.id] }, tx);
    await L.saveLandedCost({ ...actor, id: lc.id, docDate: day, receiptIds: [gr.id],
      charges: [{ costTypeId: type.id, amount: 120000, method: "EQUAL" }] }, tx);
    const calc = await L.calculateLandedCost({ ...actor, id: lc.id }, tx);
    check("three units rows: one line, two phones", calc.units === 3, calc.units);
    const alloc = await tx`select serial_id, qty::float, amount::float from landed_cost_allocation where landed_cost_id = ${lc.id}`;
    const line = alloc.find((a) => !a.serial_id);
    check("the chargers' line carries 10 units and 100,000", line && line.qty === 10 && near(line.amount, 100000), line);
    check("each phone carries 10,000", alloc.filter((a) => a.serial_id).every((a) => near(a.amount, 10000)), alloc);

    const lot = await one(tx`select l.id from stock_lot l join stock_movement sm on sm.id = l.stock_movement_id
                              where sm.document_id = ${gr.id} and sm.item_id = ${charger.id}`);
    const before = await one(tx`select (l.unit_cost + coalesce((select sum(delta_unit_cost) from stock_lot_adjustment where lot_id = l.id), 0))::float as c
                                  from stock_lot l where l.id = ${lot.id}`);
    await L.postLandedCost({ ...actor, id: lc.id }, tx);
    const parts = await tx`select treatment, amount::float from landed_cost_posting where landed_cost_id = ${lc.id} and receipt_line_id is not null`;
    const inv = parts.filter((p) => p.treatment === "INVENTORY").reduce((s, p) => s + p.amount, 0);
    const cogs = parts.filter((p) => p.treatment === "COGS").reduce((s, p) => s + p.amount, 0);
    check("6 chargers on the shelf take 60,000 into stock value", near(inv, 60000), parts);
    check("4 chargers sold take 40,000 to cost of sales", near(cogs, 40000), parts);
    const after = await one(tx`select (l.unit_cost + coalesce((select sum(delta_unit_cost) from stock_lot_adjustment where lot_id = l.id), 0))::float as c
                                 from stock_lot l where l.id = ${lot.id}`);
    check("each charger now costs 10,000 more", near(after.c - before.c, 10000), [before.c, after.c]);
    const je = await one(tx`select sum(greatest(jl.base_amount, 0))::float as dr, sum(greatest(-jl.base_amount, 0))::float as cr
                              from journal_line jl join journal_entry e on e.id = jl.journal_entry_id
                             where e.source_id = ${lc.id}`);
    check("the entry balances at 120,000", near(je.dr, je.cr) && near(je.dr, 120000), je);

    const rev = await L.reverseLandedCost({ ...actor, id: lc.id, reason: "test", date: day }, tx);
    const net = await one(tx`select coalesce(sum(amount), 0)::float as v from landed_cost_posting where landed_cost_id = ${lc.id}`);
    check("the reversal takes every amount back out", near(net.v, 0), net);
    const back = await one(tx`select (l.unit_cost + coalesce((select sum(delta_unit_cost) from stock_lot_adjustment where lot_id = l.id), 0))::float as c
                                from stock_lot l where l.id = ${lot.id}`);
    check("the chargers' cost is back where it was", near(back.c, before.c), [before.c, back.c]);
    const rje = await one(tx`select sum(jl.base_amount)::float as v from journal_line jl join journal_entry e on e.id = jl.journal_entry_id
                              where e.source_id = ${rev.id}`);
    check("the reversing entry balances", near(rje.v, 0), rje);
    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) { console.error("  error:", e.message); failed++; }
} finally {
  await sql.end();
}
console.log(failed ? `\n  ${failed} failed\n` : "\n  all passed — rolled back, nothing kept\n");
process.exitCode = failed ? 1 : 0;

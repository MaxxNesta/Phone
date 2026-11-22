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
const { postPurchaseWithReceipt, postSaleWithDelivery, writeJournal } = await import("../lib/posting.ts");
const Q = await import("../lib/landed-cost-queries.ts");
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

    // What is left in clearing: a duty bill booked 40 days ago and never spread.
    const [clr] = await tx`select fn_system_account(${co.id}, 'LANDED_COST_CLEARING') as a`;
    const [vr] = await tx`select a.id, a.code from system_account s join account a on a.id = s.account_id
                           where s.company_id = ${co.id} and s.role = 'LANDED_COST_VARIANCE'`;
    check("Landed Cost Variance is mapped to 5940", vr?.code === "5940", vr);
    const cash = await one(tx`select id from account where company_id = ${co.id} and is_cash_account and is_postable and is_active order by code limit 1`);
    const old = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
    const billEntry = await writeJournal(tx, co.id, old, "TEST_BILL", crypto.randomUUID(), "duty bill test",
      [{ accountId: clr.a, amount: 50000, locationId: wh.id }, { accountId: cash.id, amount: -50000, locationId: wh.id }]);
    const bl = await one(tx`select id from journal_line where journal_entry_id = ${billEntry} and base_amount > 0`);
    const listed = async () => (await Q.clearingLeftovers(co.id, null, tx)).find((r) => r.id === bl.id);
    let lo = await listed();
    check("the unspread bill is listed: 50,000 left, 40 days old", lo && near(lo.left, 50000) && near(lo.used, 0) && lo.days >= 40, lo);
    const st = await Q.staleClearing(co.id, null, tx);
    check("and counted as over 30 days", st.n >= 1 && st.total >= 50000, st);

    const lc2 = await L.createLandedCost({ ...actor, docDate: day, receiptIds: [gr.id] }, tx);
    await L.saveLandedCost({ ...actor, id: lc2.id, docDate: day, receiptIds: [gr.id],
      charges: [{ costTypeId: type.id, sourceJournalLineId: bl.id, method: "EQUAL" }] }, tx);
    lo = await listed();
    check("a draft that holds it is named, and uses nothing yet", lo?.held === lc2.docNo && near(lo.left, 50000), lo);
    const held = await L.writeOffClearing({ ...actor, journalLineId: bl.id, reason: "t" }, tx).then(() => "went through", (e) => e.message);
    check("the write-off is refused while the draft holds it", /spreads this bill/.test(held), held);
    await L.deleteLandedCost({ ...actor, id: lc2.id }, tx);

    const wo = await L.writeOffClearing({ ...actor, journalLineId: bl.id, reason: "duty refund never came" }, tx);
    const wj = await tx`select account_id, base_amount::float as v from journal_line where journal_entry_id = ${wo.entryId} order by base_amount desc`;
    check("the write-off is Dr 5940 50,000 / Cr clearing 50,000",
      wj.length === 2 && wj[0].account_id === vr.id && near(wj[0].v, 50000) && wj[1].account_id === clr.a && near(wj[1].v, -50000), wj);
    check("and the bill leaves the list", !(await listed()), await listed());
    const again = await L.writeOffClearing({ ...actor, journalLineId: bl.id, reason: "t" }, tx).then(() => "went through", (e) => e.message);
    check("a second write-off finds nothing left", /Nothing is left/.test(again), again);

    await L.reverseClearingWriteOff({ ...actor, id: wo.id, reason: "bill found" }, tx);
    lo = await listed();
    check("reversing it puts the 50,000 back on the list", lo && near(lo.left, 50000), lo);
    const net5940 = await one(tx`select coalesce(sum(jl.base_amount), 0)::float as v from journal_line jl join journal_entry e on e.id = jl.journal_entry_id
                                  where e.source_type = 'LANDED_COST_WRITE_OFF' and e.source_id = ${wo.id}`);
    check("write-off and reversal net to nothing", near(net5940.v, 0), net5940);

    // Split by weight: two phones at 0.2 kg and a line of three charger boxes at 2 kg.
    await tx`update item set weight_kg = 0.2 where id = ${phone.id}`;
    await tx`update item set weight_kg = 2 where id = ${charger.id}`;
    await postPurchaseWithReceipt({
      companyId: co.id, partnerId: supplier.id, locationId: wh.id, docDate: day, dueDate: day,
      memo: "landed cost weight test", reference: null, cashOut: 0, cashAccountId: null,
      lines: [
        { itemId: charger.id, qty: 3, unitPrice: 80000 },
        { itemId: phone.id, qty: 2, unitPrice: 3000000, serials: [`98${String(Date.now()).slice(-13)}`, `97${String(Date.now()).slice(-13)}`] },
      ],
    }, tx);
    const wgr = await one(tx`select id from document where company_id = ${co.id} and doc_type = 'GOODS_RECEIPT'
                             and memo = 'landed cost weight test' order by created_at desc limit 1`);
    const wlc = await L.createLandedCost({ ...actor, docDate: day, receiptIds: [wgr.id] }, tx);
    // 6.4 kg in all: each phone 0.2/6.4, the boxes 6/6.4.
    await L.saveLandedCost({ ...actor, id: wlc.id, docDate: day, receiptIds: [wgr.id],
      charges: [{ costTypeId: type.id, amount: 100000, method: "WEIGHT" }, { costTypeId: type.id, amount: 77777, method: "WEIGHT" }] }, tx);
    await L.calculateLandedCost({ ...actor, id: wlc.id }, tx);
    const wa = await tx`select a.serial_id, a.amount::float, c.line_no from landed_cost_allocation a
                          join landed_cost_charge c on c.id = a.charge_id where a.landed_cost_id = ${wlc.id} order by c.line_no`;
    const ch1 = wa.filter((a) => a.line_no === 1), ch2 = wa.filter((a) => a.line_no === 2);
    check("by weight: each phone takes 3,125 of 100,000", ch1.filter((a) => a.serial_id).every((a) => near(a.amount, 3125)), ch1);
    check("by weight: the charger boxes take 93,750", near(ch1.find((a) => !a.serial_id)?.amount, 93750), ch1);
    const sum2 = ch2.reduce((t, a) => t + a.amount, 0);
    check("an uneven 77,777 still adds up exactly", Math.round(sum2 * 10000) === 777770000, [sum2, ch2]);
    check("and a box carries 10 times a phone (2 kg against 0.2)", ch2.filter((a) => a.serial_id).every((p) =>
      Math.abs(ch2.find((a) => !a.serial_id).amount / 3 / p.amount - 10) < 0.01), ch2);
    await tx`update item set weight_kg = null where id = ${phone.id}`;
    const phoneName = await one(tx`select name from item where id = ${phone.id}`);
    const noWeight = await L.calculateLandedCost({ ...actor, id: wlc.id }, tx).then(() => "went through", (e) => e.message);
    check("a phone with no weight is refused by name", /no weight on/.test(noWeight) && noWeight.includes(phoneName.name), noWeight);
    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) { console.error("  error:", e.message); failed++; }
} finally {
  await sql.end();
}
console.log(failed ? `\n  ${failed} failed\n` : "\n  all passed — rolled back, nothing kept\n");
process.exitCode = failed ? 1 : 0;

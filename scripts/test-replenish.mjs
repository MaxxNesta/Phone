// Self-check for lib/replenish.ts (no database): npx tsx scripts/test-replenish.mjs
import assert from "node:assert/strict";
const R = await import("../lib/replenish.ts");

assert.equal(R.roundToBuy(7, 10, null), 10);
assert.equal(R.roundToBuy(13, null, 5), 15);
assert.equal(R.roundToBuy(3, 4, 6), 6);
assert.equal(R.roundToBuy(0, 10, 5), 0);

const abc = R.classifyAbc(new Map([["a", 70], ["b", 20], ["c", 6], ["d", 4]]));
assert.deepEqual([...abc.values()], ["A", "A", "B", "C"]);
assert.equal(R.classifyXyz([5, 5, 5, 5]), "X");
assert.equal(R.classifyXyz([0, 0, 0, 20]), "Z");

const base = {
  stockByLocation: [], reserved: [], incoming: [], reorderPoints: [], supply: [], observed: [],
  windowDays: 30, coverDays: 30, here: () => true, fallbackLeadDays: 7, today: new Date("2026-11-11"),
};
const item = (id) => ({ id, code: id, name: id, uom_code: "PC", variant: null, last_purchase_price: 100 });
const steady = Array.from({ length: 91 }, (_, ago) => ({ item_id: "x", location_id: "L", ago, qty: 2, cost: 200 }));

// 2/day, lead 7, steady demand: safety 0, ROP 14, target 74. 10 on hand -> order 64, today-ish.
let { rows } = R.replenishment({ ...base, items: [item("x")], demand: steady,
  stockByLocation: [{ item_id: "x", location_id: "L", qty_on_hand: "10", value_on_hand: "1000" }] });
assert.equal(rows[0].perDay, 2); assert.equal(rows[0].safety, 0);
assert.equal(rows[0].rop, 14); assert.equal(rows[0].target, 74);
assert.equal(rows[0].suggest, 64); assert.equal(rows[0].status, "now");

// Same, MOQ 100 and pack 25 from the supplier.
({ rows } = R.replenishment({ ...base, items: [item("x")], demand: steady,
  stockByLocation: [{ item_id: "x", location_id: "L", qty_on_hand: "10" }],
  supply: [{ item_id: "x", supplier_id: "s", supplier_name: "S", supplier_days: 7, item_days: null, moq: 100, order_multiple: 25 }] }));
assert.equal(rows[0].suggest, 100); assert.equal(rows[0].leadSource, "supplier");

// Plenty on hand: nothing to buy; far too much: excess.
({ rows } = R.replenishment({ ...base, items: [item("x")], demand: steady,
  stockByLocation: [{ item_id: "x", location_id: "L", qty_on_hand: "500" }] }));
assert.equal(rows[0].suggest, 0); assert.equal(rows[0].status, "excess"); assert.equal(rows[0].excessQty, 426);

// No sales, stock on hand: dead.
({ rows } = R.replenishment({ ...base, items: [item("d")], demand: [],
  stockByLocation: [{ item_id: "d", location_id: "L", qty_on_hand: "4" }] }));
assert.equal(rows[0].status, "dead");

// MINMAX: below 5, order up to 20; MANUAL is never suggested.
({ rows } = R.replenishment({ ...base, items: [item("m")], demand: [],
  stockByLocation: [{ item_id: "m", location_id: "L", qty_on_hand: "2" }],
  reorderPoints: [{ item_id: "m", location_id: "L", min_qty: "5", max_qty: "20", method: "MINMAX" }] }));
assert.equal(rows[0].suggest, 18); assert.equal(rows[0].status, "soon");
({ rows } = R.replenishment({ ...base, items: [item("x")], demand: steady,
  reorderPoints: [{ item_id: "x", location_id: "L", min_qty: null, method: "MANUAL" }] }));
assert.equal(rows[0].suggest, 0); assert.equal(rows[0].status, "manual");

// Lumpy demand earns safety stock; a fixed figure overrides it.
const lumpy = [0, 7, 14, 21].map((ago) => ({ item_id: "x", location_id: "L", ago, qty: 30, cost: 1 }));
({ rows } = R.replenishment({ ...base, items: [item("x")], demand: lumpy }));
assert.ok(rows[0].safety > 0 && rows[0].safetySource === "calc", String(rows[0].safety));
({ rows } = R.replenishment({ ...base, items: [item("x")], demand: lumpy,
  reorderPoints: [{ item_id: "x", location_id: "L", min_qty: null, safety_qty: "3" }] }));
assert.equal(rows[0].safety, 3);
console.log("replenish: all checks pass");

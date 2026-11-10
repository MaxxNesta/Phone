// Price history trends: weighted averages, units kept apart, buckets.
//   npx tsx scripts/test-price-trends.mjs   (pure, no database)
import assert from "node:assert/strict";
const T = await import("../lib/price-trends.ts");
const L = (date, price, qty = 1, uom = "PCS", item_id = "a") => ({ date, item_id, item: "X", code: "X1", uom, qty, unit_base: price, doc_no: "D", partner: "P" });
const [x, carton] = T.productTrends([L("2026-01-01", 100, 1), L("2026-01-01", 200, 3), L("2026-01-05", 210), L("2026-01-03", 9999, 1, "CTN")])
  .sort((a, b) => a.uom.localeCompare(b.uom)).reverse();
assert.equal(x.first, 175);              // (100 + 600) / 4, weighted
assert.equal(x.last, 210);
assert.equal(x.low, 100); assert.equal(x.high, 210);
assert.equal(x.change, 0.2);
assert.deepEqual(x.spark, [175, 210]);
assert.equal(carton.lines, 1);           // carton never mixed with pieces
assert.equal(T.bucketOf("2026-01-01", "2026-01-31"), "day");
assert.equal(T.bucketOf("2026-01-01", "2026-05-01"), "week");
assert.equal(T.bucketOf("2025-01-01", "2026-01-01"), "month");
const tl = T.timeline([L("2026-11-10", 10), L("2026-11-12", 20)], "week"); // Tue + Thu, same week
assert.equal(tl.buckets.length, 1); assert.equal(tl.buckets[0].avg, 15); assert.deepEqual(tl.buckets[0].band, [10, 20]);
assert.equal(new Date(tl.buckets[0].t).getUTCDay(), 1);  // starts Monday
const same = T.timeline([L("2026-11-10", 10, 2), L("2026-11-10", 10, 3)], "day");
assert.equal(same.points.length, 1); assert.equal(same.points[0].qty, 5);   // one dot, quantities added
console.log("price-trends ok");

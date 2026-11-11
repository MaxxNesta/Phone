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
// Price changes: day against previous day, same-day lines averaged, no change no row.
const D = (date, price, qty = 1, doc = "D1", item_id = "a") => ({ ...L(date, price, qty, "PCS", item_id), doc_id: doc, doc_no: doc });
const ch = T.priceChanges([D("2026-01-01", 100), D("2026-01-02", 100), D("2026-01-03", 120, 1, "D2"), D("2026-01-03", 140, 1, "D3"), D("2026-01-05", 130), D("2026-01-06", 125)]);
assert.equal(ch.length, 2);                                   // 01→02 flat, 02→03 up (avg 130), 03→05 flat, 05→06 down
assert.equal(ch[0].date, "2026-01-06"); assert.equal(ch[0].change, -5);  // newest first
assert.equal(ch[1].date, "2026-01-03"); assert.equal(ch[1].prev, 100); assert.equal(ch[1].next, 130);
assert.deepEqual(ch[1].docs.map((d) => d.no), ["D2", "D3"]);
// Product totals and breakdowns.
assert.equal(x.qty, 5); assert.equal(x.avg, (100 + 600 + 210) / 5);      // weighted over the period
const parts = T.breakdown([{ ...L("2026-01-01", 100, 3), grp: "A" }, { ...L("2026-01-01", 200, 1), grp: "B" }, { ...L("2026-01-02", 120, 1), grp: "A" }, { ...L("2026-01-02", 1, 9), grp: null }], (l) => l.grp);
assert.deepEqual(parts.map((p) => [p.label, p.avg, p.qty]), [["A", 105, 4], ["B", 200, 1]]);   // ungrouped left out
assert.equal(parts[0].share, 0.8);
console.log("price-trends ok");

// Self-check for lib/stock-reasons.ts (no database): npx tsx scripts/test-stock-reasons.mjs
import assert from "node:assert/strict";
const { stockReasons, explainGap } = await import("../lib/stock-reasons.ts");
const roles = { cogsId: "cogs", heldId: "held" };
const mv = (o) => ({ account_id: null, code: null, name: null, account_type: null, voided: false, into_stock: 0, out_of_stock: 0, entries: 1, ...o });
const { additions, releases } = stockReasons([
  mv({ source_type: "GOODS_RECEIPT", into_stock: 1000, entries: 5 }),
  mv({ source_type: "GOODS_RECEIPT", voided: true, out_of_stock: 300, entries: 7 }),
  mv({ source_type: "SALES_INVOICE", account_id: "cogs", out_of_stock: 500, entries: 40 }),
  mv({ source_type: "SALES_INVOICE", voided: true, into_stock: 20, entries: 2 }),
  mv({ source_type: "SALES_RETURN", into_stock: 10 }),
  mv({ source_type: "STOCK_ADJUSTMENT", out_of_stock: 15, entries: 3 }),
  mv({ source_type: "JOURNAL_VOUCHER", into_stock: 50 }),
], roles);
const byKey = (list) => Object.fromEntries(list.map((r) => [r.key, r]));
const out = byKey(releases), inn = byKey(additions);
assert.equal(out["void-GOODS_RECEIPT"].label, "7 voided goods receipts");
assert.equal(out["void-GOODS_RECEIPT"].isCogs, false);
assert.equal(out["void-GOODS_RECEIPT"].attention, true);
assert.equal(out.counter.label, "Counter sales"); assert.equal(out.counter.isCogs, true);
assert.equal(out.writeoff.attention, true); assert.equal(out.writeoff.isCogs, false);
assert.equal(inn["void-SALES_INVOICE"].label, "2 voided sales");
assert.equal(inn["cust-return"].label, "Returned by customers");
assert.equal(inn["journal-in"].label, "1 manual journal entry");
assert.equal(releases[0].key, "counter", "largest first");
// A gap fully explained, and one with a remainder.
assert.deepEqual(explainGap(300, [{ label: "a", value: 300, detail: "" }]).unexplained, 0);
const part = explainGap(500, [{ label: "a", value: 300, detail: "" }, { label: "zero", value: 0, detail: "" }]);
assert.equal(part.unexplained, 200); assert.equal(part.items.length, 1, "zero items dropped");
console.log("stock-reasons: all checks pass");

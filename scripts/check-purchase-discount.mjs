// The purchase discount arithmetic, checked: npx tsx scripts/check-purchase-discount.mjs
import assert from "node:assert/strict";
const { pricePurchaseLines } = await import("../lib/discount.ts");

// The legacy example: 10 phones at 2,000,000, 5% off the line.
let p = pricePurchaseLines([{ qty: 10, unitPrice: 2_000_000, discountPct: 5 }], null, 0);
assert.equal(p.gross, 20_000_000); assert.equal(p.discount, 1_000_000); assert.equal(p.total, 19_000_000);

// An amount on the line wins over a rate, and is capped at the line.
p = pricePurchaseLines([{ qty: 1, unitPrice: 100, discountPct: 50, discountAmount: 30 }], null, 0);
assert.equal(p.lines[0].itemDiscountAmount, 30);
p = pricePurchaseLines([{ qty: 1, unitPrice: 100, discountAmount: 500 }], null, 0);
assert.equal(p.total, 0);

// Line first, bill after: 10% then 5% is 14.5%, never 15% or double.
p = pricePurchaseLines([{ qty: 1, unitPrice: 1000, discountPct: 10 }], { pct: 5 }, 0);
assert.equal(p.total, 855);

// A bill amount spreads by value and adds back exactly, remainder on the largest line.
p = pricePurchaseLines([{ qty: 1, unitPrice: 1000 }, { qty: 1, unitPrice: 2000 }, { qty: 1, unitPrice: 3001 }], { amount: 100 }, 0);
assert.equal(p.lines.reduce((s, l) => s + l.invoiceDiscountAmount, 0), 100);
assert.equal(p.discount, 100);
assert.ok(p.lines[2].invoiceDiscountAmount >= p.lines[0].invoiceDiscountAmount);

// A bill amount larger than the goods is capped.
p = pricePurchaseLines([{ qty: 1, unitPrice: 50 }], { amount: 80 }, 0);
assert.equal(p.total, 0); assert.equal(p.discount, 50);

console.log("purchase discount checks pass");

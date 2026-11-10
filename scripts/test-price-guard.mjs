// What a seller without discount.unlimited may charge (lib/price-guard.ts).
// The rules on supplied facts, then the real lookup once, read only.
//   npx tsx --env-file=.env scripts/test-price-guard.mjs
import assert from "node:assert/strict";
import postgres from "postgres";

const { priceProblem, priceFacts } = await import("../lib/price-guard.ts");
const P = 4_500_000, COST = 3_900_000;
const facts = (price, cost) => async (ids) => new Map(ids.map((id) => [id, { name: "iPhone", price, cost }]));
const listed = facts(P, COST), unlisted = facts(null, COST), unknown = facts(null, null);
const cashier = { role: "CASHIER" }, manager = { role: "MANAGER" };
const line = (unitPrice, extra = {}) => [{ itemId: "x", unitPrice, ...extra }];
let n = 0;
const ok = async (user, lines, f, why) => { assert.equal(await priceProblem(user, "co", lines, null, f), null, why); n++; };
const refused = async (user, lines, f, key, why) => {
  const p = await priceProblem(user, "co", lines, null, f);
  assert.equal(p?.key, key, why);
  assert.ok(!JSON.stringify(p.values).includes(String(COST)) && !JSON.stringify(p.values).includes("3,900,000"), "never tells the cost");
  n++;
};

await ok(cashier, line(P), listed, "list price");
await ok(cashier, line(P * 1.2), listed, "above list");
await ok(cashier, line(P * 0.95), listed, "typed 5% under list");
await ok(cashier, line(P, { discountPct: 5 }), listed, "5% discount");
await refused(cashier, line(P * 0.94), listed, "priceNeedsManager", "typed 6% under list");
await refused(cashier, line(P * 0.97, { discountPct: 3 }), listed, "priceNeedsManager", "typed price and discount together past 5%");
await refused(cashier, line(P, { discountPct: 6 }), listed, "discountNeedsManager", "6% discount");
await refused(cashier, line(P, { focReasonId: "r" }), listed, "freeNeedsManager", "free of charge");
// No price list kept (MTK today): the cost is the floor.
await ok(cashier, line(COST + 1), unlisted, "any price above cost");
await refused(cashier, line(1), unlisted, "belowCostNeedsManager", "a phone for 1 kyat");
await refused(cashier, line(COST - 1), unlisted, "belowCostNeedsManager", "just under cost");
await ok(cashier, line(1), unknown, "no price and no stock cost: nothing to check against");
await ok(manager, line(1, { focReasonId: "r", discountPct: 50 }), listed, "a manager decides");

// The real lookup runs and returns what the rules need.
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1, onnotice: () => {} });
const [co] = await sql`select id from company order by created_at limit 1`;
const items = (await sql`select id from item where company_id = ${co.id} limit 3`).map((r) => r.id);
const [cust] = await sql`select id from business_partner where company_id = ${co.id} and is_customer limit 1`;
await sql.end();
const real = await priceFacts(co.id, items, cust?.id ?? null);
assert.equal(real.size, items.length, "a fact per item");
for (const f of real.values()) assert.ok("price" in f && "cost" in f && typeof f.name === "string");
n++;
console.log(`PASS price guard: ${n} checks`);
process.exit(0);

// How long the inventory pages' queries take, and the plan of any slow one.
//   npx tsx scripts/perf-measure.mjs [--explain]
//
// Calls the same loaders the pages call. Every statement they send is
// captured, so a slow one can be run again under EXPLAIN ANALYZE as is.
import postgres from "postgres";

const seen = [];
globalThis.__sql = postgres(process.env.DATABASE_URL, {
  ssl: "require", prepare: false, max: 4, onnotice: () => {}, transform: { undefined: null },
  debug: (_c, query, params) => seen.push({ query, params, at: performance.now() }),
});
const sql = globalThis.__sql;
const explain = process.argv.includes("--explain");
const [co] = await sql`select id, name from company order by created_at limit 1`;
const Q = await import("../lib/queries.ts");
const Ph = await import("../lib/phone.ts");
const [{ n: serials }] = await sql`select count(*)::int n from stock_serial`;
const [{ n: items }] = await sql`select count(*)::int n from item`;
console.log(`\n  ${co.name}: ${items} items, ${serials} serials\n`);
const [anySerial] = await sql`select id from stock_serial order by created_at desc limit 1`;

const slow = [];
const time = async (label, fn) => {
  await fn(); // warm the connection and the plan
  const from = seen.length;
  const t = performance.now();
  const r = await fn();
  const ms = performance.now() - t;
  const rows = Array.isArray(r) ? r.length : r?.rows?.length ?? "";
  console.log(`  ${ms.toFixed(0).padStart(6)} ms  ${label}${rows !== "" ? `  (${rows} rows)` : ""}`);
  for (const s of seen.slice(from)) slow.push({ label, ...s });
  return ms;
};

const res = {};
res.imeiPage = await time("IMEI list, page 1 of in-stock", () => Ph.phoneStock(co.id, { status: "IN_STOCK", page: 1, size: 25 }));
res.imeiSearch = await time("IMEI list, search 'Perf Phone 3'", () => Ph.phoneStock(co.id, { q: "Perf Phone 3", page: 1, size: 25 }));
res.imeiLast = await time("IMEI list, page 300", () => Ph.phoneStock(co.id, { page: 300, size: 25 }));
res.imeiKpis = await time("IMEI KPIs + filters (one read)", () => Ph.serialKpis(co.id));
if (anySerial) res.detail = await time("IMEI detail (drawer base)", () => Ph.serialDetail(co.id, anySerial.id));
res.summary = await time("Inventory Summary table", () => Ph.inventorySummary(co.id, { combine: true }));
res.moves = await time("Inventory Summary movements", () => Ph.recentMovements(co.id, 6));
for (const [k, f] of Object.entries({
  getItems: Q.getItems, getStockByLocation: Q.getStockByLocation, getReservedQty: Q.getReservedQty,
  getIncomingQty: Q.getIncomingQty, getVariantStock: Q.getVariantStock, getLowStock: Q.getLowStock,
  getStockBatches: Q.getStockBatches, getConsignedStockOnHand: Q.getConsignedStockOnHand, getReorderPoints: Q.getReorderPoints,
})) res[k] = await time(`Stock page: ${k}`, () => f(co.id));

if (explain) {
  // Each statement once, slowest first, by how long it took to answer.
  const byQuery = new Map();
  for (let i = 0; i < slow.length; i++) {
    const s = slow[i];
    const next = seen.find((x) => x.at > s.at);
    const key = s.query.replace(/\s+/g, " ").slice(0, 200);
    if (!byQuery.has(key)) byQuery.set(key, s);
  }
  for (const s of byQuery.values()) {
    const t = performance.now();
    const plan = await sql.unsafe(`explain (analyze, buffers, format text) ${s.query}`, s.params);
    const ms = performance.now() - t;
    const exec = plan.map((r) => r["QUERY PLAN"]).find((l) => /Execution Time/.test(l));
    if (ms < 80) continue;
    console.log(`\n  ---- ${s.label}  (${exec?.trim()})\n  ${s.query.replace(/\s+/g, " ").slice(0, 240)}…`);
    for (const l of plan.map((r) => r["QUERY PLAN"])) {
      if (/actual time=(\d+\.?\d*)\.\.(\d+)/.test(l) && Number(l.match(/\.\.(\d+\.?\d*)/)[1]) > 20 || /Seq Scan|Execution|Planning/.test(l)) {
        console.log("   ", l.slice(0, 200));
      }
    }
  }
}
console.log(`\n  RESULT ${JSON.stringify(Object.fromEntries(Object.entries(res).map(([k, v]) => [k, Math.round(v)])))}\n`);
await sql.end();
process.exit(0);

// Time and EXPLAIN the counter-sale product lookup and the dashboard — DEV only.
//
//   npx tsx --env-file=.env scripts/profile-hot-queries.mts
//
// Runs the real functions (lib/phone.ts posSearch, retailDashboard), records
// every query they send, then re-runs each under EXPLAIN (ANALYZE, BUFFERS)
// and prints its server time, rows and the costliest plan nodes. Read-only:
// these functions only select, and EXPLAIN ANALYZE of a select changes nothing.
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes("ep-winter-leaf")) { console.error("Refused: DEV database only."); process.exit(2); }

type Q = { label: string; text: string; params: unknown[] };
const seen: Q[] = [];
let label = "";
// The app's lib/db reuses global.__sql; this one records what is sent.
(globalThis as any).__sql = postgres(url, {
  max: 8, prepare: false, ssl: "require", onnotice: () => {}, transform: { undefined: null },
  debug: (_c, text, params) => { seen.push({ label, text, params: params as unknown[] }); },
});
const sql = (globalThis as any).__sql as ReturnType<typeof postgres>;

const { posSearch, retailDashboard } = await import("../lib/phone");

async function timed<T>(name: string, fn: () => Promise<T>) {
  label = name;
  const from = seen.length;
  const t = performance.now();
  let note = "";
  // Parts that read the signed-in person's branch need a request; the queries
  // sent before that are still recorded.
  try { await fn(); } catch (e) { note = ` (stopped: ${String((e as Error).message).slice(0, 60)})`; await new Promise((r) => setTimeout(r, 1500)); }
  const wall = performance.now() - t;
  return { name: name + note, wall, queries: seen.slice(from) };
}

// The costliest nodes of a plan, by their own time (minus children).
function hot(plan: any, out: { node: string; self: number; rows: number; loops: number }[] = []) {
  const kids: any[] = plan.Plans ?? [];
  const total = plan["Actual Total Time"] * plan["Actual Loops"];
  const childTotal = kids.reduce((s, k) => s + k["Actual Total Time"] * k["Actual Loops"], 0);
  const what = [plan["Node Type"], plan["Relation Name"], plan["Index Name"] && `(${plan["Index Name"]})`].filter(Boolean).join(" ");
  out.push({ node: what, self: Math.max(0, total - childTotal), rows: plan["Actual Rows"], loops: plan["Actual Loops"] });
  kids.forEach((k) => hot(k, out));
  return out;
}

try {
  const [co] = await sql`select id from company order by created_at limit 1`;
  // The branch with the most stock movements: the busiest shelf.
  const [loc] = await sql`select location_id as id, count(*)::int n from stock_movement
    where company_id = ${co.id} group by 1 order by 2 desc limit 1`;
  const [size] = await sql`select
      (select count(*)::int from item where company_id = ${co.id} and is_active and is_stocked) as items,
      (select count(*)::int from stock_movement where company_id = ${co.id}) as movements,
            (select count(*)::int from document where company_id = ${co.id}) as documents`.catch(() => [{}]);
  console.log("DEV size:", size, "| busiest branch movements:", loc?.n);

  // Warm the connection pool so the first timing isn't a connect.
  await sql`select 1`;
  const runs = [
    await timed("shelf (no search)", () => posSearch(co.id, loc.id, "")),
    await timed("search 'iphone'", () => posSearch(co.id, loc.id, "iphone")),
    await timed("dashboard (all branches)", () => retailDashboard(co.id, null)),
    await timed("dashboard (one branch)", () => retailDashboard(co.id, [loc.id])),
  ];

  for (const r of runs) {
    console.log(`\n=== ${r.name}: ${r.wall.toFixed(0)} ms wall (from here to Neon and back), ${r.queries.length} queries`);
    const rows: { ms: number; plan: number; rows: number; read: number; hit: number; first: string; nodes: string }[] = [];
    for (const q of r.queries) {
      if (/^\s*(begin|commit|set|select 1)/i.test(q.text)) continue;
      const [{ "QUERY PLAN": [p] }] = await sql.unsafe(`explain (analyze, buffers, format json) ${q.text}`, q.params as any[]) as any;
      const nodes = hot(p.Plan).sort((a, b) => b.self - a.self).slice(0, 3)
        .map((n) => `${n.node} ${n.self.toFixed(1)}ms×${n.loops}`).join(" | ");
      rows.push({
        ms: p["Execution Time"], plan: p["Planning Time"], rows: p.Plan["Actual Rows"],
        hit: p.Plan["Shared Hit Blocks"] ?? 0, read: p.Plan["Shared Read Blocks"] ?? 0,
        first: q.text.replace(/\s+/g, " ").trim().slice(0, 70), nodes,
      });
    }
    rows.sort((a, b) => b.ms - a.ms);
    for (const x of rows) {
      console.log(`  ${x.ms.toFixed(1).padStart(7)} ms exec  ${x.plan.toFixed(1).padStart(5)} ms plan  rows ${String(x.rows).padStart(5)}  buffers hit ${x.hit} read ${x.read}`);
      console.log(`           ${x.first}`);
      console.log(`           hot: ${x.nodes}`);
    }
    console.log(`  sum of server execution: ${rows.reduce((s, x) => s + x.ms, 0).toFixed(0)} ms`);
  }
} finally {
  await sql.end();
}

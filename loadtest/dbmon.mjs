// Samples the dev database every 5 s while a load test runs, into
// loadtest/results/db-<label>.csv. Stops itself after LT_SECONDS (default 1200).
//   node loadtest/dbmon.mjs ramp
import postgres from "postgres";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";

const url = process.env.DATABASE_URL
  ?? readFileSync(".env", "utf8").match(/^\s*DATABASE_URL\s*=\s*"?(.+?)"?\s*$/m)[1];
if (!url.includes("ep-winter-leaf")) { console.error("Not the dev database — refusing."); process.exit(1); }
const sql = postgres(url, { ssl: "require", max: 1, prepare: false });
const label = process.argv[2] ?? "run";
const until = Date.now() + Number(process.env.LT_SECONDS ?? 1200) * 1000;
mkdirSync("loadtest/results", { recursive: true });
const out = `loadtest/results/db-${label}.csv`;
writeFileSync(out, "time,total,active,idle_in_xact,lock_waiters,oldest_xact_s,commits_per_s,rollbacks_per_s,deadlocks\n");

let prev = null;
while (Date.now() < until) {
  const [a] = await sql`
    select count(*)::int total,
           count(*) filter (where state = 'active')::int active,
           count(*) filter (where state like 'idle in transaction%')::int idle_in_xact,
           count(*) filter (where wait_event_type = 'Lock')::int lock_waiters,
           coalesce(max(extract(epoch from now() - xact_start)) filter (where state <> 'idle'), 0)::float oldest
      from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()`;
  const [d] = await sql`select xact_commit::float c, xact_rollback::float r, deadlocks::int dl
                          from pg_stat_database where datname = current_database()`;
  const t = Date.now();
  const rate = (k) => (prev ? ((d[k] - prev[k]) / ((t - prev.t) / 1000)).toFixed(1) : "");
  appendFileSync(out, `${new Date(t).toISOString()},${a.total},${a.active},${a.idle_in_xact},${a.lock_waiters},${a.oldest.toFixed(1)},${rate("c")},${rate("r")},${d.dl}\n`);
  prev = { ...d, t };
  await new Promise((r) => setTimeout(r, 5000));
}
await sql.end();

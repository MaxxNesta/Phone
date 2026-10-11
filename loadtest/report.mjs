// Turns a ramp run's raw k6 points and DB samples into per-stage results.
//   node loadtest/report.mjs            → loadtest/results/report.json + console table
import { readFileSync, writeFileSync } from "node:fs";

// The ramp's holds, in seconds from the start (see erp.js): ramps are left out.
// LT_LABEL=fifty or spike reads that run's files instead.
const LABEL = process.env.LT_LABEL ?? "ramp";
const STAGES = {
  ramp: [{ users: 5, from: 20, to: 200 }, { users: 10, from: 220, to: 400 },
         { users: 20, from: 420, to: 600 }, { users: 50, from: 630, to: 810 }],
  fifty: [{ users: 50, from: 30, to: 210 }],
  spike: [{ users: 20, from: 20, to: 80 }, { users: "50 (spike)", from: 90, to: 210 },
          { users: "20 (after)", from: 220, to: 280 }],
}[LABEL];

const lines = readFileSync(`loadtest/results/${LABEL}-points.csv`, "utf8").trim().split("\n");
const head = lines[0].split(",");
const col = (n) => head.indexOf(n);
const [cM, cT, cV, cS, cN, cK, cSc] = ["metric_name", "timestamp", "metric_value", "status", "name", "kind", "scenario"].map(col);
const rows = lines.slice(1).map((l) => l.split(","));
const t0 = Math.min(...rows.map((r) => Number(r[cT])));

const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const db = readFileSync(`loadtest/results/db-${LABEL}.csv`, "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
const dbT0 = new Date(db[0][0]).getTime() / 1000;

const out = STAGES.map((st) => {
  const inStage = rows.filter((r) => { const t = Number(r[cT]) - t0; return t >= st.from && t < st.to && r[cSc] === "work"; });
  const dur = inStage.filter((r) => r[cM] === "http_req_duration");
  // k6 keeps custom tags out of their own CSV column: a posting is any request named "post …".
  const of = (kind) => dur.filter((r) => (/^post /.test(r[cN]) ? "action" : "page") === kind).map((r) => Number(r[cV]));
  const byName = {};
  for (const r of dur) (byName[r[cN]] ??= []).push(Number(r[cV]));
  const count = (m) => inStage.filter((r) => r[cM] === m).reduce((s, r) => s + Number(r[cV]), 0);
  const secs = st.to - st.from;
  const dbs = db.filter((r) => { const t = new Date(r[0]).getTime() / 1000 - dbT0; return t >= st.from && t < st.to; });
  return {
    users: st.users,
    requests: dur.length, rps: +(dur.length / secs).toFixed(2),
    docs_per_min: +(count("docs_posted") / (secs / 60)).toFixed(1),
    page_med_ms: Math.round(pct(of("page"), 0.5)), page_p95_ms: Math.round(pct(of("page"), 0.95)),
    action_med_ms: Math.round(pct(of("action"), 0.5)), action_p95_ms: Math.round(pct(of("action"), 0.95)),
    sys_failures: count("sys_failed"), biz_rejections: count("biz_rejected"), timeouts: count("timeouts"),
    http_errors: dur.filter((r) => !["200", "303"].includes(r[cS])).length,
    db_conn_max: Math.max(0, ...dbs.map((r) => +r[1])), db_active_max: Math.max(0, ...dbs.map((r) => +r[2])),
    db_lock_waiters_max: Math.max(0, ...dbs.map((r) => +r[4])), db_oldest_xact_s_max: Math.max(0, ...dbs.map((r) => +r[5])),
    db_commits_per_s_avg: +(dbs.reduce((s, r) => s + (+r[6] || 0), 0) / Math.max(1, dbs.length)).toFixed(1),
    by_step: Object.fromEntries(Object.entries(byName).map(([n, xs]) => [n, { n: xs.length, med: Math.round(pct(xs, 0.5)), p95: Math.round(pct(xs, 0.95)) }])),
  };
});
writeFileSync(`loadtest/results/report-${LABEL}.json`, JSON.stringify(out, null, 1));
console.table(out.map(({ by_step, ...r }) => r));
for (const s of out) { console.log(`\n${s.users} users`); console.table(s.by_step); }

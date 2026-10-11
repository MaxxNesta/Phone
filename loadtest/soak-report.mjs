// A soak run in 15-minute windows: does anything drift as the hours pass?
//   node loadtest/soak-report.mjs   → loadtest/results/soak-report.json + table
import { readFileSync, writeFileSync } from "node:fs";

const lines = readFileSync("loadtest/results/soak-points.csv", "utf8").trim().split("\n");
const head = lines[0].split(",");
const [cM, cT, cV, cN, cSc] = ["metric_name", "timestamp", "metric_value", "name", "scenario"].map((n) => head.indexOf(n));
const rows = lines.slice(1).map((l) => l.split(","));
const t0 = rows.reduce((m, r) => Math.min(m, Number(r[cT])), Infinity);
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };

const db = readFileSync("loadtest/results/db-soak.csv", "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
const dbT0 = new Date(db[0][0]).getTime() / 1000;
const WIN = 900;
const nWin = Math.ceil(rows.reduce((m, r) => Math.max(m, Number(r[cT]) - t0), 0) / WIN);

const out = [];
for (let w = 0; w < nWin; w++) {
  const inW = rows.filter((r) => { const t = Number(r[cT]) - t0; return t >= w * WIN && t < (w + 1) * WIN; });
  const dur = inW.filter((r) => r[cM] === "http_req_duration" && r[cSc] === "work");
  const pages = dur.filter((r) => !/^post /.test(r[cN])).map((r) => +r[cV]);
  const posts = dur.filter((r) => /^post /.test(r[cN])).map((r) => +r[cV]);
  const sum = (m) => inW.filter((r) => r[cM] === m).reduce((s, r) => s + Number(r[cV]), 0);
  const dbs = db.filter((r) => { const t = new Date(r[0]).getTime() / 1000 - dbT0; return t >= w * WIN && t < (w + 1) * WIN; });
  out.push({
    window: `${w * 15}-${(w + 1) * 15}m`, requests: dur.length, rps: +(dur.length / WIN).toFixed(2),
    docs_posted: sum("docs_posted"), page_med: pct(pages, 0.5), page_p95: pct(pages, 0.95),
    post_med: pct(posts, 0.5), post_p95: pct(posts, 0.95),
    sys_failed: sum("sys_failed"), timeouts: sum("timeouts"), race_won: sum("race_won"), race_lost: sum("race_lost"),
    db_conn_max: Math.max(0, ...dbs.map((r) => +r[1])), db_lock_waiters_max: Math.max(0, ...dbs.map((r) => +r[4])),
    db_oldest_xact_s: Math.max(0, ...dbs.map((r) => +r[5])),
  });
}
const dl = db.length ? Number(db[db.length - 1][8]) - Number(db[0][8]) : null;
writeFileSync("loadtest/results/soak-report.json", JSON.stringify({ windows: out, deadlocks_during_run: dl }, null, 1));
console.table(out);
console.log("deadlocks during the run (pg_stat_database delta):", dl);

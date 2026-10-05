// Runs every test suite, one at a time, and prints one line per suite.
//
//   node scripts/regression.mjs              all suites
//   node scripts/regression.mjs phone fx     only suites whose name contains one of these
//
// Destructive: the suites empty transactions on whatever DATABASE_URL points
// at. Only ever the DEV database. Best run from a Vercel Sandbox next to the
// database (docs/06-phone-retail.md), where a suite takes seconds.
//
// Many inherited suites finish and then never exit (an open connection pool),
// so a suite is stopped once it has printed nothing for QUIET seconds after
// printing something, or after LIMIT seconds in all.

import { spawn } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import postgres from "postgres";

const QUIET = 12, LIMIT = 240;
const SKIP = new Set(["test-setup", "test-reset", "test-lock"]);

let url = process.env.DATABASE_URL;
if (!url && existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
    if (m) { url = m[1]; break; }
  }
}
if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
const sql = postgres(url, { ssl: "require", prepare: false, max: 1, onnotice: () => {} });
const [co] = await sql`select name from company order by created_at limit 1`;
if (!/DEV/i.test(co?.name ?? "")) {
  console.error(`Refusing: the company here is "${co?.name}", not a DEV database.`);
  process.exit(1);
}

const filters = process.argv.slice(2);
const suites = readdirSync("scripts")
  .filter((f) => /^test-.*\.mjs$/.test(f))
  .map((f) => f.replace(/\.mjs$/, ""))
  .filter((t) => !SKIP.has(t))
  .filter((t) => filters.length === 0 || filters.some((f) => t.includes(f)))
  .sort();

const run = (name) => new Promise((resolve) => {
  const started = Date.now();
  const child = spawn("npx", ["tsx", `scripts/${name}.mjs`], { shell: process.platform === "win32" });
  let out = "", last = Date.now();
  const take = (b) => { out += b; last = Date.now(); };
  child.stdout.on("data", take);
  child.stderr.on("data", take);
  const tick = setInterval(() => {
    const quiet = out && Date.now() - last > QUIET * 1000;
    if (quiet || Date.now() - started > LIMIT * 1000) child.kill("SIGKILL");
  }, 1000);
  child.on("close", () => {
    clearInterval(tick);
    const pass = (out.match(/^\s*PASS/gm) ?? []).length;
    const fail = (out.match(/^\s*FAIL/gm) ?? []).length;
    const error = /^\s*(ERROR|Error:)|Error: /m.test(out);
    resolve({ name, pass, fail, error, secs: Math.round((Date.now() - started) / 1000), out });
  });
});

const results = [];
for (const name of suites) {
  await sql`delete from test_run_lock`.catch(() => {});
  const r = await run(name);
  results.push(r);
  const flag = r.fail || r.error ? "FAIL" : r.pass ? " ok " : " ?? ";
  console.log(`${flag} ${name.padEnd(36)} pass=${r.pass} fail=${r.fail}${r.error ? " error" : ""} ${r.secs}s`);
  if (r.fail || r.error) {
    for (const l of r.out.split("\n").filter((l) => /FAIL|ERROR|Error:/.test(l)).slice(0, 4)) {
      console.log(`       ${l.trim().slice(0, 160)}`);
    }
  }
}

await sql`delete from test_run_lock`.catch(() => {});
// Suites that rebuild the company leave their own name behind; keep the
// environment recognisable.
await sql`update company set name = ${co.name}`;
await sql.end();
const bad = results.filter((r) => r.fail || r.error);
console.log(`\n${results.length} suites, ${results.reduce((s, r) => s + r.pass, 0)} checks passed, ${bad.length} suite(s) with failures`);
process.exit(bad.length ? 1 : 0);

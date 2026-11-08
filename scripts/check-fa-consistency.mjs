// Same label, same number: every fixed-asset screen against every other.
//
//   npx tsx --env-file=.env scripts/check-fa-consistency.mjs      (DEV only)
//
// Makes three assets, posts January to March through the real Review & post
// run, then reads each screen's own data function and compares the figures a
// person would expect to agree: accumulated depreciation, net book value,
// cost, each month's depreciation (posted and planned), and the register
// against the General Ledger. Removes what it made at the end, and empties
// transactions (DEV only; master data is untouched).

import postgres from "postgres";
import { resetTransactions } from "./test-reset.mjs";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, onnotice: () => {} });
const [co] = await sql`select id, name from company order by created_at limit 1`;
if (!/DEV/.test(co.name)) { console.error(`"${co.name}" is not DEV`); process.exit(1); }

const { assetList } = await import("../lib/fixed-assets.ts");
const { loadSchedules, thisMonth } = await import("../lib/fa-schedule.ts");
const { faOverview } = await import("../lib/fa-overview.ts");
const { calendar } = await import("../lib/fa-calendar.ts");
const { faYear } = await import("../lib/fa-year.ts");
const { registerReport, accumulatedReport, reconciliationReport } = await import("../lib/fa-reports.ts");
const { draftRun, postRun } = await import("../lib/fa-post.ts");
const { fromUnits } = await import("../lib/fa-engine.ts");

let bad = 0;
const same = (label, values) => {
  const nums = Object.values(values).map((v) => Math.round(Number(v)));
  const ok = nums.every((v) => v === nums[0]);
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}  ${Object.entries(values).map(([k, v]) => `${k} ${Math.round(Number(v)).toLocaleString()}`).join(" · ")}`);
};
const K = (u) => Number(fromUnits(u));
const made = [];

try {
  if ((await sql`select count(*)::int n from fixed_asset where company_id = ${co.id}`)[0].n > 0) throw new Error("DEV already has assets; this check needs an empty register.");
  const [br] = await sql`select id from location where company_id = ${co.id} and parent_id is null order by code limit 1`;
  const [user] = await sql`select id from app_user where company_id = ${co.id} order by created_at limit 1`;
  const cat = async (n) => (await sql`select id from fa_category where company_id = ${co.id} and name = ${n}`)[0].id;
  for (const [code, name, c, d, cost, life] of [
    ["CHK-1", "Galaxy Software", "Galaxy Software Installation", "2026-01-05", 3000000, 36],
    ["CHK-2", "Growatt Inverter", "Generator & Solar", "2026-01-29", 1420000, 24],
    ["CHK-3", "EV Cycle", "Cycle & EV Cycle", "2026-01-10", 6550000, 120],
  ]) {
    const [a] = await sql`insert into fixed_asset (company_id, code, name, category_id, branch_id, acquisition_date, in_service_date, acquisition_cost, useful_life_months, status, start_convention)
      values (${co.id}, ${code}, ${name}, ${await cat(c)}, ${br.id}, ${d}, ${d}, ${cost}, ${life}, 'ACTIVE', 'SAME_MONTH') returning id`;
    made.push(a.id);
  }
  // Their purchase, on the ledger as a real one would be: Dr each asset account, Cr opening balance equity.
  const { postJournalVoucher } = await import("../lib/posting.ts");
  const [equity] = await sql`select a.id from account a join system_account s on s.account_id = a.id
                               where s.company_id = ${co.id} and s.role = 'OPENING_BALANCE_EQUITY'`;
  const buys = await sql`select c.asset_account_id as acct, f.acquisition_cost::float as cost
                           from fixed_asset f join fa_category c on c.id = f.category_id where f.id = any(${made})`;
  await postJournalVoucher({ companyId: co.id, docDate: "2026-01-05", locationId: br.id, memo: "Fixed asset purchases (consistency check)",
    lines: [...buys.map((b) => ({ accountId: b.acct, amount: b.cost })), { accountId: equity.id, amount: -buys.reduce((t, b) => t + b.cost, 0) }] });
  const now = thisMonth();
  for (const m of ["2026-01", "2026-02", "2026-03"]) {
    const run = await draftRun(co.id, br.id, m, user.id, "REVIEW", now);
    await postRun(co.id, run.id, user.id, now);
  }
  console.log(`\n  3 assets, January to March posted; today is ${now}\n`);

  const today = new Date(Date.now() + 6.5 * 3600_000).toISOString().slice(0, 10);
  const [ov, reg, sched, cal, yr, rReg, rAcc, rRec] = await Promise.all([
    faOverview(co.id, null), assetList(co.id, null), loadSchedules(co.id, {}),
    calendar(co.id, 2026, "2026-02", { branches: null }), faYear(co.id, 2026, { branches: null }),
    registerReport(co.id, { from: "2026-01-01", to: today, branches: null }),
    accumulatedReport(co.id, { from: "2026-01-01", to: today, branches: null }),
    reconciliationReport(co.id, { from: "2026-01-01", to: today, branches: null }),
  ]);
  const sumOf = (xs, k) => xs.reduce((t, x) => t + Number(x[k]), 0);
  const nowK = Number(now.slice(5)) - 1;
  const tot = (k, i) => yr.total.months[i][k];

  console.log("  Cost");
  same("cost", { Overview: K(ov.cost), Register: sumOf(reg, "acquisition_cost"), "Asset Register report": sumOf(rReg, "cost"),
    "Category summary additions": yr.total.months.reduce((t, c) => t + c.additions, 0) });

  console.log("\n  Accumulated depreciation (posted)");
  same("accumulated", { Overview: K(ov.accumulated), Register: sumOf(reg, "accumulated"), "Asset Register report": sumOf(rReg, "accumulated"),
    "Accumulated report closing": sumOf(rAcc, "closing"), "Category summary (cost − NBV posted)": K(ov.cost) - tot("nbvPosted", nowK),
    "GL (reconciliation)": sumOf(rRec.filter((r) => r.side === "Accumulated"), "ledger") });

  console.log("\n  Net book value (posted)");
  same("NBV", { Overview: K(ov.nbv), Register: sumOf(reg, "nbv"), "Asset Register report": sumOf(rReg, "nbv"),
    "Category summary, this month": tot("nbvPosted", nowK) });

  console.log("\n  A posted month: February");
  const feb = cal.months.find((x) => x.month === "2026-02");
  same("February depreciation", { "Calendar expected": feb.expected, "Calendar posted": feb.posted,
    "Category summary posted": tot("depPosted", 1), "Category summary planned": tot("depAll", 1),
    "Asset schedule": yr.schedule.reduce((t, a) => t + (a.months[1]?.amount ?? 0), 0),
    "Overview trend": K(ov.trend.find((t) => t.month === "2026-02")?.posted ?? 0n) });

  console.log("\n  A month not yet posted: this month");
  const calNow = await calendar(co.id, 2026, now, { branches: null });
  const cm = calNow.months.find((x) => x.month === now);
  same(`${now} depreciation`, { Overview: K(ov.thisMonth), "Calendar expected": cm.expected,
    "Category summary planned": tot("depAll", nowK), "Asset schedule": yr.schedule.reduce((t, a) => t + (a.months[nowK]?.amount ?? 0), 0) });
  same(`${now} nothing posted`, { "Calendar posted": cm.posted, "Category summary posted": tot("depPosted", nowK) });

  console.log("\n  Each asset: its page against the schedule and the register");
  for (const a of sched) {
    const s = yr.schedule.find((x) => x.id === a.id), r = reg.find((x) => x.id === a.id);
    const yearTotal = a.rows.filter((x) => x.month.startsWith("2026")).reduce((t, x) => t + K(x.amount), 0);
    same(`${a.code} 2026 depreciation`, { "Asset page": yearTotal, "Asset schedule": s.months.reduce((t, c) => t + (c?.amount ?? 0), 0) });
    same(`${a.code} posted to date`, { "Asset page": a.rows.filter((x) => x.state === "POSTED").reduce((t, x) => t + K(x.amount), 0), Register: r.accumulated });
    same(`${a.code} closing NBV Dec 2026`, { "Asset page": K(a.rows.find((x) => x.month === "2026-12")?.closing ?? 0n), "Asset schedule": s.closing });
  }

  console.log("\n  Register against the General Ledger");
  for (const r of rRec) same(`${r.account} ${r.side} ${r.branch}`, { Register: r.register, "General Ledger": r.ledger });
} catch (e) {
  bad++; console.error(e);
} finally {
  // KEEP=1 leaves the assets and postings in place, to look at the screens; run again without it to clear them.
  if (process.env.KEEP === "1") {
    await sql.end();
    console.log(bad ? `\n${bad} FAILED (kept)` : "\nfixed assets: every label agrees (kept for screenshots)");
    process.exit(bad ? 1 : 0);
  }
  // Journals and runs are transactions; the three assets are this check's own.
  await resetTransactions(sql);
  if (made.length) {
    await sql`delete from fa_event where asset_id = any(${made})`;
    await sql`delete from fa_run where company_id = ${co.id} and not exists (select 1 from fa_depreciation d where d.run_id = fa_run.id)`;
    await sql`delete from fixed_asset where id = any(${made})`;
  }
  await sql`update company set name = ${co.name} where id = ${co.id}`;
  await sql.end();
}
console.log(bad ? `\n${bad} FAILED` : "\nfixed assets: every label agrees");
process.exit(bad ? 1 : 0);

// Throwaway: a few fixed assets on DEV for looking at the screens.
//   node scripts/_demo-fa.mjs            add them
//   node scripts/_demo-fa.mjs --remove   take them (and anything posted for them) away
// Only ever touches assets whose code starts ZZFA-.
import { readFileSync } from "node:fs";
import postgres from "postgres";
const url = process.env.DATABASE_URL ?? readFileSync(".env", "utf8").match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/m)[1].replace(/^["']|["']$/g, "");
const sql = postgres(url, { ssl: "require", prepare: false, max: 1, onnotice: () => {} });
const [co] = await sql`select id, name from company order by created_at limit 1`;
if (!/\bDEV\b/.test(co.name)) throw new Error("DEV only");
const ids = (await sql`select id from fixed_asset where company_id = ${co.id} and code like 'ZZFA-%'`).map((r) => r.id);
if (process.argv.includes("--remove")) {
  // Postings and links first, then DEV's transactions (which takes any demo journals with it).
  await sql`delete from fa_depreciation where asset_id = any(${ids})`.catch(() => {});
  await sql`delete from fa_run where company_id = ${co.id}`;
  const { resetTransactions } = await import("./test-reset.mjs");
  await resetTransactions(sql);
  await sql`delete from fa_event where asset_id = any(${ids})`;
  await sql`delete from fa_estimate_change where asset_id = any(${ids})`;
  await sql`delete from fa_journal_link where asset_id = any(${ids})`;
  await sql`delete from fixed_asset where id = any(${ids})`;
  console.log("removed", ids.length); await sql.end(); process.exit(0);
}
if (ids.length) { console.log("already there:", ids.length); await sql.end(); process.exit(0); }
const cat = async (code) => (await sql`select id from fa_category where company_id = ${co.id} and code = ${code}`)[0].id;
const branches = await sql`select id from location where company_id = ${co.id} and parent_id is null and is_active order by code`;
const A = [
  ["ZZFA-001", "Generator 25kVA", "11301", 0, "2025-03-04", 12_000_000, 600_000, 60],
  ["ZZFA-002", "Solar panel set", "11301", 0, "2025-11-20", 8_400_000, 0, 84],
  ["ZZFA-003", "Daikin inverter AC", "11404", 0, "2025-06-01", 2_600_000, 100_000, 48],
  ["ZZFA-004", "Counter computers (3)", "11403", 1, "2024-12-15", 3_900_000, 0, 36],
  ["ZZFA-005", "Display tables & lockers", "11402", 1, "2026-01-10", 1_800_000, 0, 60],
  ["ZZFA-006", "Delivery EV cycle", "11501", 0, "2026-04-02", 2_200_000, 200_000, 36],
];
for (const [code, name, c, b, svc, cost, res, life] of A) {
  const [a] = await sql`insert into fixed_asset (company_id, code, name, category_id, branch_id, acquisition_date, in_service_date,
      acquisition_cost, residual_value, useful_life_months, status)
    values (${co.id}, ${code}, ${name}, ${await cat(c)}, ${branches[b % branches.length].id}, ${svc}, ${svc}, ${cost}, ${res}, ${life}, 'ACTIVE')
    returning id`;
  await sql`insert into fa_event (company_id, asset_id, event_type, event_date) values (${co.id}, ${a.id}, 'CREATED', ${svc}), (${co.id}, ${a.id}, 'ACTIVATED', ${svc})`;
}
console.log("added", A.length); await sql.end();

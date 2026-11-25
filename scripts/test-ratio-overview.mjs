// The Executive Ratios tab's figures agree with the ledger (lib/financial-ratios.ts).
//   ALLOW_DESTRUCTIVE_TESTS=1 npx tsx --env-file=.env.test scripts/test-ratio-overview.mjs
// Writes 20,000 made-up ledger lines inside a transaction and rolls it back.
import postgres from "postgres";
if (process.env.ALLOW_DESTRUCTIVE_TESTS !== "1" || !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Local test database only, with ALLOW_DESTRUCTIVE_TESTS=1");
}
const { getRatioOverview, getFinancialRatios } = await import("../lib/financial-ratios.ts");
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
const [co] = await sql`select id from company order by created_at limit 1`;
let bad = 0;
const near = (a, b) => Math.abs(a - b) < 0.01;
const check = (label, a, b) => { const ok = near(a, b); if (!ok) bad++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}  ${a} vs ${b}`); };

await sql.begin(async (tx) => {
  await tx`alter table journal_line disable trigger user`;
  await tx`alter table journal_entry disable trigger user`;
  const [fp] = await tx`select id from fiscal_period where company_id = ${co.id} limit 1`;
  await tx`insert into journal_entry (id, company_id, entry_no, entry_date, fiscal_period_id, source_type)
    select gen_random_uuid(), ${co.id}, 'RXT' || g, date '2025-01-01' + (g % 700), ${fp.id},
           (array['SALES_INVOICE','CUSTOMER_RECEIPT','PURCHASE_INVOICE','GOODS_RECEIPT'])[1 + g % 4]
      from generate_series(1, 4000) g`;
  await tx`insert into journal_line (company_id, journal_entry_id, line_no, account_id, currency, amount, base_amount)
    select ${co.id}, je.id, n, a.id, 'MMK', v, v
      from journal_entry je cross join generate_series(1, 5) n
      cross join lateral (select id from account where company_id = ${co.id}
                            and not exists (select 1 from account c where c.parent_id = account.id)
                          offset ((hashtext(je.id::text || n) & 1023) % 60) limit 1) a
      cross join lateral (select ((case when n % 2 = 0 then 1 else -1 end) * (1 + abs(hashtext(je.id::text || n) % 100000)))::numeric as v) x
     where je.entry_no like 'RXT%'`;

  const from = "2025-12-01", to = "2026-12-01";
  const o = await getRatioOverview(co.id, from, to, tx);
  const sum = async (type, f, t) => (await tx`
    select coalesce(sum(jl.base_amount), 0)::float as s from journal_line jl
      join journal_entry je on je.id = jl.journal_entry_id join account a on a.id = jl.account_id
     where jl.company_id = ${co.id} and a.account_type = ${type} and je.entry_date >= ${f}::date and je.entry_date < ${t}::date`)[0].s;
  console.log("Balances and flows against plain sums");
  check("total assets at the end", o.current.totalAssets, await sum("ASSET", "1900-01-01", to));
  check("total liabilities at the end", o.current.totalLiabilities, -(await sum("LIABILITY", "1900-01-01", to)));
  check("cost of sales in the period", o.current.cogs, await sum("COGS", from, to));
  check("expenses in the period", o.current.operatingExpenses + o.current.interest, await sum("EXPENSE", from, to));
  check("assets where the period began (the period before's close)", o.previous.totalAssets, await sum("ASSET", "1900-01-01", from));
  check("cost of sales in the period before", o.previous.cogs, await sum("COGS", "2024-12-01", from));
  console.log("The twelve months add up to the year");
  check("cost of sales, month by month", o.months.reduce((t, m) => t + m.cogs, 0), o.current.cogs);
  check("net profit, month by month", o.months.reduce((t, m) => t + m.netProfit, 0), o.current.netProfit);
  check("last month closes where the year closes", o.months[11].totalAssets, o.current.totalAssets);
  check("twelve months, Dec to Nov", o.months.length * 100 + Number(o.months[0].month.slice(5)), 1212);
  console.log("The full report reads the same ledger the same way");
  const r = await getFinancialRatios(co.id, { from, to, compare: "previous", branchId: null }, tx);
  for (const k of ["totalAssets", "currentLiabilities", "netSales", "netProfit", "collected", "creditPurchases"]) check(k, r.current[k], o.current[k]);
  throw new Error("rollback");
}).catch((e) => { if (e.message !== "rollback") throw e; });
await sql.end();
console.log(bad ? `\n${bad} failed` : "\nAll passed");
process.exit(bad ? 1 : 0);

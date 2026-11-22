// The Executive dashboard agrees with the income statement (lib/executive.ts).
//   npx tsx scripts/check-executive.mjs      (read only)
import postgres from "postgres";
const { executiveData } = await import("../lib/executive.ts");
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {},
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : "require" });
const [co] = await sql`select id from company order by created_at limit 1`;
const to = new Date(); to.setUTCDate(1); to.setUTCMonth(to.getUTCMonth() + 1);
const from = new Date(to); from.setUTCMonth(from.getUTCMonth() - 12);
const iso = (d) => d.toISOString().slice(0, 10);
const d = await executiveData(co.id, iso(from), iso(to));
const [is] = await sql`
  select coalesce(sum(case when a.account_type = 'REVENUE' then -jl.base_amount end), 0)::float as rev,
         coalesce(sum(case when a.account_type = 'COGS' then jl.base_amount end), 0)::float as cogs,
         coalesce(sum(case when a.account_type = 'EXPENSE' then jl.base_amount end), 0)::float as exp
    from journal_line jl join journal_entry je on je.id = jl.journal_entry_id join account a on a.id = jl.account_id
   where jl.company_id = ${co.id} and je.entry_date >= ${iso(from)}::date and je.entry_date < ${iso(to)}::date`;
const near = (a, b) => Math.abs(a - b) < 0.01;
let bad = 0;
const check = (l, ok, x) => { if (!ok) bad++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}  ${x}`); };
check("revenue = income statement", near(d.now.rev, is.rev), `${d.now.rev} / ${is.rev}`);
check("cost of sales = income statement", near(d.now.cogs, is.cogs), `${d.now.cogs} / ${is.cogs}`);
check("expenses = income statement", near(d.now.exp, is.exp), `${d.now.exp} / ${is.exp}`);
const branchSum = d.branches.reduce((t, b) => t + b.pl.rev, 0) + (d.unassigned?.rev ?? 0);
check("branches add up to the company", near(branchSum, d.now.rev), `${branchSum}`);
const srcSum = d.revenueBy.reduce((t, r) => t + r.amount, 0);
check("revenue sources (income flow) add up to revenue", near(srcSum, d.now.rev), `${srcSum}`);
const hourSum = d.hours.reduce((t, h) => t + h.sales, 0);
const [{ n: invoices }] = await sql`select count(*)::int n from document where company_id = ${co.id} and doc_type = 'SALES_INVOICE'
  and status = 'POSTED' and posting_date >= ${iso(from)}::date and posting_date < ${iso(to)}::date`;
check("busy hours count every sale once", hourSum === invoices, `${hourSum} / ${invoices}`);
const trendSum = d.trend.reduce((t, m) => t + m.rev, 0);
check("12 months add up to the period", near(trendSum, d.now.rev), `${trendSum}`);
await sql.end();
await (await import("../lib/db.ts")).sql.end?.();
process.exit(bad ? 1 : 0);

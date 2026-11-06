// The limits on expensive work (lib/heavy.ts): so many a minute per person,
// imports one at a time per company, a dead run's slot taken back, and which
// paths count. Touches only heavy_run rows of its own kinds, removed after.
//
//   npx tsx --env-file=.env scripts/test-heavy.mjs

const { sql } = await import("../lib/db.ts");
const H = await import("../lib/heavy.ts");

let failed = 0;
const check = (what, ok, got) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : `  (got ${JSON.stringify(got)})`}`); if (!ok) failed++; };
const refusal = async (fn) => { try { await fn(); return null; } catch (e) { return e instanceof H.TooBusy ? e.message : `other: ${e.message}`; } };
const clean = () => sql`delete from heavy_run where kind like '%.zz-test'`;

try {
  await clean();
  const [co] = await sql`select id from company order by created_at limit 1`;
  const me = { companyId: co.id, who: "test:me" }, you = { companyId: co.id, who: "test:you" };

  // Reports: forty a minute each, then refused, and someone else is not affected.
  for (let i = 0; i < H.LIMITS.report.perMinute; i++) await H.begin("report.zz-test", me);
  const over = await refusal(() => H.begin("report.zz-test", me));
  check("the 41st load of a report in a minute is refused", /Too many loads of this report.*at most 40/.test(over ?? ""), over);
  check("  another person can still load it", (await refusal(() => H.begin("report.zz-test", you))) === null);

  // Imports: one at a time per company, whoever starts the second.
  const run = await H.begin("import.zz-test", me);
  const second = await refusal(() => H.begin("import.zz-test", you));
  check("a second import while one runs is refused, with when it started", /already running \(started \d\d:\d\d\)/.test(second ?? ""), second);
  await H.end(run);
  const again = await refusal(() => H.begin("import.zz-test", you));
  check("  once it finishes, the next one starts", again === null, again);
  await sql`update heavy_run set finished_at = now() where kind = 'import.zz-test'`;

  // A run that died: its slot is free once its time is up.
  await sql`insert into heavy_run (company_id, who, kind, exclusive, started_at)
            values (${co.id}, 'test:dead', 'import.zz-test', true, now() - interval '20 minutes')`;
  check("an import that died 20 minutes ago no longer blocks", (await refusal(() => H.begin("import.zz-test", me))) === null);
  await sql`update heavy_run set finished_at = now() where kind = 'import.zz-test'`;

  // The heavy() wrapper releases the slot even when the work fails.
  const u = { id: "test:me", companyId: co.id };
  await H.heavy("import.zz-test", u, async () => { throw new Error("boom"); }).catch(() => {});
  check("a failed import releases its slot", (await refusal(() => H.heavy("import.zz-test", u, async () => 1))) === null);

  // Which paths count.
  check("a download under /export counts as an export", H.heavyKindFor("/finance/cash-flow/export") === "export.finance-cash-flow", H.heavyKindFor("/finance/cash-flow/export"));
  check("the sales report counts as a report", H.heavyKindFor("/sales/reports") === "report.sales");
  check("the ratios' tabs count as one report", H.heavyKindFor("/reports/financial-ratios") === "report.ratios");
  check("an ordinary page does not count", H.heavyKindFor("/products") === null && H.heavyKindFor("/sales/invoices") === null);
} catch (e) {
  console.log(`  FAIL ${e.message}`); failed++;
} finally {
  await clean();
}
console.log(failed ? `\n  ${failed} failed\n` : "\n  all passed — its rows removed\n");
await sql.end();
process.exit(failed ? 1 : 0);

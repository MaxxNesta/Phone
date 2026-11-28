import { money } from "@/lib/db";
import { AutoApply } from "@/components/auto-apply";
import { UNASSIGNED_BRANCH } from "@/lib/queries";
import { StatementTable } from "@/components/statement-table";
import { ClassicStatement } from "@/components/classic-statement";
import { CompareTable } from "@/components/income-compare";
import { GroupedBars } from "@/components/charts";
import { GRAINS, asGrain } from "@/lib/statement-compare";
import { getBalanceCompare } from "./compare";
import { getClearingAndTaxAccounts } from "@/lib/queries";
import { rowsToDoc, shapeToDoc, longDate, type StatementDoc } from "@/lib/statement-doc";
import { HelpHint } from "@/components/help-hint";
import { getBalanceSheetData, type Params } from "./data";

export default async function BalanceSheet({
  searchParams,
}: {
  searchParams: Promise<Params & { layout?: string; grain?: string; from?: string }>;
}) {
  const sp = await searchParams;
  // Classic (2026-11-28): the legacy books' layout, as on the income statement.
  const classic = sp.layout === "classic";
  // Compare (2026-11-28): the balance sheet at the end of each month, quarter or year.
  const compare = sp.layout === "compare";
  const grain = asGrain(sp.grain);
  const data = await getBalanceSheetData(sp);
  if (!data) return <div className="empty">No company found.</div>;
  const {
    company, branches, unassignedLines, branchId, asOf,
    summaries, sections, subtotals, scope,
  } = data;
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : `${asOf.slice(0, 4)}-01-01`;
  const [cmp, foldList] = await Promise.all([
    compare ? getBalanceCompare(company.id, { from, to: asOf }, grain, branchId) : Promise.resolve(null),
    getClearingAndTaxAccounts(company.id),
  ]);
  // The statement as a document to hand over (Export): clearing and tax inside current assets / liabilities.
  const foldIds = new Set(foldList);
  const docBase = { company: company.name, title: "Balance sheet", currency: company.base_currency, file: "balance-sheet" };
  const exportDoc: StatementDoc = cmp
    ? { ...docBase, title: `Balance sheet — ${GRAINS[grain].toLowerCase()} comparison`, wide: true,
        lines: [`As at each period end, ${longDate(from)} to ${longDate(asOf)}`, data.branchName],
        columns: cmp.periods.map((p) => `${p.label}`), rows: rowsToDoc(cmp.rows, { columns: cmp.periods.length, total: false, foldIds }) }
    : { ...docBase, lines: [`As at ${longDate(asOf)}`, data.branchName], columns: ["Amount"], rows: shapeToDoc({ sections, subtotals }, foldIds) };

  return (
    <>
      <div className="page-head">
        <h1>Balance sheet</h1>
        <HelpHint label="What this statement shows">
          A snapshot, not a period. Revenue and expense are never closed to
          equity here, so their running net through the date chosen at the right is folded
          into retained earnings — otherwise the two sides wouldn&rsquo;t match.
        </HelpHint>
        {/* The period and branch, on the title's own line at the right, so the
            statement starts right under its name. */}
        <form className="stmt-bar">
          {branches.length > 1 && (
            <label className="stmt-ctl" htmlFor="branch"><span>Branch</span>
              <select id="branch" name="branch" defaultValue={branchId ?? ""}>
                <option value="">All branches (consolidated)</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.code} · {b.name}</option>
                ))}
                {unassignedLines.lines > 0 && (
                  <option value={UNASSIGNED_BRANCH}>— No branch ({unassignedLines.lines} lines) —</option>
                )}
              </select>
          </label>
          )}
          <label className="stmt-ctl" htmlFor="layout"><span>Layout</span>
            <select id="layout" name="layout" defaultValue={compare ? "compare" : classic ? "classic" : ""}>
              <option value="">Standard</option>
              <option value="classic">Classic</option>
              <option value="compare">Compare periods</option>
            </select>
          </label>
          {compare && (
            <>
              <label className="stmt-ctl" htmlFor="grain"><span>Period</span>
                <select id="grain" name="grain" defaultValue={grain}>
                  {Object.entries(GRAINS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <label className="stmt-ctl" htmlFor="from"><span>From</span>
                <input id="from" name="from" type="date" defaultValue={from} />
              </label>
            </>
          )}
          <label className="stmt-ctl" htmlFor="asOf"><span>{compare ? "To" : "As of"}</span>
            <input id="asOf" name="asOf" type="date" defaultValue={asOf} />
          </label>
          <div className="stmt-bar-actions">
            <AutoApply />
            <button type="submit" data-apply>Update</button>
          </div>
        </form>
      </div>


      {unassignedLines.lines > 0 && branchId === null && (
        <p className="hint" style={{ margin: "0 0 1rem" }}>
          {money(unassignedLines.debits)} was posted without choosing a branch.
          It counts in the company total but in none of the branches, so adding
          the branches together will not reach this total. Choose
          &ldquo;No branch&rdquo; above to see what those entries are.
        </p>
      )}

      {cmp ? (
        <>
          <div className="icmp-kpis">
            <div className="card icmp-kpi"><span>Total assets</span><strong>{money(String(Math.round(cmp.latest.assets)))}</strong><small>as of {asOf}</small></div>
            <div className="card icmp-kpi"><span>Total liabilities</span><strong>{money(String(Math.round(cmp.latest.liabilities)))}</strong><small>as of {asOf}</small></div>
            <div className="card icmp-kpi"><span>Total equity</span><strong className={cmp.latest.equity < 0 ? "neg" : ""}>{money(String(Math.round(cmp.latest.equity)))}</strong><small>{cmp.latest.balanced ? "balanced" : "not balanced"}</small></div>
          </div>
          <section className="card" style={{ marginBottom: "var(--s3)" }}>
            <div className="card-head"><h2>At each {grain === "month" ? "month" : grain === "quarter" ? "quarter" : "year"} end</h2><span className="page-sub">{scope}</span></div>
            <div className="card-body">
              <GroupedBars data={cmp.chart} series={[{ key: "assets", label: "Assets" }, { key: "liabilities", label: "Liabilities" }, { key: "equity", label: "Equity" }]} />
            </div>
          </section>
          <CompareTable periods={cmp.periods} rows={cmp.rows} currency={company.base_currency}
            pctBase="t:ASSET" pctTitle="each figure as a share of total assets at that date" showTotal={false} exportDoc={exportDoc} />
        </>
      ) : classic ? (
        <ClassicStatement sections={sections} subtotals={subtotals} scope={scope} basis="position" exportDoc={exportDoc}
          revenue={sections.find((x) => x.key === "ASSET")?.total ?? 0} baseLabel="% of total assets" />
      ) : (
      <StatementTable
        exportDoc={exportDoc}
        title="Statement"
        currency={company.base_currency}
        scope={scope}
        printHref={{ pathname: "/finance/balance-sheet/print", query: {
          asOf, ...(branchId ? { branch: branchId } : {}),
        } }}
        summaries={summaries}
        sections={sections}
        subtotals={subtotals}
      />
      )}
    </>
  );
}

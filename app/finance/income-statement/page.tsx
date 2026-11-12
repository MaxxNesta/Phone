import Link from "next/link";
import { money } from "@/lib/db";
import { AutoApply } from "@/components/auto-apply";
import { UNASSIGNED_BRANCH } from "@/lib/queries";
import { StatementTable } from "@/components/statement-table";
import { ClassicStatement } from "@/components/classic-statement";
import { HelpHint } from "@/components/help-hint";

import { getIncomeStatementData, type Params } from "./data";

export default async function IncomeStatement({
  searchParams,
}: {
  searchParams: Promise<Params & { layout?: string }>;
}) {
  const sp = await searchParams;
  // Classic is the legacy books' layout: group headings, ruled subtotals, brackets.
  const classic = sp.layout === "classic";
  const data = await getIncomeStatementData(sp);
  if (!data) return <div className="empty">No company found.</div>;
  const {
    company, branches, unassignedLines, branchId, range,
    summaries, sections, subtotals, scope, cogsBreakdown,
  } = data;

  return (
    <>
      <div className="page-head">
        <h1>Income statement</h1>
        <HelpHint label="What this statement shows">
          Revenue less cost of goods sold less expenses, read straight from
          the ledger for the period chosen at the right. Pick a branch to see that branch on
          its own, or leave it on all branches for the whole company.
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
            <select id="layout" name="layout" defaultValue={classic ? "classic" : ""}>
              <option value="">Standard</option>
              <option value="classic">Classic</option>
            </select>
          </label>
          <label className="stmt-ctl" htmlFor="from"><span>From</span>
            <input id="from" name="from" type="date" defaultValue={range.from} />
          </label>
          <label className="stmt-ctl" htmlFor="to"><span>To</span>
            <input id="to" name="to" type="date" defaultValue={range.to} />
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

      {classic ? (
        <ClassicStatement sections={sections} subtotals={subtotals} scope={scope}
          revenue={sections.find((x) => x.key === "REVENUE")?.total ?? 0} />
      ) : (
      <StatementTable
        title="Statement"
        currency={company.base_currency}
        scope={scope}
        printHref={{ pathname: "/finance/income-statement/print", query: {
          from: range.from, to: range.to, ...(branchId ? { branch: branchId } : {}),
        } }}
        summaries={summaries}
        sections={sections}
        subtotals={subtotals}
      />
      )}

      {/* Cost of sales is recognised per delivery from the layers consumed,
          so this statement never computes opening + purchases - closing.
          A reader checking it that way needs to see the releases that are
          not sales, or the two will never agree and neither is wrong. */}
      {cogsBreakdown && cogsBreakdown.total > 0 && (
        <details className="card cogsnote">
          <summary>
            What made up cost of goods sold
            <span className="page-sub">
              {money(String(cogsBreakdown.sold))} of {money(String(cogsBreakdown.total))} released
            </span>
          </summary>
          {/* The overview; the full statement — every reason, carriage inward and
              the ledger reconciliation — is the Inventory movement report. */}
          <table className="sf">
            <colgroup><col /><col className="sf-amtcol" /></colgroup>
            <tbody>
              <tr className="sf-l0"><td>Opening inventory</td><td className="sf-amt">{money(String(cogsBreakdown.opening))}</td></tr>
              <tr className="sf-g" data-tone="in"><td><span className="sf-dot" />Inventory added</td><td className="sf-amt">{money(String(cogsBreakdown.added))}</td></tr>
              <tr className="sf-l0"><td>Less: closing inventory</td><td className="sf-amt">({money(String(cogsBreakdown.closing))})</td></tr>
              <tr className="sf-total"><td>Net inventory outflows</td><td className="sf-amt">{money(String(cogsBreakdown.total))}</td></tr>
              {cogsBreakdown.notSold !== 0 && (
                <tr className="sf-l0" data-tone="other"><td><span className="sf-label"><span className="sf-dot" />Less: left without being sold
                  <span className="sf-sub">{cogsBreakdown.releases.filter((r) => !r.isCogs).map((r) => r.label.toLowerCase()).join(", ")}</span></span></td>
                  <td className="sf-amt">({money(String(cogsBreakdown.notSold))})</td></tr>
              )}
              <tr className="sf-total" data-tone="sold"><td><span className="sf-label"><span className="sf-dot" />Cost of sales and deliveries</span></td>
                <td className="sf-amt">{money(String(cogsBreakdown.sold))}</td></tr>
            </tbody>
          </table>
          <p className="sf-foot">
            <Link className="subline" href={{
              pathname: "/finance/inventory-cogs",
              query: { from: range.from, to: range.to, ...(branchId ? { branch: branchId } : {}) },
            }}>View details — every line, carriage inward and the ledger reconciliation →</Link>
          </p>
        </details>
      )}
    </>
  );
}

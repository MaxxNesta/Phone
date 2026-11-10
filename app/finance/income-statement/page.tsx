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
          <div className="tablewrap">
            <table>
              <tbody>
                <tr>
                  <td>Opening inventory</td>
                  <td className="r">{money(String(cogsBreakdown.opening))}</td>
                </tr>
                <tr>
                  <td>Closing inventory</td>
                  <td className="r">{money(String(cogsBreakdown.closing))}</td>
                </tr>
                {cogsBreakdown.releases.map((rl) => (
                  <tr key={rl.label}>
                    <td className="wrap">
                      {rl.label}
                      {rl.isCogs
                        ? <> <span className="pill ok">cost of sales</span></>
                        : <> <span className="pill">not cost of sales</span></>}
                    </td>
                    <td className="r">{money(String(rl.value))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td><strong>Cost of goods sold</strong></td>
                  <td className="r"><strong>{money(String(cogsBreakdown.sold))}</strong></td>
                </tr>
                <tr>
                  <td>Stock released for other reasons</td>
                  <td className="r">{money(String(cogsBreakdown.notSold))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="card-body">
            <span className="hint">
              Opening stock + stock bought &minus; closing stock = stock that
              left the shelf. A sale&rsquo;s stock passes through Goods Shipped
              Not Invoiced and becomes cost of goods sold when the invoice
              posts. Stock that left any other way &mdash; a giveaway, a
              write-off &mdash; is shown separately: it is not cost of goods sold.
            </span>{" "}
            <Link className="subline" href={{
              pathname: "/finance/inventory-cogs",
              query: { from: range.from, to: range.to, ...(branchId ? { branch: branchId } : {}) },
            }}>full reconciliation</Link>
          </div>
        </details>
      )}
    </>
  );
}

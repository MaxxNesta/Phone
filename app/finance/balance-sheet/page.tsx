import { money } from "@/lib/db";
import { AutoApply } from "@/components/auto-apply";
import { UNASSIGNED_BRANCH } from "@/lib/queries";
import { StatementTable } from "@/components/statement-table";
import { HelpHint } from "@/components/help-hint";
import { getBalanceSheetData, type Params } from "./data";

export default async function BalanceSheet({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const data = await getBalanceSheetData(await searchParams);
  if (!data) return <div className="empty">No company found.</div>;
  const {
    company, branches, unassignedLines, branchId, asOf,
    summaries, sections, subtotals, scope,
  } = data;

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
          <label className="stmt-ctl" htmlFor="asOf"><span>As of</span>
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

      <StatementTable
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
    </>
  );
}

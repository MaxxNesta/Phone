import Link from "next/link";
import { Printer, ChevronRight } from "lucide-react";
import { money } from "@/lib/db";
import { AutoApply } from "@/components/auto-apply";
import { UNASSIGNED_BRANCH } from "@/lib/queries";
import { HelpHint } from "@/components/help-hint";
import { getCashFlowData, SECTIONS, type Params } from "./data";
import { CashFlowPanel } from "./panel";
import { IndirectStatementView, IndirectPanel } from "./indirect";
import { getIndirectCashFlow } from "@/lib/indirect-cash-flow";

export default async function CashFlow({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const sp = await searchParams;
  const data = await getCashFlowData(sp);
  if (!data) return <div className="empty">No company found.</div>;
  const {
    company, branches, unassignedLines, branchId, range, typed,
    beginningCash, endingCash, netChange, difference, unreconciled,
  } = data;
  const indirect = sp.method === "indirect";
  const ind = indirect ? await getIndirectCashFlow(company.id, range.from, range.to, branchId) : null;
  // The switch keeps the period and branch, and drops the open drawer: a
  // direct line and an indirect line are different questions.
  const methodHref = (m: string | null) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ from: range.from, to: range.to, branch: branchId ?? "", method: m ?? "" })) if (v) q.set(k, v);
    return `/finance/cash-flow${q.toString() ? `?${q}` : ""}`;
  };

  return (
    <>
      <div className="page-head">
        <h1>Cash flow statement</h1>
        <HelpHint label="What this statement shows">
          Direct method &mdash; actual cash in and out, by category, for the
          period chosen at the right. Movements between your own cash and bank accounts are
          excluded; they are not a real inflow or outflow.
        </HelpHint>
        {/* The period and branch, on the title's own line at the right, so the
            statement starts right under its name. */}
        <form className="stmt-bar">
          {indirect && <input type="hidden" name="method" value="indirect" />}
          <label className="stmt-ctl" htmlFor="from"><span>From</span>
            <input id="from" name="from" type="date" defaultValue={range.from} />
          </label>
          <label className="stmt-ctl" htmlFor="to"><span>To</span>
            <input id="to" name="to" type="date" defaultValue={range.to} />
          </label>
          {/* Which branch's cash moved. The cash side of the entry decides it:
              money leaving the Yangon till is Yangon's outflow whatever it was
              spent on, and the other leg may carry a different branch or none. */}
          {branches.length > 1 && (
            <label className="stmt-ctl" htmlFor="branch"><span>Branch</span>
              <select id="branch" name="branch" defaultValue={branchId ?? ""}>
                <option value="">All branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.code} · {b.name}</option>
                ))}
                {unassignedLines.lines > 0 && (
                  <option value={UNASSIGNED_BRANCH}>— No branch ({unassignedLines.lines} lines) —</option>
                )}
              </select>
          </label>
          )}
          <div className="stmt-bar-actions">
            <AutoApply />
            <button type="submit" data-apply>Update</button>
          </div>
        </form>
      </div>

      <div className="scopetabs" style={{ margin: "0 0 0.75rem" }} role="tablist" aria-label="Method">
        <Link scroll={false} className="scopetab" data-active={!indirect} href={methodHref(null)}>Direct Method</Link>
        <Link scroll={false} className="scopetab" data-active={indirect} href={methodHref("indirect")}>Indirect Method</Link>
      </div>
      <p className="page-sub" style={{ margin: "-0.25rem 0 0.75rem" }}>
        {indirect
          ? "Starts from net profit and adjusts for non-cash items and working capital to arrive at the change in cash."
          : "Actual cash and bank movements, by what they were for."}
      </p>


      {unassignedLines.lines > 0 && branchId === null && (
        <p className="hint" style={{ margin: "0 0 1rem" }}>
          {money(unassignedLines.debits)} was posted without choosing a branch.
          It counts in the company total but in none of the branches, so adding
          the branches together will not reach this total. Choose
          &ldquo;No branch&rdquo; above to see what those entries are.
        </p>
      )}

      {ind && ind.toReview > 0 && (
        <p className="hint" style={{ margin: "0 0 1rem" }}>
          {ind.toReview} account{ind.toReview === 1 ? "'s" : "s'"} cash flow classification is still a suggestion.{" "}
          <Link href="/settings/accounts">Review in the chart of accounts</Link>.
        </p>
      )}

      <div className={sp.line ? "cf-split" : undefined}>
      <section>
        <div className="card">
          <div className="card-head">
            <h2>Statement</h2>
            <span className="page-sub">{range.from} to {range.to}</span>
            {/* The same statement as paper, carrying the same period and
                branch — a link rather than window.print(), so what prints is
                the statement rather than the screen it was read on. */}
            <Link
              href={{ pathname: "/finance/cash-flow/print", query: {
                from: range.from, to: range.to,
                ...(branchId ? { branch: branchId } : {}),
                ...(indirect ? { method: "indirect" } : {}),
              } }}
              className="erp-hbtn noprint"
              style={{ marginLeft: "auto" }}
            >
              <Printer size={15} aria-hidden="true" /> Print
            </Link>
          </div>
          {ind ? <IndirectStatementView st={ind} sp={sp as Record<string, string | undefined>} range={range} /> : (
          <div className="tablewrap">
            <table className="cf-table">
              {SECTIONS.map((sec) => {
                const items = typed.filter((r) => r.section === sec.key);
                const total = items.reduce((s, r) => s + Number(r.amount), 0);
                if (items.length === 0) return null;
                return (
                  <tbody key={sec.key}>
                    <tr className="cf-head"><td colSpan={2}>{sec.label}</td></tr>
                    {items.map((r) => {
                      // Each line opens what it is made of, beside the statement.
                      const open = sp.line === r.category;
                      const q = new URLSearchParams();
                      for (const [k, v] of Object.entries({ from: range.from, to: range.to, branch: branchId ?? "" })) if (v) q.set(k, v);
                      if (!open) q.set("line", r.category);
                      return (
                        <tr key={r.category} className="cf-row" data-active={open || undefined}>
                          <td className="wrap">
                            <Link href={`/finance/cash-flow?${q.toString()}`} scroll={false} className="cf-line">
                              {r.category}<ChevronRight size={15} aria-hidden="true" />
                            </Link>
                          </td>
                          <td className={`r${Number(r.amount) < 0 ? " cf-neg" : ""}`}>{money(r.amount)}</td>
                        </tr>
                      );
                    })}
                    <tr className="cf-total">
                      <td>Net {sec.label.toLowerCase()}</td>
                      <td className={`r${total < 0 ? " cf-neg" : ""}`}>{money(total)}</td>
                    </tr>
                  </tbody>
                );
              })}
              <tfoot>
                <tr><td>Net change in cash</td><td className={`r${netChange < 0 ? " cf-neg" : ""}`} style={{ fontWeight: 700 }}>{money(netChange)}</td></tr>
                <tr><td>Cash at beginning of period</td><td className={`r${Number(beginningCash) < 0 ? " cf-neg" : ""}`}>{money(beginningCash)}</td></tr>
                <tr><td>Cash at end of period</td><td className={`r${Number(endingCash) < 0 ? " cf-neg" : ""}`} style={{ fontWeight: 700 }}>{money(endingCash)}</td></tr>
                {/* The statement's own proof. Ending cash is read straight
                    from the ledger while the movements above are classified
                    from it, so the two are arrived at independently and
                    printing both without comparing them hides exactly the
                    errors this report can make. */}
                <tr>
                  <td style={{ color: unreconciled ? "var(--bad)" : "var(--muted)" }}>
                    {unreconciled ? "Unexplained difference" : "Reconciles"}
                  </td>
                  <td className="r" style={{ color: unreconciled ? "var(--bad)" : "var(--muted)" }}>
                    {money(difference)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          )}
        </div>
      </section>
      {sp.line && indirect && (
        <IndirectPanel companyId={company.id} range={range} branchId={branchId} sp={sp as Record<string, string | undefined>} />
      )}
      {sp.line && !indirect && (
        <CashFlowPanel companyId={company.id} range={range} branchId={branchId} sp={sp as Record<string, string | undefined>}
          lineTotal={typed.filter((r) => r.category === sp.line).reduce((s, r) => s + Number(r.amount), 0)} />
      )}
      </div>
    </>
  );
}

import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { getCompany } from "@/lib/queries";
import { todayLocal } from "@/lib/format";
import { equityStatement, type Cols } from "@/lib/equity-statement";
import { HelpHint } from "@/components/help-hint";
import { TABS } from "../view";

export const metadata = { title: "Statement of changes in equity" };

/** Brackets for a negative, a dash for nothing, as an accountant writes it. */
const fig = (n: number) => {
  const r = Math.round(n);
  if (r === 0) return "-";
  const t = Math.abs(r).toLocaleString("en-US");
  return r < 0 ? `(${t})` : t;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

/**
 * Statement of changes in equity (2026-11-22): month by month through a year,
 * how capital, accumulated profit and other equity moved, each month opening
 * where the last one closed. Figures from the ledger (lib/equity-statement).
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const user = await requirePermission("accounting.view");
  const co = await getCompany();
  const today = todayLocal();
  const thisYear = Number(today.slice(0, 4));
  const { year: y } = await searchParams;
  const year = Number(y) >= 2000 && Number(y) <= thisYear ? Number(y) : thisYear;
  const through = year === thisYear ? Number(today.slice(5, 7)) : 12;
  const months = await equityStatement(user.companyId, year, through);

  const lastDay = (m: string) => {
    const d = new Date(`${m}T00:00:00Z`);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  };
  const name = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
  const row = (label: string, c: Cols | null, kind: "bal" | "move", key: string, single?: { col: keyof Cols; v: number }) => (
    <tr key={key} className={kind === "bal" ? "soce-bal" : undefined}>
      <td>{label}</td>
      {(["capital", "accumulated", "other", "total"] as (keyof Cols)[]).map((k) => (
        <td key={k} className="r m">{c ? fig(c[k]) : single ? fig(single.col === k || k === "total" ? single.v : 0) : "-"}</td>
      ))}
    </tr>
  );

  return (
    <div className="ie">
      <header className="ie-title page-head">
        <h1>Statement of changes in equity <HelpHint label="About this statement">
          How the owners&rsquo; equity moved, month by month: capital paid in or withdrawn,
          the profit or loss each month added to what has been earned and kept, exchange gains
          and losses on their own row, drawings, and other changes such as opening balances.
          Each month opens where the last one closed. Read from the ledger; a year-end close is
          left out because the profit it moves is already counted month by month.
        </HelpHint></h1>
      </header>
      <nav className="seg sh-tabs" aria-label="Equity views">
        {TABS.map(([k, label]) => <Link key={k} href={`/equity/${k}`} data-active={k === "statement" || undefined}>{label}</Link>)}
      </nav>

      <form className="soce-filter" method="get">
        <label htmlFor="year">Year</label>
        <select id="year" name="year" defaultValue={String(year)}>
          {Array.from({ length: 6 }, (_, i) => thisYear - i).map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <button type="submit" className="btn ghost tiny">Show</button>
      </form>

      <section className="card soce">
        <div className="soce-title">
          <strong>{co?.name ?? ""}</strong>
          <span>Statement of Changes in Equity</span>
          <span className="page-sub">January to {MONTHS[through - 1]} {year} · MMK</span>
        </div>
        <div className="tablewrap">
          <table className="soce-table">
            <thead>
              <tr><th />
                <th className="r">Capital</th><th className="r">Accumulated Profit/(Loss)</th>
                <th className="r">Other Changes</th><th className="r">Total</th></tr>
            </thead>
            {months.map((m) => (
              <tbody key={m.month}>
                {row(`Balance as at 1 ${name(m.month)}`, m.opening, "bal", "o")}
                {row("Net Profit/(Loss) for the Month", null, "move", "p", { col: "accumulated", v: m.profit })}
                {Math.round(m.fx) !== 0 && row("Exchange rate gain/(loss)", null, "move", "fx", { col: "accumulated", v: m.fx })}
                {Math.round(m.retained) !== 0 && row("Adjustment to retained earnings", null, "move", "re", { col: "accumulated", v: m.retained })}
                {Math.round(m.capitalIn) !== 0 && row("Capital introduced/(withdrawn)", null, "move", "c", { col: "capital", v: m.capitalIn })}
                {row("Drawing", null, "move", "d", { col: "accumulated", v: m.drawings })}
                {Math.round(m.other) !== 0 && row("Other changes", null, "move", "x", { col: "other", v: m.other })}
                {row(`Balance as at ${lastDay(m.month)} ${name(m.month)}`, m.closing, "bal", "c2")}
              </tbody>
            ))}
          </table>
        </div>
      </section>
    </div>
  );
}

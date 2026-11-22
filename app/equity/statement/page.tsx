import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { getCompany } from "@/lib/queries";
import { todayLocal } from "@/lib/format";
import { equityStatement, type Cols } from "@/lib/equity-statement";
import { sql } from "@/lib/db";
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
 * Statement of changes in equity (2026-11-22): month by month through a
 * calendar year, 1 January to 31 December, for every company,
 * how capital, accumulated profit and other equity moved, each month opening
 * where the last one closed. Figures from the ledger (lib/equity-statement).
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const user = await requirePermission("accounting.view");
  const co = await getCompany();
  const today = todayLocal();
  const thisYear = Number(today.slice(0, 4));
  // Calendar years back to the first one the ledger has, newest first.
  const [{ first }] = await sql`
    select coalesce(extract(year from min(entry_date))::int, ${thisYear}) as first
      from journal_entry where company_id = ${user.companyId}`;
  const firstYear = Math.min(Number(first), thisYear);
  const years = Array.from({ length: thisYear - firstYear + 1 }, (_, i) => thisYear - i);
  const { year: y } = await searchParams;
  const year = years.includes(Number(y)) ? Number(y) : thisYear;
  // January to December; to this month for the year in progress.
  const months = await equityStatement(user.companyId, year, today);

  /** "1 Jan 2026", "31 Dec 2026". */
  const day = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
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
          {years.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <button type="submit" className="btn ghost tiny">Show</button>
      </form>

      <section className="card soce">
        <div className="soce-title">
          <strong>{co?.name ?? ""}</strong>
          <span>Statement of Changes in Equity</span>
          <span className="page-sub">{day(months[0].start)} to {day(months[months.length - 1].end)} · MMK</span>
        </div>
        <div className="tablewrap">
          <table className="soce-table">
            <thead>
              <tr><th />
                <th className="r">Capital</th><th className="r">Accumulated Profit/(Loss)</th>
                <th className="r">Other Changes</th><th className="r">Total</th></tr>
            </thead>
            {months.map((m) => (
              <tbody key={m.start}>
                {row(`Balance as at ${day(m.start)}`, m.opening, "bal", "o")}
                {row("Net Profit/(Loss) for the Month", null, "move", "p", { col: "accumulated", v: m.profit })}
                {Math.round(m.fx) !== 0 && row("Exchange rate gain/(loss)", null, "move", "fx", { col: "accumulated", v: m.fx })}
                {Math.round(m.retained) !== 0 && row("Adjustment to retained earnings", null, "move", "re", { col: "accumulated", v: m.retained })}
                {Math.round(m.capitalIn) !== 0 && row("Capital introduced/(withdrawn)", null, "move", "c", { col: "capital", v: m.capitalIn })}
                {row("Drawing", null, "move", "d", { col: "accumulated", v: m.drawings })}
                {Math.round(m.other) !== 0 && row("Other changes", null, "move", "x", { col: "other", v: m.other })}
                {row(`Balance as at ${day(m.end)}`, m.closing, "bal", "c2")}
              </tbody>
            ))}
          </table>
        </div>
      </section>
    </div>
  );
}

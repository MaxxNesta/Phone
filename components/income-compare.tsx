"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { HelpHint } from "./help-hint";
import { StatementExportButton } from "./statement-export";
import type { StatementDoc } from "@/lib/statement-doc";
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown } from "lucide-react";
import type { CompareRow } from "@/lib/statement-compare";

/**
 * The income statement by period, one column a month, quarter or year
 * (2026-11-28). The account column stays put while the periods scroll, as on
 * the fixed-asset year report. Groups fold. A switch adds, under each figure,
 * how it moved from the period before: green when the move is good for
 * profit (sales up, costs down), red when it is not.
 */
const fmt = (n: number) => {
  if (Math.abs(n) < 0.005) return "–";
  const s = Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n < 0 ? `(${s})` : s;
};

function Change({ now, before, better }: { now: number; before: number; better: 1 | -1 }) {
  if (Math.abs(before) < 0.005 || Math.abs(now - before) < 0.005) return null;
  const pct = ((now - before) / Math.abs(before)) * 100;
  const up = now > before;
  const good = up === (better === 1);
  return (
    <span className={`icmp-chg ${good ? "good" : "bad"}`} title={`${up ? "Up" : "Down"} ${Math.abs(pct).toFixed(1)}% on the period before`}>
      {up ? <ArrowUp size={11} aria-hidden="true" /> : <ArrowDown size={11} aria-hidden="true" />}
      {Math.abs(pct) >= 1000 ? ">999" : Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%
    </span>
  );
}

/**
 * One table for every statement's Compare view: the income statement, the
 * balance sheet and both cash flow methods. Each says what Percentages
 * measures against (a row's key), and whether a Total column makes sense —
 * it does not on a balance sheet, where columns are balances, not flows.
 */
export function CompareTable({ periods, rows, currency, pctBase = "t:REVENUE", pctTitle = "each figure as a share of that period's revenue",
  showTotal = true, codes: hasCodes = true, first = "Account", drillBase, open, exportDoc }: {
  periods: { key: string; label: string; from?: string; to?: string }[];
  rows: CompareRow[];
  currency: string;
  /** The row Percentages divides by; null hides the switch. */
  pctBase?: string | null;
  pctTitle?: string;
  showTotal?: boolean;
  /** Whether the rows are accounts with codes to show. */
  codes?: boolean;
  first?: string;
  /** The page's own address (period, branch, method, layout): a row with a drill key opens its panel from it. */
  drillBase?: string;
  /** The line and period whose panel is open, to mark them. */
  open?: { line: string; pf?: string };
  /** The statement as a document, for the Export button. */
  exportDoc?: StatementDoc;
}) {
  // A line's name opens it for the whole range; a figure, for that period alone.
  const drillHref = (line: string, p?: { from?: string; to?: string }) => {
    const q = new URLSearchParams(drillBase?.split("?")[1] ?? "");
    for (const k of ["line", "pf", "pt", "lp", "q", "tab", "doc"]) q.delete(k);
    q.set("line", line);
    if (p?.from && p?.to) { q.set("pf", p.from); q.set("pt", p.to); }
    return `${drillBase?.split("?")[0] ?? ""}?${q}`;
  };
  const [shut, setShut] = useState<Set<string>>(new Set());
  // The same switches as the standard statement, plus Change. Percentages is
  // the vertical analysis (each figure against its period's revenue), Change
  // the horizontal one (each period against the one before). A viewer's
  // preference, kept in this browser only.
  const [codes, setCodes] = useState(false);
  const [pcts, setPcts] = useState(false);
  const [change, setChange] = useState(false);
  useEffect(() => {
    try {
      setCodes(localStorage.getItem("icmp-codes") === "1");
      setPcts(localStorage.getItem("icmp-pcts") === "1");
      setChange(localStorage.getItem("icmp-change") === "1");
    } catch {}
  }, []);
  const keep = (k: string, set: (b: boolean) => void) => (on: boolean) => { set(on); try { localStorage.setItem(k, on ? "1" : "0"); } catch {} };
  const revenue = pctBase ? rows.find((r) => r.key === pctBase) : undefined;
  const pctOf = (v: number, base: number | undefined) =>
    base && Math.abs(base) >= 0.005 && Math.abs(v) >= 0.005
      // A small share keeps its digits: −200,000 of 2.5 billion is −0.01%, not −0.0%.
      ? (() => { const p = (v / base) * 100; return `${p.toFixed(Math.abs(p) < 0.1 ? 2 : 1)}%`; })() : null;
  const groups = rows.filter((r) => r.kind === "group").map((r) => r.key);
  const visible = rows.filter((r) => !r.under.some((u) => shut.has(u)));
  const cols = periods.length + 1 + (showTotal ? 1 : 0);
  // A period with nothing posted yet (this month's future, a quiet month) is
  // not a 100% fall in everything: its changes are left out.
  const live = periods.map((_, i) => rows.some((r) => r.kind === "account" && Math.abs(r.values[i] ?? 0) >= 0.005));

  return (
    <section className="card icmp-card">
      <div className="icmp-bar">
        <div className="icmp-folds">
          <button type="button" className="erp-hbtn" onClick={() => setShut(new Set())}>Expand all</button>
          <button type="button" className="erp-hbtn" onClick={() => setShut(new Set(groups))}>Collapse all</button>
        </div>
        <div className="icmp-switches">
          {hasCodes && (
            <label className="stmt-switch">
              <input type="checkbox" checked={codes} onChange={(e) => keep("icmp-codes", setCodes)(e.target.checked)} />
              <span className="stmt-track" aria-hidden="true" />Account codes
            </label>
          )}
          {pctBase && (
            <span className="icmp-sw">
              <label className="stmt-switch">
                <input type="checkbox" checked={pcts} onChange={(e) => keep("icmp-pcts", setPcts)(e.target.checked)} />
                <span className="stmt-track" aria-hidden="true" />Vertical analysis
              </label>
              <HelpHint label="What vertical analysis is">Vertical analysis reads each line against a base figure in the same period: on the income statement, as a share of revenue; on the balance sheet, as a share of total assets. It shows how the business is made up — for example, that cost of sales takes 97% of every kyat sold. Here: {pctTitle}.</HelpHint>
            </span>
          )}
          <span className="icmp-sw">
            <label className="stmt-switch">
              <input type="checkbox" checked={change} onChange={(e) => keep("icmp-change", setChange)(e.target.checked)} />
              <span className="stmt-track" aria-hidden="true" />Horizontal analysis
            </label>
            <HelpHint label="What horizontal analysis is">Horizontal analysis reads each line against the period before it: the arrow shows how much it rose or fell. Green means the move is good — sales, profit or cash up, costs or debts down; red means it is not.</HelpHint>
          </span>
          <span className="page-sub">{currency}</span>
          {exportDoc && <StatementExportButton doc={exportDoc} />}
        </div>
      </div>
      <div className="icmp-wrap">
        <table className="icmp">
          <thead>
            <tr>
              <th className="icmp-first">{first}</th>
              {periods.map((p) => <th key={p.key} className="r">{p.label}</th>)}
              {showTotal && <th className="r icmp-totcol">Total</th>}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              if (r.kind === "section") return (
                <tr key={r.key} className="icmp-section"><td className="icmp-first">{r.label}</td><td colSpan={cols - 1} /></tr>
              );
              const isShut = shut.has(r.key);
              return (
                <tr key={r.key} className={`icmp-${r.kind}${r.strong ? " strong" : ""}`}>
                  <td className="icmp-first" style={{ paddingLeft: r.depth ? `${0.75 + (r.depth - 1) * 1.1 + (r.kind === "account" ? 1.3 : 0)}rem` : undefined }}>
                    {r.kind === "group" ? (
                      <button type="button" className="icmp-fold" aria-expanded={!isShut}
                              onClick={() => setShut((s) => { const n = new Set(s); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; })}>
                        {isShut ? <ChevronRight size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
                        {codes && r.code && <span className="icmp-code">{r.code}</span>}{r.label}
                      </button>
                    ) : (
                      r.drill && drillBase
                        ? <Link href={drillHref(r.drill)} scroll={false} className={`icmp-drill${open?.line === r.drill && !open.pf ? " on" : ""}`}>{r.label}<ChevronRight size={14} aria-hidden="true" /></Link>
                        : <>{codes && r.code && <span className="icmp-code">{r.code}</span>}{r.label}</>
                    )}
                  </td>
                  {r.values.map((v, i) => (
                    <td key={i} className={`r${v < 0 ? " neg" : ""}${r.drill && open?.line === r.drill && open.pf === periods[i]?.from ? " icmp-open" : ""}`}>
                      {r.drill && drillBase && Math.abs(v) >= 0.005
                        ? <Link href={drillHref(r.drill, periods[i])} scroll={false} className="icmp-num icmp-cell">{fmt(v)}</Link>
                        : <span className="icmp-num">{fmt(v)}</span>}
                      {pcts && pctOf(v, revenue?.values[i]) && <span className="icmp-pct">{pctOf(v, revenue?.values[i])}</span>}
                      {change && i > 0 && live[i] && live[i - 1] && <Change now={v} before={r.values[i - 1]} better={r.better} />}
                    </td>
                  ))}
                  {showTotal && <td className={`r icmp-totcol${r.total < 0 ? " neg" : ""}`}>
                    <span className="icmp-num">{fmt(r.total)}</span>
                    {pcts && pctOf(r.total, revenue?.total) && <span className="icmp-pct">{pctOf(r.total, revenue?.total)}</span>}
                  </td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The income statement's comparison, as it was first built. */
export const IncomeCompare = CompareTable;

"use client";
import { useEffect, useState } from "react";
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
  showTotal = true, codes: hasCodes = true, first = "Account" }: {
  periods: { key: string; label: string }[];
  rows: CompareRow[];
  currency: string;
  /** The row Percentages divides by; null hides the switch. */
  pctBase?: string | null;
  pctTitle?: string;
  showTotal?: boolean;
  /** Whether the rows are accounts with codes to show. */
  codes?: boolean;
  first?: string;
}) {
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
            <label className="stmt-switch" title={`Vertical analysis: ${pctTitle}`}>
              <input type="checkbox" checked={pcts} onChange={(e) => keep("icmp-pcts", setPcts)(e.target.checked)} />
              <span className="stmt-track" aria-hidden="true" />Percentages
            </label>
          )}
          <label className="stmt-switch" title="Horizontal analysis: each period against the one before, green when the move is a good one">
            <input type="checkbox" checked={change} onChange={(e) => keep("icmp-change", setChange)(e.target.checked)} />
            <span className="stmt-track" aria-hidden="true" />Change
          </label>
          <span className="page-sub">{currency}</span>
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
                      <>{codes && r.code && <span className="icmp-code">{r.code}</span>}{r.label}</>
                    )}
                  </td>
                  {r.values.map((v, i) => (
                    <td key={i} className={`r${v < 0 ? " neg" : ""}`}>
                      <span className="icmp-num">{fmt(v)}</span>
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

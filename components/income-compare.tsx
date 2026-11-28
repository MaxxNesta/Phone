"use client";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown } from "lucide-react";
import type { CompareRow } from "@/app/finance/income-statement/compare";

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

export function IncomeCompare({ periods, rows, currency }: {
  periods: { key: string; label: string }[];
  rows: CompareRow[];
  currency: string;
}) {
  const [shut, setShut] = useState<Set<string>>(new Set());
  const [change, setChange] = useState(false);
  // The switch is a viewer's preference, kept in this browser only.
  useEffect(() => { try { setChange(localStorage.getItem("icmp-change") === "1"); } catch {} }, []);
  const flip = (on: boolean) => { setChange(on); try { localStorage.setItem("icmp-change", on ? "1" : "0"); } catch {} };
  const groups = rows.filter((r) => r.kind === "group").map((r) => r.key);
  const visible = rows.filter((r) => !r.under.some((u) => shut.has(u)));
  const cols = periods.length + 2;
  // A period with nothing posted yet (this month's future, a quiet month) is
  // not a 100% fall in everything: its changes are left out.
  const live = periods.map((_, i) => rows.some((r) => r.kind === "account" && Math.abs(r.values[i] ?? 0) >= 0.005));

  return (
    <section className="card icmp-card">
      <div className="icmp-bar">
        <div className="icmp-folds">
          <button type="button" className="btn ghost tiny" onClick={() => setShut(new Set())}>Expand all</button>
          <button type="button" className="btn ghost tiny" onClick={() => setShut(new Set(groups))}>Groups only</button>
        </div>
        <label className="check icmp-switch">
          <input type="checkbox" checked={change} onChange={(e) => flip(e.target.checked)} />
          Show change from the period before
        </label>
        <span className="page-sub">{currency}</span>
      </div>
      <div className="icmp-wrap">
        <table className="icmp">
          <thead>
            <tr>
              <th className="icmp-first">Account</th>
              {periods.map((p) => <th key={p.key} className="r">{p.label}</th>)}
              <th className="r icmp-totcol">Total</th>
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
                        {r.label}
                      </button>
                    ) : (
                      <>{r.code && r.kind === "account" && <span className="icmp-code">{r.code}</span>}{r.label}</>
                    )}
                  </td>
                  {r.values.map((v, i) => (
                    <td key={i} className={`r${v < 0 ? " neg" : ""}`}>
                      <span className="icmp-num">{fmt(v)}</span>
                      {change && i > 0 && live[i] && live[i - 1] && <Change now={v} before={r.values[i - 1]} better={r.better} />}
                    </td>
                  ))}
                  <td className={`r icmp-totcol${r.total < 0 ? " neg" : ""}`}><span className="icmp-num">{fmt(r.total)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

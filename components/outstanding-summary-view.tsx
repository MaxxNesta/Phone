"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileSpreadsheet } from "lucide-react";
import { money } from "@/lib/format";
import type { Side, SummaryRow } from "@/lib/partner-ledger";
import { AutoSubmit } from "./auto-submit";
import { exportSummary, periodText } from "./ledger-workbook";

type Sum = Omit<SummaryRow, "partnerId" | "code" | "name" | "township">;
const KEYS = ["opening", "sale", "returned", "discount", "payment", "other", "prepaid", "balance"] as const;
const add = (rows: Sum[]): Sum => Object.fromEntries(KEYS.map((k) => [k, rows.reduce((t, r) => t + r[k], 0)])) as Sum;

/**
 * The Outstanding Summary, as the old report printed it (2026-11-25): a line
 * a partner, customers under their township with the township's total, and
 * the whole at the foot. A township folds to its total; Other shows only
 * when something sits in it.
 */
export function OutstandingSummaryView({ side, rows, townships, branches = [], sp, base }: {
  side: Side; rows: SummaryRow[];
  townships?: string[];
  branches?: { id: string; code: string; name: string }[];
  sp: { township?: string; from?: string; to?: string; branch?: string };
  base: string;
}) {
  const cust = side === "CUSTOMER";
  const showOther = rows.some((r) => Math.abs(r.other) >= 0.005);
  const cols: [keyof Sum, string][] = [
    ["opening", "Opening"], ["sale", cust ? "Sale" : "Purchase"], ["returned", "Return"], ["discount", "Disc + FOC"],
    ["payment", "Payment"], ...(showOther ? [["other", "Other"] as [keyof Sum, string]] : []),
    ["prepaid", "Prepaid"], ["balance", "Balance"],
  ];
  const groups = cust
    ? [...new Set(rows.map((r) => r.township ?? ""))].map((t) => ({ township: t, rows: rows.filter((r) => (r.township ?? "") === t) }))
    : [{ township: null as string | null, rows }];
  const all = add(rows);
  const [shut, setShut] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const cells = (s: Sum, total = false) => cols.map(([k]) => (
    <td key={k} className={[
      "r",
      !total && Math.abs(s[k]) < 0.005 && "zero",
      k === "balance" && s.balance > 0.005 && "owed",
      k === "prepaid" && s.prepaid > 0.005 && "pre",
      s[k] < -0.005 && "neg",
    ].filter(Boolean).join(" ")}>{money(s[k])}</td>
  ));
  // Each township's first serial number, so folding one does not renumber the rest.
  const firstSr = groups.map((_, i) => 1 + groups.slice(0, i).reduce((t, g) => t + g.rows.length, 0));

  return (
    <>
      <form className="sl-filter card" action={base}>
        <AutoSubmit />
        {branches.length > 1 && (
          <div className="field">
            <label htmlFor="branch">Branch</label>
            <select id="branch" name="branch" defaultValue={sp.branch ?? ""}>
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        {cust && townships && (
          <div className="field">
            <label htmlFor="township">Township</label>
            <select id="township" name="township" defaultValue={sp.township ?? ""}>
              <option value="">All townships</option>
              {townships.map((t) => <option key={t} value={t}>{t}</option>)}
              <option value="-">No township</option>
            </select>
          </div>
        )}
        <div className="field"><label htmlFor="from">From</label><input id="from" name="from" type="date" defaultValue={sp.from ?? ""} /></div>
        <div className="field"><label htmlFor="to">To</label><input id="to" name="to" type="date" defaultValue={sp.to ?? ""} /></div>
        <div className="actions">
          <button type="button" className="dt-tool" disabled={busy || rows.length === 0}
            onClick={async () => { setBusy(true); try { await exportSummary(side, rows, periodText(sp.from, sp.to), showOther); } finally { setBusy(false); } }}>
            <FileSpreadsheet size={15} aria-hidden="true" /> {busy ? "Exporting…" : "Export"}
          </button>
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="card"><div className="empty">Nothing in this period.</div></div>
      ) : (
        <div className="card">
          {cust && (
            <div className="os-fold" role="group" aria-label="Fold">
              <button type="button" onClick={() => setShut(new Set())}>Expand all</button>
              <button type="button" onClick={() => setShut(new Set(groups.map((g) => g.township ?? "")))}>Townships only</button>
            </div>
          )}
          <div className="tablewrap">
            <table className="os os-sum">
              <colgroup><col className="c-sr" /><col className="c-code" /><col className="c-name" />{cols.map(([k]) => <col key={k} className="c-amt" />)}</colgroup>
              <thead>
                <tr><th>Sr.</th><th>Code</th><th>{cust ? "Customer" : "Supplier"}</th>
                  {cols.map(([k, l]) => <th key={k} className="r">{l}</th>)}</tr>
              </thead>
              {groups.map((g, gi) => {
                const key = g.township ?? "";
                const closed = shut.has(key);
                return (
                  <tbody key={key || "all"}>
                    {cust && (
                      <tr className="os-town" onClick={() => setShut((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; })} aria-expanded={!closed}>
                        <td colSpan={3 + cols.length}>
                          {closed ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                          <span>Township</span>{g.township || "No township"}<em>{g.rows.length} customer{g.rows.length === 1 ? "" : "s"}</em>
                        </td>
                      </tr>
                    )}
                    {!closed && g.rows.map((r, i) => (
                      <tr key={r.partnerId}>
                        <td className="muted">{firstSr[gi] + i}</td>
                        <td className="code">{r.code}</td>
                        <td className="name">{r.name}</td>
                        {cells(r)}
                      </tr>
                    ))}
                    {cust && (
                      <tr className="os-towntotal">
                        <td colSpan={3}>{g.township || "No township"} total</td>
                        {cells(add(g.rows), true)}
                      </tr>
                    )}
                  </tbody>
                );
              })}
              <tfoot>
                <tr><td colSpan={3}>Total</td>{cells(all, true)}</tr>
              </tfoot>
            </table>
          </div>
          <p className="hint os-note">
            Opening + {cust ? "sale" : "purchase"} − return − discount − payment{showOther ? " + other" : ""} = balance − prepaid.
            Prepaid is money {cust ? "received" : "paid"} ahead and not yet set against {cust ? "an invoice" : "a bill"}; balance is what {cust ? "invoices" : "bills"} still owe.
          </p>
        </div>
      )}
    </>
  );
}

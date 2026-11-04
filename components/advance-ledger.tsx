"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { money, shortDate } from "@/lib/format";
import type { AdvanceRow } from "@/lib/queries";
import { ExportCsvButton } from "@/components/export-csv";
import { DateFilter, ANY_DATE, inDateRange, type DateRange } from "@/components/date-filter";

const TABS = [["", "All"], ["open", "Unapplied"], ["spent", "Fully applied"]] as const;
const PAGE_SIZES = [10, 25, 50, 100];

/**
 * Every advance, and what became of it.
 *
 * How much was taken, how much of it has gone and against which bills, and
 * what is left — each advance keeps its row after it is spent, with its
 * applications folded under it. Nothing here is stored: taken is the document,
 * applied is the sum of allocations that still stand, and what is left is the
 * difference. Narrowed to one supplier or customer, the cards are that one's
 * own balance.
 */
export function AdvanceLedger({ side, advances }: { side: "CUSTOMER" | "SUPPLIER"; advances: AdvanceRow[] }) {
  const sales = side === "CUSTOMER";
  const who = sales ? "Customer" : "Supplier";
  const [tab, setTab] = useState<"" | "open" | "spent">("");
  const [q, setQ] = useState("");
  const [dates, setDates] = useState<DateRange>(ANY_DATE);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [size, setSize] = useState(10);
  const [page, setPage] = useState(0);

  const state = (r: AdvanceRow) => (r.remaining > 0.0001 ? "open" : "spent");
  // One search for the partner and the documents. The cards follow it and the
  // dates, not the tab: typing a supplier's name shows that supplier's own balance.
  const scoped = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return advances.filter((r) => inDateRange(r.doc_date, dates) && (!needle || [r.partner_code, r.partner_name, r.doc_no, r.old_ref, r.account, r.reference,
      ...r.applications.flatMap((a) => [a.invoice_no, a.invoice_ref, a.application_no])].some((x) => x && String(x).toLowerCase().includes(needle))));
  }, [advances, q, dates]);
  const shown = useMemo(() => scoped.filter((r) => !tab || state(r) === tab), [scoped, tab]);
  useEffect(() => setPage(0), [tab, q, dates, size]);
  const pages = Math.max(1, Math.ceil(shown.length / size));
  const rows = shown.slice(page * size, page * size + size);

  const left = scoped.reduce((s, r) => s + r.remaining, 0);
  const taken = scoped.reduce((s, r) => s + r.taken, 0);
  const applied = scoped.reduce((s, r) => s + r.applied, 0);

  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // The export keeps what the screen folds under each advance: one line for the
  // money, then one per invoice it went to — so the file answers "which bills".
  const csv: (string | number)[][] = [[
    "Line", "Date", "Document", "Old ref", `${who} code`, who, "Branch", sales ? "Received into" : "Paid from",
    sales ? "Advance received" : "Advance paid", "Applied", "Remaining", "Applied on", "Application", "Invoice", "Invoice old ref", "Amount applied",
  ]];
  for (const r of shown) {
    const lead = [r.doc_date, r.doc_no, r.old_ref ?? "", r.partner_code, r.partner_name, r.branch ?? "", r.account ?? ""];
    csv.push(["Advance", ...lead, r.taken, r.applied, r.remaining, "", "", "", "", ""]);
    for (const a of r.applications) csv.push(["Applied", ...lead, "", "", "", a.applied_on, a.application_no ?? "when taken", a.invoice_no, a.invoice_ref ?? "", a.amount]);
  }

  return (
    <>
      <div className="kpis adv-kpis">
        <div className="kpi"><span className="kpi-label">Unapplied advance</span><span className="kpi-value">{money(left)} <small>MMK</small></span></div>
        <div className="kpi"><span className="kpi-label">{sales ? "Advance received" : "Advance paid"}</span><span className="kpi-value">{money(taken)} <small>MMK</small></span></div>
        <div className="kpi"><span className="kpi-label">Applied</span><span className="kpi-value">{money(applied)} <small>MMK</small></span></div>
      </div>

      <div className="adv-bar">
        <div className="segmented" role="tablist" aria-label="Show">
          {TABS.map(([v, label]) => (
            <button key={v} type="button" role="tab" aria-selected={tab === v} className={`seg${tab === v ? " on" : ""}`} onClick={() => setTab(v)}>{label}</button>
          ))}
        </div>
        <label className="adv-search">
          <Search size={15} aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${who.toLowerCase()} or document`} aria-label={`Search advances by ${who.toLowerCase()}, document or old reference`} />
        </label>
        <DateFilter value={dates} onChange={setDates} />
        <span className="adv-bar-end">
          <ExportCsvButton name={sales ? "customer-advances" : "supplier-advances"} rows={csv} />
          <Link href={sales ? "/receivables/receive" : "/payables/pay"} className="btn">{sales ? "Receive payment" : "Pay supplier"}</Link>
        </span>
      </div>

      <div className="card">
        <div className="tablewrap">
          <table className="adv-table">
            <thead>
              <tr>
                <th className="adv-chev" /><th>Date</th><th>Document</th><th>{who}</th><th>{sales ? "Received into" : "Paid from"}</th>
                <th className="r">{sales ? "Advance received" : "Advance paid"}</th><th className="r">Applied</th><th className="r">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={8} className="empty">{tab === "spent" ? "None fully applied yet" : tab === "open" ? "Nothing unapplied" : `No ${who.toLowerCase()} advances`}</td></tr>
              )}
              {rows.map((r) => {
                const isOpen = open.has(r.id);
                const [code, ...rest] = (r.account ?? "").split(" · ");
                return (
                  <Fragment key={r.id}>
                    <tr className={`adv-row${isOpen ? " open" : ""}`}>
                      <td className="adv-chev">
                        <button type="button" className="vicon" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} where ${r.doc_no} went`}
                          onClick={() => toggle(r.id)} disabled={r.applications.length === 0}>
                          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                      </td>
                      <td className="m">{shortDate(r.doc_date)}</td>
                      <td className="m">
                        <Link href={`/documents/${r.id}`}>{r.doc_no}</Link>
                        {r.old_ref && <div className="subline">{r.old_ref}</div>}
                      </td>
                      <td>{r.partner_name}<div className="subline">{r.partner_code}</div></td>
                      <td>{rest.length ? rest.join(" · ") : r.account ?? "—"}{rest.length > 0 && <div className="subline">{code}</div>}</td>
                      <td className="r">{money(r.taken)}</td>
                      <td className="r">{money(r.applied)}</td>
                      <td className="r">{r.remaining > 0.0001 ? <strong>{money(r.remaining)}</strong> : "0"}</td>
                    </tr>
                    {isOpen && (
                      <tr className="adv-apps">
                        <td />
                        <td colSpan={7}>
                          <div className="adv-apps-box">
                            <div className="adv-apps-head">Applications</div>
                            {r.applications.map((a) => (
                              <div key={a.invoice_id + (a.application_id ?? "")} className="adv-app">
                                <span className="m">{shortDate(a.applied_on)}</span>
                                <span>
                                  <Link href={`/documents/${a.invoice_id}`} className="m">{a.invoice_no}</Link>
                                  {a.invoice_ref && <span className="subline"> · {a.invoice_ref}</span>}
                                  {a.application_no
                                    ? <span className="subline"> · by <Link href={`/documents/${a.application_id}`}>{a.application_no}</Link></span>
                                    : <span className="subline"> · when taken</span>}
                                </span>
                                <span className="r">{money(a.amount)}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="adv-foot">
        <span className="page-sub">{shown.length} advance{shown.length === 1 ? "" : "s"}</span>
        <span className="adv-pager">
          {pages > 1 && (
            <>
              <button type="button" className="ghost tiny" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
              <span className="page-sub">{page + 1} / {pages}</span>
              <button type="button" className="ghost tiny" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
            </>
          )}
          <select value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Rows per page">
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} per page</option>)}
          </select>
        </span>
      </div>
    </>
  );
}

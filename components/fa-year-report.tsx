"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import type { MonthCell, ScheduleAsset, SummaryGroup, SummaryRow } from "@/lib/fa-year";
import { registerHeaders } from "@/lib/fa-import";
import { HelpHint } from "@/components/help-hint";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const money = (v: number) => Math.round(v).toLocaleString("en-US");

/** A CSV of what is on screen, downloaded from the browser. */
function download(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

export function ExportButton({ onExport }: { onExport: () => void }) {
  return <button type="button" className="ie-btn primary" onClick={onExport}><Download size={15} aria-hidden="true" /> Export</button>;
}

// ------------------------------------------------------------ summary --

export function CategorySummary({ year, groups, total, link }: {
  year: number; groups: SummaryGroup[]; total: SummaryRow;
  /** The asset schedule for a category or subcategory. */
  link: Record<string, string>;
}) {
  const [planned, setPlanned] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set(groups.slice(0, 1).map((g) => g.id)));
  const withDisposals = total.months.some((c) => c.disposals);
  const cols = (c: MonthCell) => [c.additions, ...(withDisposals ? [c.disposals] : []), planned ? c.depAll : c.depPosted, planned ? c.nbvAll : c.nbvPosted];
  const heads = ["Additions", ...(withDisposals ? ["Disposals"] : []), "Depreciation", "Closing NBV"];
  const toggle = (id: string) => { const s = new Set(open); if (s.has(id)) s.delete(id); else s.add(id); setOpen(s); };
  const cells = (r: SummaryRow) => r.months.flatMap((c, k) => cols(c).map((v, i) => <td key={`${k}-${i}`} className={`r${i === 0 ? " fay-m" : ""}`}>{money(v)}</td>));

  const exportCsv = () => download(`fixed-assets-category-summary-${year}-${planned ? "planned" : "posted"}.csv`, [
    ["Category", "Subcategory", "Assets", ...MON.flatMap((m) => heads.map((h) => `${m} ${year} ${h}`))],
    ...groups.flatMap((g) => [[g.name, "", g.assets, ...g.months.flatMap(cols)], ...g.subs.map((s) => [g.name, s.name, s.assets, ...s.months.flatMap(cols)])]),
    ["Total", "", total.assets, ...total.months.flatMap(cols)],
  ]);

  return (
    <>
      <div className="fay-bar">
        <div className="segmented" role="radiogroup" aria-label="Depreciation shown">
          <button type="button" role="radio" aria-checked={!planned} className={`seg${planned ? "" : " on"}`} onClick={() => setPlanned(false)}>Posted</button>
          <button type="button" role="radio" aria-checked={planned} className={`seg${planned ? " on" : ""}`} onClick={() => setPlanned(true)}>Planned</button>
        </div>
        <span className="ie-note"><HelpHint label="Posted and planned">Posted is only what the ledger carries. Planned is the whole schedule: posted, ready to post and planned months. Scroll sideways for later months.</HelpHint></span>
        <ExportButton onExport={exportCsv} />
      </div>
      <div className="tablewrap fay-wrap">
        <table className="fay">
          <thead>
            <tr><th rowSpan={2} className="fay-first">Category</th>{MON.map((m) => <th key={m} colSpan={heads.length} className="fay-month">{m} {year}</th>)}</tr>
            <tr>{MON.flatMap((m) => heads.map((h, i) => <th key={m + h} className={`r fay-sub-h${i === 0 ? " fay-m" : ""}`}>{h}</th>))}</tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.id}>
                <tr className="fay-group">
                  <th className="fay-first">
                    <button type="button" className="fay-toggle" aria-expanded={open.has(g.id)} onClick={() => toggle(g.id)}>
                      {open.has(g.id) ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                      <strong>{g.name}</strong>
                    </button>
                    <Link href={link[`h:${g.id}`]} className="fay-count">{g.assets} asset{g.assets === 1 ? "" : "s"} →</Link>
                  </th>
                  {cells(g)}
                </tr>
                {open.has(g.id) && g.subs.map((s) => (
                  <tr key={s.id} className="fay-subrow">
                    <th className="fay-first"><Link href={link[s.id]}>{s.name}</Link><span className="fay-count">{s.assets} asset{s.assets === 1 ? "" : "s"}</span></th>
                    {cells(s)}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
          <tfoot><tr className="fay-total"><th className="fay-first">Total</th>{cells(total)}</tr></tfoot>
        </table>
      </div>
    </>
  );
}

// ----------------------------------------------------------- schedule --

const STATE_LABEL = { POSTED: "Posted", DUE: "Ready to post", PLANNED: "Planned" } as const;

export function AssetSchedule({ year, assets }: { year: number; assets: ScheduleAsset[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const heads = registerHeaders(year);
  const startText = (m: string | null) => (m ? `${MON[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}` : "");
  const dateText = (d: string) => `${d.slice(8, 10)} ${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
  // The same columns, in the same order, as the register the import reads, so an export pastes back in.
  const exportCsv = () => download(`fixed-assets-schedule-${year}.csv`, [
    heads,
    ...assets.map((a, i) => [i + 1, a.name, a.notes, a.heading, a.category, a.life, startText(a.start), dateText(a.acquired), a.quantity, Math.round(a.cost / a.quantity * 100) / 100, a.cost, "",
      a.opening, ...a.months.map((c) => c?.amount ?? 0), a.closing]),
  ]);
  const total = (pick: (a: ScheduleAsset) => number) => money(assets.reduce((t, a) => t + pick(a), 0));
  return (
    <>
      <div className="fay-bar">
        <span className="fay-legend">
          <span><i className="fay-dot posted" /> Posted</span>
          <span><i className="fay-dot due" /> Ready to post</span>
          <span><i className="fay-dot planned" /> Planned</span>
        </span>
        <span className="ie-note" />
        <ExportButton onExport={exportCsv} />
      </div>
      <div className="tablewrap fay-wrap">
        <table className="fay fay-sched">
          <thead><tr>
            {heads.map((h, i) => (
              <th key={h} className={i === 0 ? "fay-no" : i === 1 ? "fay-first" : i >= 5 && i !== 6 && i !== 7 ? "r" : undefined}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {assets.map((a, i) => (
              <Fragment key={a.id}>
                <tr className={open === a.id ? "fay-open" : undefined}>
                  <td className="fay-no">{i + 1}</td>
                  <th className="fay-first">
                    <button type="button" className="fay-toggle" aria-expanded={open === a.id} aria-label={`Details of ${a.name}`} onClick={() => setOpen(open === a.id ? null : a.id)}>
                      {open === a.id ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                    </button>
                    <Link href={`/fixed-assets/${a.id}`} title={a.name}>{a.name}</Link><span className="fay-count">{a.code}</span>
                  </th>
                  <td className="fay-notes" title={a.notes}>{a.notes || "—"}</td>
                  <td className="nowrap">{a.heading}</td>
                  <td className="nowrap">{a.category}</td>
                  <td className="r">{a.life}</td>
                  <td className="nowrap">{startText(a.start) || "—"}</td>
                  <td className="nowrap">{dateText(a.acquired)}</td>
                  <td className="r">{a.quantity}</td>
                  <td className="r">{money(a.cost / a.quantity)}</td>
                  <td className="r">{money(a.cost)}</td>
                  <td className="r">{a.disposedOn ? <span title={`Disposed of ${a.disposedOn}`}>{a.disposedOn}</span> : <span className="fay-none">—</span>}</td>
                  <td className="r">{money(a.opening)}</td>
                  {a.months.map((c, k) => <td key={k} className={`r fay-${c?.state.toLowerCase() ?? "none"}`} title={c ? STATE_LABEL[c.state] : undefined}>{c ? money(c.amount) : "—"}</td>)}
                  <td className="r"><strong>{money(a.closing)}</strong></td>
                </tr>
                {open === a.id && (
                  <tr className="fay-detail"><td /><td colSpan={25}>
                    <dl>
                      <div><dt>Code</dt><dd>{a.code}</dd></div>
                      <div><dt>In service</dt><dd>{a.inService ?? "Not in service"}</dd></div>
                      <div><dt>Method</dt><dd>Straight line, from the start month in full</dd></div>
                      <div><dt>Residual value</dt><dd>{money(a.residual)}</dd></div>
                      <div><dt>Branch</dt><dd>{a.branch}</dd></div>
                    </dl>
                    <span className="fay-links">
                      <Link href={`/fixed-assets/${a.id}`}>View asset details →</Link>
                      {a.start && <Link href={`/fixed-assets/calendar?year=${a.start.slice(0, 4)}&month=${a.start}`}>View {startText(a.start)} in calendar →</Link>}
                    </span>
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
          <tfoot><tr className="fay-total">
            <td className="fay-no" /><th className="fay-first">Total</th><td colSpan={8} />
            <td className="r">{total((a) => a.cost)}</td><td />
            <td className="r">{total((a) => a.opening)}</td>
            {MON.map((m, k) => <td key={m} className="r">{total((a) => a.months[k]?.amount ?? 0)}</td>)}
            <td className="r">{total((a) => a.closing)}</td>
          </tr></tfoot>
        </table>
      </div>
    </>
  );
}

"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, useTransition } from "react";
import { AlertCircle, Check, ChevronDown, ChevronRight, CircleCheck, ClipboardPaste, Info, Pencil } from "lucide-react";
import { parseTsv } from "@/lib/import-purchase-invoices";
import { HelpHint } from "@/components/help-hint";
import { importAssets, type FaImportResult } from "@/lib/fa-actions";
import {
  FA_COLUMNS, FA_OPTIONAL, parseRegister, reviewRows, unknownSubcategories, showMonth,
  type Branch, type Category, type DraftRow, type ExistingAsset, type ReviewedRow,
} from "@/lib/fa-import";
import type { Convention } from "@/lib/fa-engine";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 0 }));
const day = (d: string | null) => (d ? `${d.slice(8, 10)} ${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : "—");
/** A, B … Z: the letters Excel puts over its columns. */
const colName = (i: number): string => (i < 26 ? "" : colName(Math.floor(i / 26) - 1)) + String.fromCharCode(65 + (i % 26));
const STATUS = { ready: "Ready", review: "Needs review", attention: "Needs attention" } as const;

/**
 * Fixed Assets › Asset Register › Import: paste the register, review each
 * row against the chart and MTK's own schedule, import the ones that are
 * right. The server reviews again before it saves. Nothing is posted.
 */
export function FaImport({ categories, branches, existing, convention, defaultBranchId }: {
  categories: Category[]; branches: Branch[]; existing: ExistingAsset[]; convention: Convention; defaultBranchId: string | null;
}) {
  const [parsed, setParsed] = useState<ReturnType<typeof parseRegister> | "none" | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [subMap, setSubMap] = useState<Record<string, string>>({});
  const [branchId, setBranchId] = useState<string | null>(defaultBranchId);
  const [nbvMonth, setNbvMonth] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [result, setResult] = useState<FaImportResult | null>(null);
  const [busy, startImport] = useTransition();
  const p = parsed && parsed !== "none" ? parsed : null;
  const ctx = { categories, branches, existing, subMap, branchId, convention, year: p?.year ?? new Date().getFullYear(), nbvMonth: nbvMonth ?? p?.inferred?.month ?? null };
  const rows = useMemo(() => reviewRows(drafts, ctx), [drafts, subMap, branchId, nbvMonth, p]); // eslint-disable-line react-hooks/exhaustive-deps
  const unknown = useMemo(() => unknownSubcategories(drafts, categories), [drafts, categories]);
  const step = result?.ok ? 3 : p ? 2 : 1;
  const count = (s: ReviewedRow["status"]) => rows.filter((r) => r.status === s).length;
  const toImport = rows.filter((r) => r.include && r.status !== "attention");
  const headings = [...new Set(categories.map((c) => c.group ?? "Other"))];

  function paste(text: string) {
    const got = parseRegister(parseTsv(text));
    if (!got) { setParsed("none"); return; }
    // A possible duplicate starts left out; ticking it back in is a choice.
    const first = reviewRows(got.drafts, { ...ctx, year: got.year, nbvMonth: got.inferred?.month ?? null });
    setDrafts(got.drafts.map((d, i) => ({ ...d, include: !first[i].duplicateOf })));
    setParsed(got); setOpen(null); setEditing(null); setResult(null); setNbvMonth(null);
  }
  const edit = (line: number, patch: Partial<DraftRow>) => setDrafts((ds) => ds.map((d) => (d.line === line ? { ...d, ...patch } : d)));
  function restart() { setParsed(null); setDrafts([]); setSubMap({}); setResult(null); }
  function doImport() {
    startImport(async () => {
      setResult(await importAssets({ drafts, subMap, branchId, year: ctx.year }));
    });
  }

  return (
    <div className="fai">
      <ol className="pimp-steps" aria-label="Steps">
        {["Paste data", "Review assets", "Import"].map((s, i) => (
          <li key={s} data-state={step > i + 1 ? "done" : step === i + 1 ? "now" : "next"} aria-current={step === i + 1 ? "step" : undefined}>
            <span className="pimp-dot">{step > i + 1 ? <Check size={14} aria-hidden="true" /> : i + 1}</span>{s}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <>
          <section className="ie-card fai-guide">
            <h3>Columns to match <HelpHint label="About the columns">Copy from the header row down. Columns are found by their header, in any order; extra columns (months, NBV) are ignored or used only for comparison. Also read when present: {FA_OPTIONAL.join(", ")}. The bottom row is the MTK field each column fills.</HelpHint></h3>
            <div className="fai-xl-wrap">
              <table className="fai-xl">
                <thead><tr><th />{FA_COLUMNS.map((c, i) => <th key={i}>{colName(i)}</th>)}</tr></thead>
                <tbody>
                  <tr className="fai-xl-head"><th>1</th>{FA_COLUMNS.map((c, i) => <td key={i} title={c.use}>{c.header}</td>)}</tr>
                  <tr><th>2</th>{FA_COLUMNS.map((c, i) => <td key={i} title={c.example} className={/^[\d,.]+$/.test(c.example) ? "r" : undefined}>{c.example}</td>)}</tr>
                  <tr className="fai-xl-field"><th>MTK</th>{FA_COLUMNS.map((c, i) => <td key={i}>{c.field === "—" ? "checked only" : c.field}</td>)}</tr>
                </tbody>
              </table>
            </div>
          </section>
          <label className="pimp-paste">
            <ClipboardPaste size={30} aria-hidden="true" />
            <span className="pimp-paste-t">Copy the asset register in Excel, then paste it here</span>
            <span className="hint">Select from the header row down · Ctrl+C · click here · Ctrl+V</span>
            <textarea aria-label="Paste the asset register from Excel" value="" onChange={(e) => paste(e.target.value)}
              onPaste={(e) => { e.preventDefault(); paste(e.clipboardData.getData("text/plain")); }} />
          </label>
          {parsed === "none" && (
            <div className="alert">No header row was found. It needs a <strong>Total cost</strong> column and an <strong>Asset name</strong> or
              <strong> Notes / original description</strong> column, with the other headers as in the guide.</div>
          )}
        </>
      )}

      {step === 2 && p && (
        <section className="ie-card fai-review">
          <div className="fai-controls">
            <label className="ie-field"><span>Branch for every row</span>
              <select value={branchId ?? ""} onChange={(e) => setBranchId(e.target.value || null)}>
                <option value="">Choose…</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></label>
            {p.hasMonths && (
              <label className="ie-field"><span>File&apos;s NBV is as of</span>
                <select value={ctx.nbvMonth ?? ""} onChange={(e) => setNbvMonth(e.target.value === "" ? null : Number(e.target.value))}>
                  {ctx.nbvMonth === null && <option value="">Last month with a figure</option>}
                  {MON.map((m, k) => <option key={m} value={k}>{m} {p.year}{p.inferred?.month === k ? ` · fits ${p.inferred.matches} rows` : ""}</option>)}
                </select></label>
            )}
            <div className="ie-field"><span>Purchase accounting</span><output className="ie-ro">Needs review <HelpHint label="Purchase accounting">Importing records the asset and its schedule only. Its purchase (cash, bank, payable or an opening balance) is linked or recorded afterwards in Journal Reconciliation; until then the asset is not reconciled to the ledger.</HelpHint></output></div>
          </div>

          {p.wrongHeaders.length > 0 && <div className="alert">The header row (line {p.headerLine}) has {p.wrongHeaders.join("; ")}.</div>}

          {unknown.length > 0 && (
            <div className="fai-mapping">
              <strong>Subcategories MTK does not have</strong> <span className="ie-note">Map each once; every row using it follows.</span>
              <div className="fai-map-grid">
                {unknown.map((u) => (
                  <label key={u.key} className="ie-field">
                    <span>“{u.text}”{u.group ? ` (${u.group})` : ""}</span>
                    <select value={subMap[u.key] ?? ""} onChange={(e) => setSubMap({ ...subMap, [u.key]: e.target.value })}>
                      <option value="">Map to…</option>
                      {headings.map((h) => (
                        <optgroup key={h} label={h}>
                          {categories.filter((c) => (c.group ?? "Other") === h).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          )}

          <p className="fai-summary">
            Paste contains <strong>{rows.length} assets</strong>
            {count("review") > 0 && <> · <span className="fai-s-review">{count("review")} need review</span></>}
            {count("attention") > 0 && <> · <span className="fai-s-attention">{count("attention")} need attention</span></>}
            {" · "}{toImport.length} to import
          </p>

          <div className="tablewrap">
            <table className="fai-rows">
              <thead><tr>
                <th className="fai-check"><input type="checkbox" aria-label="Include every row" checked={rows.every((r) => r.include)}
                  onChange={(e) => setDrafts((ds) => ds.map((d) => ({ ...d, include: e.target.checked })))} /></th>
                <th>Asset</th><th>Category &amp; subcategory</th><th>Dates</th><th>Branch</th>
                <th className="r">Qty</th><th className="r">Cost</th><th className="r">Life</th><th>Review</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const isOpen = open === r.line;
                  return (
                    <Fragment key={r.line}>
                      <tr className={`fai-row ${r.status}${r.include ? "" : " fai-out"}`}>
                        <td className="fai-check"><input type="checkbox" aria-label={`Include ${r.name}`} checked={r.include} onChange={(e) => edit(r.line, { include: e.target.checked })} /></td>
                        <td className="fai-desc">
                          <button type="button" className="fai-toggle" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.line)}>
                            {isOpen ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                            <strong title={r.name}>{r.name || "—"}</strong>
                          </button>
                          <div className="fai-sub">Row {r.no || r.line}</div>
                        </td>
                        <td>{r.category ? <><strong>{r.category.group ?? r.groupText}</strong><div className="fai-sub">{r.category.name}</div></>
                          : <span className="fai-bad">{r.subText || "No subcategory"}</span>}</td>
                        <td className="nowrap">Acquired {day(r.acquired)}<div className="fai-sub">Starts {r.start ? showMonth(r.start) : "by the rule"}</div></td>
                        <td>{branches.find((b) => b.id === r.branchId)?.name ?? <span className="fai-bad">—</span>}</td>
                        <td className="r">{money(r.qty ?? 1)}</td>
                        <td className="r"><strong>{money(r.cost)}</strong></td>
                        <td className="r nowrap">{r.life ? `${r.life} months` : "—"}</td>
                        <td><span className={`fai-pill ${r.status}`}>{r.duplicateOf ? "Possible duplicate" : STATUS[r.status]}</span></td>
                      </tr>
                      {isOpen && (
                        <tr className="fai-detail"><td /><td colSpan={8}>
                          <dl className="fai-facts">
                            <div><dt>Monthly depreciation</dt><dd><strong>{money(r.monthly)} MMK</strong></dd></div>
                            <div><dt>Unit price</dt><dd>{money(r.price ?? (r.cost !== null ? r.cost / (r.qty || 1) : null))}</dd></div>
                            <div><dt>Accounts</dt><dd className="mono">{r.category ? categories.find((c) => c.id === r.category!.id)?.accounts ?? "—" : "—"}</dd></div>
                            <div><dt>Purchase accounting</dt><dd><span className="fai-pill review">Needs review</span></dd></div>
                            <div><dt>Opening accumulated</dt><dd>{r.opening ? `${money(r.opening)} through ${r.openingThrough ? showMonth(r.openingThrough) : "?"}` : r.openingBlank ? "Blank" : "0"}</dd></div>
                            <div className="fai-fullnotes"><dt>Notes (original description)</dt><dd>{r.notes || "—"}</dd></div>
                          </dl>
                          {r.issues.length > 0 && <ul className="fai-issues">{r.issues.map((i, k) => <li key={k} className={i.level}>{i.text}</li>)}</ul>}
                          {p.hasMonths && (
                            <table className="fai-months">
                              <thead><tr><th />{MON.map((m) => <th key={m} className="r">{m}</th>)}</tr></thead>
                              <tbody>
                                <tr><th>File</th>{r.excel.map((v, k) => <td key={k} className="r">{money(v)}</td>)}</tr>
                                <tr><th>MTK</th>{r.mtk.map((v, k) => <td key={k} className={`r${r.excel[k] !== null && Math.abs((r.excel[k] ?? 0) - v) > 1 ? " fai-diff" : ""}`}>{money(v)}</td>)}</tr>
                              </tbody>
                            </table>
                          )}
                          {editing === r.line ? (
                            <RowEditor row={r} categories={categories} headings={headings} branches={branches} onChange={(patch) => edit(r.line, patch)} onDone={() => setEditing(null)} />
                          ) : (
                            <button type="button" className="ie-btn fai-edit" onClick={() => setEditing(r.line)}><Pencil size={14} aria-hidden="true" /> Edit details</button>
                          )}
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="fai-info"><Info size={16} aria-hidden="true" /> Each asset&apos;s schedule is calculated by MTK after import. No purchase, payment or depreciation journal is posted by this import.</p>
          {result && !result.ok && <div className="alert" role="alert">{result.error}</div>}
          <div className="fai-foot">
            <button type="button" className="ie-btn" onClick={restart}>Back to paste</button>
            <button type="button" className="ie-btn primary" disabled={busy || toImport.length === 0} onClick={doImport}>
              {busy ? "Importing…" : `Import ${toImport.length} asset${toImport.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </section>
      )}

      {step === 3 && result?.ok && <Done result={result} onRestart={restart} />}
    </div>
  );
}

/** Corrections to one row, without pasting the batch again. */
function RowEditor({ row, categories, headings, branches, onChange, onDone }: {
  row: ReviewedRow; categories: Category[]; headings: string[]; branches: Branch[];
  onChange: (patch: Partial<DraftRow>) => void; onDone: () => void;
}) {
  const n = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")));
  return (
    <div className="fai-editor">
      <label className="ie-field fai-wide"><span>Asset name</span><input value={row.name} onChange={(e) => onChange({ name: e.target.value })} /></label>
      <label className="ie-field"><span>Subcategory</span>
        <select value={row.category?.id ?? ""} onChange={(e) => onChange({ categoryId: e.target.value || null })}>
          <option value="">Choose…</option>
          {headings.map((h) => <optgroup key={h} label={h}>{categories.filter((c) => (c.group ?? "Other") === h).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}
        </select></label>
      <label className="ie-field"><span>Branch</span>
        <select value={row.branchId ?? ""} onChange={(e) => onChange({ branchId: e.target.value || null })}>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select></label>
      <label className="ie-field"><span>Asset date</span><input type="date" value={row.acquired ?? ""} onChange={(e) => onChange({ acquired: e.target.value || null, acquiredUnsure: false })} /></label>
      <label className="ie-field"><span>In-service date</span><input type="date" value={row.inService ?? ""} onChange={(e) => onChange({ inService: e.target.value || null })} /></label>
      <label className="ie-field"><span>Depreciation start</span><input type="month" value={row.start ?? ""} onChange={(e) => onChange({ start: e.target.value || null, startText: e.target.value })} /></label>
      <label className="ie-field"><span>Quantity</span><input inputMode="decimal" value={row.qty ?? ""} onChange={(e) => onChange({ qty: n(e.target.value) })} /></label>
      <label className="ie-field"><span>Total cost</span><input inputMode="decimal" value={row.cost ?? ""} onChange={(e) => onChange({ cost: n(e.target.value) })} /></label>
      <label className="ie-field"><span>Residual value</span><input inputMode="decimal" value={row.residual} onChange={(e) => onChange({ residual: n(e.target.value) ?? 0 })} /></label>
      <label className="ie-field"><span>Useful life (months)</span><input inputMode="numeric" value={row.life ?? ""} onChange={(e) => { const v = n(e.target.value); onChange({ life: v && Number.isInteger(v) && v > 0 && v <= 1200 ? v : null, lifeText: e.target.value }); }} /></label>
      <label className="ie-field"><span>Opening accumulated</span><input inputMode="decimal" value={row.opening ?? ""} onChange={(e) => onChange({ opening: n(e.target.value), openingBlank: e.target.value.trim() === "" })} /></label>
      <label className="ie-field"><span>Opening through</span><input type="month" value={row.openingThrough ?? ""} onChange={(e) => onChange({ openingThrough: e.target.value || null })} /></label>
      <button type="button" className="ie-btn primary fai-done" onClick={onDone}>Done</button>
    </div>
  );
}

/** The import's outcome, in a popup with its tick. */
function Done({ result, onRestart }: { result: Extract<FaImportResult, { ok: true }>; onRestart: () => void }) {
  const left = result.skipped.filter((s) => s.reason !== "Left out");
  return (
    <div className="fai-modal" role="dialog" aria-modal="true" aria-labelledby="fai-done-t">
      <section className="ie-card pimp-done fai-done-card">
        <svg className={`pimp-mark ${left.length ? "warn" : "ok"}`} viewBox="0 0 52 52" aria-hidden="true">
          <circle cx="26" cy="26" r="24" />{left.length ? <path d="M26 14v15M26 36v1" /> : <path d="M15 27l7 7 15-16" />}
        </svg>
        <h2 id="fai-done-t">{result.imported.length} asset{result.imported.length === 1 ? "" : "s"} imported</h2>
        <p className="page-sub">Each has its schedule from MTK&apos;s engine. Their purchases still need linking in Journal Reconciliation.</p>
        {left.length > 0 && (
          <div className="fai-left">
            <strong><AlertCircle size={15} aria-hidden="true" /> {left.length} row{left.length === 1 ? "" : "s"} still need attention</strong>
            <ul>{left.map((s) => <li key={s.line}>Row {s.line} · {s.name}: {s.reason}</li>)}</ul>
          </div>
        )}
        {result.skipped.length - left.length > 0 && <p className="ie-note">{result.skipped.length - left.length} left out by choice.</p>}
        <div className="actions">
          <button type="button" className="ie-btn" onClick={onRestart}>Import more</button>
          <Link className="ie-btn" href="/fixed-assets/reconcile">Journal reconciliation</Link>
          <Link className="ie-btn primary" href="/fixed-assets/register"><CircleCheck size={15} aria-hidden="true" /> Asset register</Link>
        </div>
      </section>
    </div>
  );
}

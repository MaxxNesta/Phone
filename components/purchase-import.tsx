"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { AlertCircle, Check, ChevronDown, ChevronRight, CircleCheck, CircleSlash, ClipboardPaste, FileSpreadsheet, Info, X } from "lucide-react";
import { FileDrop } from "./file-drop";
import { previewPurchaseImport, runPurchaseImport, type PurchaseImportResult, type SourceFormat } from "@/lib/purchase-import-actions";
import { invoiceBlocks, parseTsv, invoiceStatus, resolved, type Mapping, type Match, type PlannedInvoice, type Status } from "@/lib/import-purchase-invoices";

type Option = { id: string; code: string; name: string };
type Source = { content: string; format: SourceFormat; name: string };
type Preview = { invoices: PlannedInvoice[]; suppliers: Option[]; locations: Option[] };

const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const day = (d: string | null, raw: string) =>
  d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : raw || "—";

const STATUS: Record<Status, { label: string; pill: string }> = {
  ready: { label: "Ready", pill: "ok" },
  review: { label: "Needs review", pill: "warn" },
  unmapped: { label: "Not mapped", pill: "info" },
  blocked: { label: "Can't import", pill: "overdue" },
  imported: { label: "Already imported", pill: "draft" },
};

/**
 * Bringing purchase invoices over from the old system's Excel report.
 * Upload, review each invoice (supplier and warehouse matched by name, a
 * guess confirmed once for every invoice that uses it), then import — as
 * history only: no stock, journal or payable.
 */
export function PurchaseImport() {
  const [mode, setMode] = useState<"upload" | "paste">("upload");
  const [file, setFile] = useState<Source | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Mapping>({ suppliers: {}, locations: {} });
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<PurchaseImportResult | null>(null);
  const [reading, startRead] = useTransition();
  const [importing, startImport] = useTransition();

  const step = result ? 3 : preview ? 2 : 1;

  function onPick(u: Source) {
    setFile(u); setPreview(null); setError(null); setSkip(new Set()); setMapping({ suppliers: {}, locations: {} });
    startRead(async () => {
      try {
        const p = await previewPurchaseImport(u.content, u.format);
        setPreview(p);
        setOpen(new Set(p.invoices.slice(0, 1).map((i) => i.oldRef)));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  const rows = useMemo(() => (preview?.invoices ?? []).map((p) => ({ p, status: invoiceStatus(p, mapping) })), [preview, mapping]);
  const counts = rows.reduce((c, r) => ({ ...c, [r.status]: (c[r.status] ?? 0) + 1 }), {} as Partial<Record<Status, number>>);
  const included = rows.filter((r) => r.status !== "imported" && !skip.has(r.p.oldRef));
  const holding = included.filter((r) => r.status === "blocked" || r.status === "unmapped");
  const total = included.reduce((a, r) => a + (r.p.totals.netTotal ?? r.p.totals.lines), 0);

  // Every source name that is not an exact match, once each, so a choice covers all its invoices.
  const toMap = (pick: (p: PlannedInvoice) => Match) => {
    const seen = new Map<string, Match>();
    for (const { p } of rows) { const m = pick(p); if (m.how !== "exact" && !seen.has(m.source)) seen.set(m.source, m); }
    return [...seen.values()];
  };
  const supplierMaps = toMap((p) => p.supplier);
  const locationMaps = toMap((p) => p.location);

  const choose = (kind: keyof Mapping, source: string, id: string) =>
    setMapping((m) => {
      const next = { ...m[kind] };
      if (id) next[source] = id; else delete next[source];
      return { ...m, [kind]: next };
    });
  const toggle = (set: Set<string>, k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n; };

  function doImport() {
    if (!file) return;
    startImport(async () => {
      setResult(await runPurchaseImport({ content: file.content, format: file.format, filename: file.name, mapping, skip: [...skip] }));
    });
  }

  function restart() { setFile(null); setPreview(null); setResult(null); setError(null); }

  return (
    <div className="pimp">
      <ol className="pimp-steps" aria-label="Steps">
        {[mode === "paste" ? "Paste report" : "Upload report", "Review", "Import"].map((s, i) => (
          <li key={s} data-state={step > i + 1 ? "done" : step === i + 1 ? "now" : "next"} aria-current={step === i + 1 ? "step" : undefined}>
            <span className="pimp-dot">{step > i + 1 ? <Check size={14} aria-hidden="true" /> : i + 1}</span>{s}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <section className="card">
          <div className="card-body">
            <div className="segmented pimp-mode" role="radiogroup" aria-label="How to add the report">
              {([["upload", "Upload Excel file", FileSpreadsheet], ["paste", "Paste from Excel", ClipboardPaste]] as const).map(([k, label, Icon]) => (
                <button key={k} type="button" role="radio" aria-checked={mode === k} className={`seg${mode === k ? " on" : ""}`}
                  onClick={() => { setMode(k); setError(null); }}>
                  <Icon size={15} aria-hidden="true" /> {label}
                </button>
              ))}
            </div>
            {mode === "upload"
              ? <FileDrop onPick={onPick} onClear={restart} picked={file?.name ?? null} busy={reading} accept=".xlsx" />
              : <PasteSheet busy={reading} onRead={(text) => onPick({ content: text, format: "tsv", name: "Pasted from Excel" })} />}
            <p className="pimp-note"><Info size={14} aria-hidden="true" /><span>The old system&apos;s purchase invoice report. Each invoice
              starts with its <strong>Docid</strong> row; the IMEIs sit under each line. Historical records — no stock, journal or payable is created.</span></p>
            {error && <div className="alert" style={{ marginTop: 12 }}>{error}</div>}
          </div>
        </section>
      )}

      {step === 2 && preview && (
        <>
          <div className="pimp-bar">
            <h2>Invoices to import <span className="subline">({rows.length})</span></h2>
            <span className="pimp-legend">
              {(["ready", "review", "unmapped", "blocked", "imported"] as Status[]).filter((s) => counts[s]).map((s) => (
                <span key={s} className={`pill ${STATUS[s].pill}`}>{STATUS[s].label} {counts[s]}</span>
              ))}
            </span>
          </div>

          {(supplierMaps.length > 0 || locationMaps.length > 0) && (
            <section className="card pimp-map">
              <div className="card-head"><h2>Match names from the old system</h2>
                <span className="page-sub">Chosen once, used for every invoice with that name.</span></div>
              <div className="card-body">
                {[...supplierMaps.map((m) => ["suppliers", "Supplier", m, preview.suppliers] as const),
                  ...locationMaps.map((m) => ["locations", "Warehouse", m, preview.locations] as const)].map(([kind, label, m, list]) => {
                  const id = mapping[kind][m.source] ?? "";
                  return (
                    <div key={kind + m.source} className="pimp-maprow">
                      <span className="pimp-src"><span className="subline">{label}</span> {m.source || "—"}</span>
                      <ChevronRight size={14} aria-hidden="true" />
                      <select aria-label={`${label} for ${m.source}`} value={id} onChange={(e) => choose(kind, m.source, e.target.value)}>
                        <option value="">{m.how === "guess" ? `Choose… (suggested: ${list.find((x) => x.id === m.id)?.name})` : "Choose…"}</option>
                        {list.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.code}</option>)}
                      </select>
                      {m.how === "guess" && !id && (
                        <button type="button" className="ghost tiny" onClick={() => choose(kind, m.source, m.id!)}>Confirm match</button>
                      )}
                      <span className={`pimp-ok${id ? " on" : ""}`}>{id ? <><Check size={13} aria-hidden="true" /> Matched</> : "Not matched"}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <div className="pimp-list">
            {rows.map(({ p, status }) => {
              const isOpen = open.has(p.oldRef);
              const left = skip.has(p.oldRef);
              const sup = preview.suppliers.find((x) => x.id === resolved(p.supplier, mapping.suppliers));
              const loc = preview.locations.find((x) => x.id === resolved(p.location, mapping.locations));
              return (
                <section key={p.oldRef} className={`pimp-inv${left || status === "imported" ? " out" : ""}`} data-status={status}>
                  <button type="button" className="pimp-head" aria-expanded={isOpen} onClick={() => setOpen(toggle(open, p.oldRef))}>
                    <ChevronDown size={16} className="pimp-chev" aria-hidden="true" />
                    <StatusIcon s={status} />
                    <span className="pimp-title">{p.oldRef} · {p.supplier.source || "—"} · {day(p.date, p.rawDate)}</span>
                    <span className={`pill ${STATUS[status].pill}`}>{left ? "Left out" : STATUS[status].label}</span>
                    <span className="pimp-total"><span className="subline">Total</span> {money(p.totals.netTotal ?? p.totals.lines)} {p.totals.currency}</span>
                  </button>
                  {isOpen && (
                    <div className="pimp-body">
                      <dl className="pimp-info">
                        <div><dt>Old document ID</dt><dd className="code">{p.oldRef}</dd></div>
                        <div><dt>New invoice no.</dt><dd className="subline">Next purchase invoice number, given on import</dd></div>
                        <div><dt>Invoice date</dt><dd>{day(p.date, p.rawDate)}</dd></div>
                        <div><dt>Supplier</dt><dd>{sup ? sup.name : <span className="pimp-need">Choose above</span>}</dd></div>
                        <div><dt>Warehouse</dt><dd>{loc ? loc.name : <span className="pimp-need">Choose above</span>}</dd></div>
                        <div><dt>Payment</dt><dd>{p.payment ?? "—"}</dd></div>
                        <div><dt>Supplier invoice no.</dt><dd>{p.supplierInvoiceNo ?? <span className="subline">Not provided</span>}</dd></div>
                        {p.remark && <div className="wide"><dt>Remark</dt><dd>{p.remark}</dd></div>}
                      </dl>

                      {p.issues.length > 0 && (
                        <ul className="pimp-issues">
                          {p.issues.map((i, k) => (
                            <li key={k} data-level={i.level}><AlertCircle size={14} aria-hidden="true" /><strong>{i.field}</strong> {i.message}</li>
                          ))}
                        </ul>
                      )}

                      <div className="tablewrap">
                        <table className="pimp-lines">
                          <thead><tr><th>#</th><th>Code</th><th>Item</th><th className="r">Qty</th><th className="r">Unit price</th><th className="r">Amount</th></tr></thead>
                          {p.lines.map((l, k) => (
                            <tbody key={k}>
                              <tr>
                                <td>{k + 1}</td>
                                <td className="code">{l.code}</td>
                                <td>{l.itemName ?? <span className="pimp-need">{l.description} — not in catalogue</span>}</td>
                                <td className="r">{money(l.qty)}</td>
                                <td className="r">{money(l.unitPrice)}</td>
                                <td className="r">{money(l.amount)}</td>
                              </tr>
                              {l.serials.length > 0 && (
                                <tr className="pimp-serials"><td /><td colSpan={5}>
                                  <details>
                                    <summary>{l.serials.length} {l.identity === "IMEI" ? "IMEI" : "serial"}{l.serials.length === 1 ? "" : "s"}{l.tracksSerial && l.serials.length !== l.qty ? ` — ${l.qty} needed` : ""}</summary>
                                    <div className="pimp-chips">{l.serials.map((s) => <span key={s} className="code">{s}</span>)}</div>
                                  </details>
                                </td></tr>
                              )}
                            </tbody>
                          ))}
                        </table>
                      </div>

                      <dl className="pimp-sum">
                        <div><dt>Invoice total</dt><dd>{money(p.totals.invoiceTotal ?? p.totals.lines)}</dd></div>
                        <div><dt>Item discount</dt><dd>{money(p.totals.itemDiscount)}</dd></div>
                        <div><dt>Voucher discount</dt><dd>{money(p.totals.voucherDiscount)}</dd></div>
                        <div><dt>Advance pay</dt><dd>{money(p.totals.advancePay)}</dd></div>
                        <div><dt>Paid amount</dt><dd>{money(p.totals.paidAmount)}</dd></div>
                        <div><dt>Currency</dt><dd>{p.totals.currency} · {p.totals.exchangeRate}</dd></div>
                        <div className="strong"><dt>Net total</dt><dd>{money(p.totals.netTotal ?? p.totals.lines)} {p.totals.currency}</dd></div>
                      </dl>

                      {status !== "imported" && (
                        <div className="actions">
                          <button type="button" className="ghost tiny" onClick={() => setSkip(toggle(skip, p.oldRef))}>
                            {left ? "Include this invoice" : "Leave this invoice out"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          <div className="pimp-foot">
            <button type="button" className="ghost" onClick={restart}>Back</button>
            <span className="page-sub">
              {holding.length
                ? `${holding.length} invoice${holding.length === 1 ? " needs" : "s need"} a match or a fix — or leave ${holding.length === 1 ? "it" : "them"} out.`
                : included.length ? `${included.length} invoice${included.length === 1 ? "" : "s"} · ${money(total)} MMK · history only` : "Nothing to import."}
            </span>
            <button type="button" onClick={doImport} disabled={importing || holding.length > 0 || included.length === 0}>
              {importing ? "Importing…" : `Import ${included.length || ""} invoice${included.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}

      {step === 3 && result && (
        <section className="card pimp-done">
          {result.ok ? (
            <>
              <svg className="pimp-mark ok" viewBox="0 0 52 52" aria-hidden="true">
                <circle cx="26" cy="26" r="24" /><path d="M15 27l7 7 15-16" />
              </svg>
              <h2>{result.imported.length} invoice{result.imported.length === 1 ? "" : "s"} imported</h2>
              <p className="page-sub">Batch {result.batchRef}. The old IDs stay searchable. No stock, journal or payable was created.</p>
              <div className="tablewrap pimp-map-out">
                <table>
                  <thead><tr><th>Old ID</th><th>New invoice no.</th></tr></thead>
                  <tbody>{result.imported.map((r) => <tr key={r.id}><td className="code">{r.oldRef}</td><td className="code">{r.invoiceNo}</td></tr>)}</tbody>
                </table>
              </div>
              <div className="actions">
                <button type="button" className="ghost" onClick={restart}>Import another file</button>
                <Link className="btn" href="/purchases/invoices/imported">View imported invoices</Link>
              </div>
            </>
          ) : (
            <>
              <svg className="pimp-mark bad" viewBox="0 0 52 52" aria-hidden="true">
                <circle cx="26" cy="26" r="24" /><path d="M18 18l16 16M34 18L18 34" />
              </svg>
              <h2>Nothing was imported</h2>
              <p className="pimp-err">{result.error}</p>
              <div className="actions">
                <button type="button" className="ghost" onClick={() => setResult(null)}>Back to review</button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

const COLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SHOW = 1500;

/**
 * Cells pasted from Excel, shown as the sheet they came from, with a band
 * where each invoice starts and a line where it ends — so a paste of many
 * invoices can be checked for where one stops before anything is read.
 */
function PasteSheet({ busy, onRead }: { busy: boolean; onRead: (text: string) => void }) {
  const [text, setText] = useState("");
  const rows = useMemo(() => {
    const r = parseTsv(text);
    while (r.length && r[r.length - 1].every((c) => !c.trim())) r.pop();
    return r;
  }, [text]);
  const blocks = useMemo(() => invoiceBlocks(rows), [rows]);
  const width = Math.min(COLS.length, Math.max(0, ...rows.slice(0, SHOW).map((r) => {
    let w = r.length; while (w > 0 && !r[w - 1].trim()) w--; return w;
  })));
  const inBlock = (i: number) => blocks.findIndex((b) => i >= b.start && i <= b.end);

  if (!text) {
    return (
      <label className="pimp-paste">
        <ClipboardPaste size={30} aria-hidden="true" />
        <span className="pimp-paste-t">Copy the report in Excel, then paste it here</span>
        <span className="hint">Select the cells · Ctrl+C · click here · Ctrl+V</span>
        <textarea aria-label="Paste the report from Excel" value="" onChange={(e) => setText(e.target.value)}
          onPaste={(e) => { e.preventDefault(); setText(e.clipboardData.getData("text/plain")); }} />
      </label>
    );
  }

  return (
    <div className="pimp-pasted">
      <div className="pimp-pasted-bar">
        <strong>{blocks.length} invoice{blocks.length === 1 ? "" : "s"} found</strong>
        <span className="subline">{rows.length} rows pasted{rows.length > SHOW ? ` · first ${SHOW} shown` : ""}</span>
        <button type="button" className="ghost tiny" onClick={() => setText("")} disabled={busy}>Clear</button>
      </div>
      <div className="pimp-sheet-wrap">
        <table className="pimp-sheet">
          <thead><tr><th />{COLS.slice(0, width).split("").map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {rows.slice(0, SHOW).flatMap((r, i) => {
              const b = inBlock(i);
              const startsHere = b >= 0 && blocks[b].start === i;
              const out = [];
              if (startsHere) out.push(
                <tr key={`b${i}`} className="pimp-band"><td colSpan={width + 1}>
                  Invoice {b + 1} · <span className="code">{blocks[b].ref || "no Docid"}</span> · rows {blocks[b].start + 1}–{blocks[b].end + 1}
                </td></tr>);
              const first = (r.find((c) => c.trim()) ?? "").toLowerCase();
              out.push(
                <tr key={i} data-inv={b < 0 ? "none" : b % 2 ? "odd" : "even"}
                  className={[blocks[b]?.end === i ? "pimp-end" : "", first === "code" ? "pimp-colhead" : "", /^net total/.test(first) ? "pimp-net" : ""].join(" ")}>
                  <th>{i + 1}</th>
                  {Array.from({ length: width }, (_, k) => {
                    const v = (r[k] ?? "").trim();
                    return <td key={k} className={/^-?[d,]+(.d+)?$/.test(v) && v.length < 14 ? "r" : undefined}>{v}</td>;
                  })}
                </tr>);
              return out;
            })}
          </tbody>
        </table>
      </div>
      {blocks.length > 0 && blocks[0].start > 0 && <p className="hint">Rows 1–{blocks[0].start} come before the first Docid and are not read.</p>}
      <div className="pimp-pasted-foot">
        <button type="button" onClick={() => onRead(text)} disabled={busy || blocks.length === 0}>
          {busy ? "Reading…" : `Read ${blocks.length || ""} invoice${blocks.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}

function StatusIcon({ s }: { s: Status }) {
  if (s === "ready") return <CircleCheck size={18} className="pimp-si ok" aria-hidden="true" />;
  if (s === "imported") return <CircleSlash size={18} className="pimp-si" aria-hidden="true" />;
  if (s === "blocked") return <X size={18} className="pimp-si bad" aria-hidden="true" />;
  return <AlertCircle size={18} className="pimp-si warn" aria-hidden="true" />;
}

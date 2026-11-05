"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { AlertCircle, Check, ChevronDown, ChevronRight, CircleCheck, CircleSlash, ClipboardPaste, FileSpreadsheet, Info, PackageCheck, X } from "lucide-react";
import { FileDrop } from "./file-drop";
import { previewInvoicePosting, previewPurchaseImport, runPurchaseImport, type PurchaseImportResult, type SourceFormat } from "@/lib/purchase-import-actions";
import { previewSalesImport, previewSalesInvoicePosting, runSalesImport } from "@/lib/sales-import-actions";
import type { PostedResult, PostingPreview } from "@/lib/purchase-import";
import { invoiceBlocks, parseTsv, invoiceStatus, netOf, resolved, type Mapping, type Match, type PlannedInvoice, type Status } from "@/lib/import-purchase-invoices";

type Option = { id: string; code: string; name: string };
type Source = { content: string; format: SourceFormat; name: string };
type Preview = { invoices: PlannedInvoice[]; suppliers: Option[]; locations: Option[]; payAccounts: Option[] };

const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const day = (d: string | null, raw: string) =>
  d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : raw || "—";

const STATUS: Record<Status, { label: string; pill: string }> = {
  ready: { label: "Ready", pill: "ok" },
  review: { label: "Needs review", pill: "warn" },
  unmapped: { label: "Needs a choice", pill: "info" },
  blocked: { label: "Can't post", pill: "overdue" },
  imported: { label: "Already posted", pill: "draft" },
};
const DOC: Record<string, string> = {
  PURCHASE_INVOICE: "Purchase invoice", GOODS_RECEIPT: "Goods receipt", SUPPLIER_PAYMENT: "Supplier payment",
  SALES_INVOICE: "Sales invoice", DELIVERY: "Delivery", CUSTOMER_RECEIPT: "Customer receipt",
};

/** One screen, two reports: what each side calls things, and the actions behind it. */
const SIDE = {
  purchase: {
    preview: previewPurchaseImport, previewPosting: previewInvoicePosting, run: runPurchaseImport,
    report: "purchase invoice report", partner: "Supplier", arrival: "Goods arrival for this batch",
    arrivalHow: "Arriving with this bill", arrivalNote: "Each invoice posts with its own goods receipt. An import always receives this way.",
    moveDate: "Receipt date", moveHint: "The goods receipt carries the invoice's date; its stock counts from the start of that day.",
    due: "Supplier's payment terms", money: "Paid from",
    moneyHint: "For the paid amount the report shows. One supplier payment posts with that bill; the rest stays owing.",
    newNo: "New PI number", dateLabel: "Posting and receipt date", partnerRef: "Supplier invoice no.",
    makes: "its bill, goods receipt and journals", each: "each with its goods receipt",
    lead: "Every invoice posts as a real bill with its goods receipt — stock, payable and journals, as if typed in.",
    cols: ["Purchase invoice", "Goods receipt", "Payment"], list: "/purchases/invoices", listLabel: "View purchase invoices",
  },
  sales: {
    preview: previewSalesImport, previewPosting: previewSalesInvoicePosting, run: runSalesImport,
    report: "sales invoice report", partner: "Customer", arrival: "Delivery for this batch",
    arrivalHow: "Delivered with this invoice", arrivalNote: "Each invoice posts with its own delivery: the phones leave stock at their FIFO cost. An import always delivers this way.",
    moveDate: "Delivery date", moveHint: "The delivery carries the invoice's date. Every phone must be in stock there, received on or before that day.",
    due: "On the invoice date", money: "Received into",
    moneyHint: "For the paid amount the report shows. One customer receipt posts with that invoice; the rest stays owing.",
    newNo: "New invoice number", dateLabel: "Posting and delivery date", partnerRef: "Reference",
    makes: "its invoice, delivery and journals", each: "each with its delivery",
    lead: "Every invoice posts as a real sale with its delivery — stock out, cost of sales, receivable and journals, as if entered at the counter.",
    cols: ["Sales invoice", "Delivery", "Receipt"], list: "/sales/invoices", listLabel: "View sales invoices",
  },
} as const;

/**
 * Purchase or sales invoices from the old system's Excel report, posted as real documents.
 * Upload or paste, review each invoice (supplier or customer and warehouse matched by
 * name, a guess confirmed once for every invoice that uses it), then post:
 * each invoice with its goods receipt or delivery, as one entered by hand with "goods
 * arriving with this bill" or "delivered now" — the only way an import moves stock.
 */
export function PurchaseImport({ side = "purchase" }: { side?: "purchase" | "sales" }) {
  const T = SIDE[side];
  const [mode, setMode] = useState<"upload" | "paste">("upload");
  const [file, setFile] = useState<Source | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Mapping>({ suppliers: {}, locations: {}, payAccount: null });
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [postings, setPostings] = useState<Record<number, PostingPreview | "loading">>({});
  const [result, setResult] = useState<PurchaseImportResult | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [reading, startRead] = useTransition();
  // Plain state, not a transition: a transition would hold every progress update until the batch ends.
  const [importing, setImporting] = useState(false);

  const step = result ? 3 : preview ? 2 : 1;

  function onPick(u: Source) {
    setFile(u); setPreview(null); setError(null); setSkip(new Set()); setPostings({});
    setMapping({ suppliers: {}, locations: {}, payAccount: null });
    startRead(async () => {
      try {
        const p = await T.preview(u.content, u.format);
        setPreview(p);
        setOpen(new Set(p.invoices.slice(0, 1).map((i) => i.row)));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  const rows = useMemo(() => (preview?.invoices ?? []).map((p) => ({ p, status: invoiceStatus(p, mapping) })), [preview, mapping]);
  const counts = rows.reduce((c, r) => ({ ...c, [r.status]: (c[r.status] ?? 0) + 1 }), {} as Partial<Record<Status, number>>);
  const included = rows.filter((r) => r.status !== "imported" && !skip.has(r.p.row));
  const holding = included.filter((r) => r.status === "blocked" || r.status === "unmapped");
  const total = included.reduce((a, r) => a + netOf(r.p), 0);
  const anyPaid = rows.some((r) => r.p.totals.paidAmount > 0);

  // Every source name that is not an exact match, once each, so a choice covers all its invoices.
  const toMap = (pick: (p: PlannedInvoice) => Match) => {
    const seen = new Map<string, Match>();
    for (const { p } of rows) { const m = pick(p); if (m.how !== "exact" && !seen.has(m.source)) seen.set(m.source, m); }
    return [...seen.values()];
  };
  const supplierMaps = toMap((p) => p.supplier);
  const locationMaps = toMap((p) => p.location);

  // A changed choice can change what an invoice posts, so earlier previews are dropped.
  const choose = (kind: "suppliers" | "locations", source: string, id: string) => {
    setPostings({});
    setMapping((m) => {
      const next = { ...m[kind] };
      if (id) next[source] = id; else delete next[source];
      return { ...m, [kind]: next };
    });
  };
  const toggle = <T,>(set: Set<T>, k: T) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n; };

  function showPosting(row: number) {
    if (!file) return;
    setPostings((s) => ({ ...s, [row]: "loading" }));
    T.previewPosting(file.content, file.format, row, mapping)
      .then((r) => setPostings((s) => ({ ...s, [row]: r })))
      .catch((e) => setPostings((s) => ({ ...s, [row]: { error: e instanceof Error ? e.message : String(e) } })));
  }

  /**
   * One invoice per request, oldest first, so the bar moves as each one
   * posts and a long batch never waits on one long request. Each still posts
   * on its own key: a retry, or a second click, cannot post one twice.
   */
  function doPost(only?: number[]) {
    if (!file) return;
    const queue = rows
      .filter((r) => only ? only.includes(r.p.row) : r.status !== "imported" && !skip.has(r.p.row) && (r.status === "ready" || r.status === "review"))
      .map((r) => r.p)
      .sort((a, b) => a.postDate!.localeCompare(b.postDate!) || a.row - b.row);
    // A retry keeps what already went through and replaces only what it reruns.
    const kept = only && result?.ok ? result.results.filter((r) => !only.includes(r.row)) : [];
    const skipped = only && result?.ok ? result.skipped : rows.length - queue.length;
    setResult(null);
    setImporting(true);
    void (async () => {
      const out: PostedResult[] = [...kept];
      for (const [i, p] of queue.entries()) {
        setProgress({ done: i, total: queue.length, current: p.oldRef || `Invoice ${i + 1}` });
        try {
          const r = await T.run({ content: file.content, format: file.format, filename: file.name, mapping, skip: [], only: [p.row] });
          out.push(...(r.ok ? r.results : [{ row: p.row, oldRef: p.oldRef, status: "failed" as const, error: r.error }]));
        } catch (e) {
          out.push({ row: p.row, oldRef: p.oldRef, status: "failed", error: e instanceof Error ? e.message : "The connection dropped. Retry — nothing posts twice." });
        }
      }
      setProgress(null);
      setImporting(false);
      setResult({ ok: true, results: out.sort((a, b) => a.row - b.row), skipped });
    })();
  }

  function restart() { setFile(null); setPreview(null); setResult(null); setError(null); }

  return (
    <div className="pimp">
      <ol className="pimp-steps" aria-label="Steps">
        {[mode === "paste" ? "Paste report" : "Upload report", "Review", "Post"].map((s, i) => (
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
            <p className="pimp-note"><Info size={14} aria-hidden="true" /><span>The {T.report}. Each invoice starts with its <strong>Docid</strong> row;
              the IMEIs sit under each line. {T.lead}</span></p>
            {error && <div className="alert" style={{ marginTop: 12 }}>{error}</div>}
          </div>
        </section>
      )}

      {step === 2 && preview && (
        <>
          <div className="pimp-bar">
            <h2>Invoices to post <span className="subline">({rows.length})</span></h2>
            <span className="pimp-legend">
              {(["ready", "review", "unmapped", "blocked", "imported"] as Status[]).filter((s) => counts[s]).map((s) => (
                <span key={s} className={`pill ${STATUS[s].pill}`}>{STATUS[s].label} {counts[s]}</span>
              ))}
            </span>
          </div>

          <section className="card pimp-map">
            <div className="card-head"><h2>{T.arrival}</h2></div>
            <div className="card-body pimp-arrival">
              <div className="pimp-fixed"><PackageCheck size={16} aria-hidden="true" />
                <span><strong>{T.arrivalHow}</strong><span className="subline">{T.arrivalNote}</span></span></div>
              <div className="field">
                <label>{T.moveDate}</label>
                <span className="fixedfield">Use invoice date</span>
                <span className="hint">{T.moveHint}</span>
              </div>
              <div className="field">
                <label>Due date</label>
                <span className="fixedfield">{T.due}</span>
              </div>
              {anyPaid && (
                <div className="field">
                  <label htmlFor="pay-account">{T.money}</label>
                  <select id="pay-account" value={mapping.payAccount ?? ""} onChange={(e) => { setPostings({}); setMapping((m) => ({ ...m, payAccount: e.target.value || null })); }}>
                    <option value="">Choose the cash or bank account…</option>
                    {preview.payAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                  </select>
                  <span className="hint">{T.moneyHint}</span>
                </div>
              )}
            </div>
          </section>

          {(supplierMaps.length > 0 || locationMaps.length > 0) && (
            <section className="card pimp-map">
              <div className="card-head"><h2>Match names from the report</h2>
                <span className="page-sub">Chosen once, used for every invoice with that name.</span></div>
              <div className="card-body">
                {[...supplierMaps.map((m) => ["suppliers", T.partner, m, preview.suppliers] as const),
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
              const isOpen = open.has(p.row);
              const left = skip.has(p.row);
              const sup = preview.suppliers.find((x) => x.id === resolved(p.supplier, mapping.suppliers));
              const loc = preview.locations.find((x) => x.id === resolved(p.location, mapping.locations));
              const posting = postings[p.row];
              return (
                <section key={p.row} className={`pimp-inv${left || status === "imported" ? " out" : ""}`} data-status={status}>
                  <button type="button" className="pimp-head" aria-expanded={isOpen} onClick={() => setOpen(toggle(open, p.row))}>
                    <ChevronDown size={16} className="pimp-chev" aria-hidden="true" />
                    <StatusIcon s={status} />
                    <span className="pimp-title">{p.oldRef || "No old ID"} · {p.supplier.source || "—"} · {day(p.date, p.rawDate)}</span>
                    <span className={`pill ${STATUS[status].pill}`}>{left ? "Left out" : status === "imported" ? `Posted as ${p.already!.docNo}` : STATUS[status].label}</span>
                    <span className="pimp-total"><span className="subline">Total</span> {money(netOf(p))} {p.totals.currency}</span>
                  </button>
                  {isOpen && (
                    <div className="pimp-body">
                      <dl className="pimp-info">
                        <div><dt>Old document ID</dt><dd className="code">{p.oldRef || "—"}</dd></div>
                        <div><dt>{T.newNo}</dt><dd className="subline">{p.already ? p.already.docNo : "Assigned on posting"}</dd></div>
                        <div><dt>Invoice date</dt><dd>{day(p.date, p.rawDate)}</dd></div>
                        <div><dt>{T.dateLabel}</dt><dd>{day(p.postDate, p.rawDate)}{p.postDate !== p.date && <span className="subline"> · company start</span>}</dd></div>
                        <div><dt>{T.partner}</dt><dd>{sup ? sup.name : <span className="pimp-need">Choose above</span>}</dd></div>
                        <div><dt>Warehouse</dt><dd>{loc ? loc.name : <span className="pimp-need">Choose above</span>}</dd></div>
                        <div><dt>Payment</dt><dd>{p.payment ?? "—"}</dd></div>
                        <div><dt>{T.partnerRef}</dt><dd>{p.supplierInvoiceNo ?? <span className="subline">Not provided</span>}</dd></div>
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
                                <td className="r">{l.free ? <span className="pill info">FOC</span> : money(l.unitPrice)}</td>
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
                        <div className="strong"><dt>Net total</dt><dd>{money(netOf(p))} {p.totals.currency}</dd></div>
                      </dl>

                      {posting === "loading" && (
                        <div className="pimp-progress compact" role="status">
                          <span className="subline">Posting it and rolling it back, to show exactly what it makes…</span>
                          <div className="pimp-progress-track indeterminate"><span /></div>
                        </div>
                      )}
                      {posting && posting !== "loading" && <PostingView v={posting} />}

                      {status !== "imported" && (
                        <div className="actions">
                          {(status === "ready" || status === "review") && !left && (
                            <button type="button" className="ghost tiny" disabled={posting === "loading"} onClick={() => showPosting(p.row)}>
                              {posting === "loading" ? "Working it out…" : posting ? "Refresh what this posts" : "Show what this posts"}
                            </button>
                          )}
                          <button type="button" className="ghost tiny" onClick={() => setSkip(toggle(skip, p.row))}>
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
            {progress && (
              <div className="pimp-progress" role="status" aria-live="polite">
                <div className="pimp-progress-t">
                  <strong>Posting {progress.done + 1} of {progress.total}</strong>
                  <span className="subline">{progress.current} · {T.makes}</span>
                  <span className="pimp-progress-n">{Math.round((progress.done / progress.total) * 100)}%</span>
                </div>
                <div className="pimp-progress-track"><span style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
                <span className="hint">Each invoice posts on its own. Keep this page open; if it is closed, the ones already posted stay posted and a retry skips them.</span>
              </div>
            )}
            <button type="button" className="ghost" onClick={restart} disabled={importing}>Back</button>
            <span className="page-sub">
              {holding.length
                ? `${holding.length} invoice${holding.length === 1 ? " needs" : "s need"} a choice or a fix — or leave ${holding.length === 1 ? "it" : "them"} out.`
                : included.length ? `${included.length} invoice${included.length === 1 ? "" : "s"} · ${money(total)} MMK · ${T.each}` : "Nothing to post."}
            </span>
            <button type="button" onClick={() => doPost()} disabled={importing || holding.length > 0 || included.length === 0}>
              {importing ? "Posting…" : `Import and post ${included.length || ""} invoice${included.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}

      {step === 3 && result && <Done side={side} result={result} busy={importing} onRetry={doPost} onBack={() => setResult(null)} onRestart={restart} />}
    </div>
  );
}

/** What one invoice posts, as the engine posted it and rolled it back. */
function PostingView({ v }: { v: PostingPreview }) {
  if ("error" in v) return <div className="alert">It would not post: {v.error}</div>;
  const entries = [...new Set(v.journal.map((j) => j.entry))];
  return (
    <div className="pimp-posting">
      <h3>What this posts</h3>
      <p className="subline">{v.documents.map((d) => DOC[d.type] ?? d.type).join(" · ")} — numbers are given when it posts.</p>
      {v.stock.length > 0 && (
        <p className="pimp-stockin">{v.stock.map((s) => s.qty < 0 ? `−${money(-s.qty)} ${s.code} out of ${s.location} at ${money(-s.cost)}` : `+${money(s.qty)} ${s.code} into ${s.location} at ${money(s.cost)}`).join(" · ")}</p>
      )}
      <div className="tablewrap">
        <table className="pimp-lines">
          <thead><tr><th>Account</th><th>Partner</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
          {entries.map((e) => (
            <tbody key={e}>
              {v.journal.filter((j) => j.entry === e).map((j, k) => (
                <tr key={k}>
                  <td><span className="code">{j.code}</span> {j.account}</td>
                  <td>{j.partner ?? ""}</td>
                  <td className="r">{j.debit ? money(j.debit) : ""}</td>
                  <td className="r">{j.credit ? money(j.credit) : ""}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}

/** Posted, already posted, failed: each invoice's outcome, and a retry that cannot repost the ones that went through. */
function Done({ side, result, busy, onRetry, onBack, onRestart }: {
  side: "purchase" | "sales"; result: PurchaseImportResult; busy: boolean; onRetry: (only: number[]) => void; onBack: () => void; onRestart: () => void;
}) {
  const T = SIDE[side];
  if (!result.ok) {
    return (
      <section className="card pimp-done">
        <svg className="pimp-mark bad" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24" /><path d="M18 18l16 16M34 18L18 34" /></svg>
        <h2>Nothing was posted</h2>
        <p className="pimp-err">{result.error}</p>
        <div className="actions"><button type="button" className="ghost" onClick={onBack}>Back to review</button></div>
      </section>
    );
  }
  const posted = result.results.filter((r) => r.status === "posted");
  const already = result.results.filter((r) => r.status === "already");
  const failed = result.results.filter((r) => r.status === "failed");
  const tone = failed.length === 0 ? "ok" : posted.length + already.length === 0 ? "bad" : "warn";
  return (
    <section className="card pimp-done">
      <svg className={`pimp-mark ${tone}`} viewBox="0 0 52 52" aria-hidden="true">
        <circle cx="26" cy="26" r="24" />
        {tone === "ok" ? <path d="M15 27l7 7 15-16" /> : tone === "bad" ? <path d="M18 18l16 16M34 18L18 34" /> : <path d="M26 14v15M26 36v1" />}
      </svg>
      <h2>{posted.length} invoice{posted.length === 1 ? "" : "s"} posted{failed.length ? ` · ${failed.length} failed` : ""}</h2>
      <p className="page-sub">
        {[already.length && `${already.length} already posted earlier`, result.skipped && `${result.skipped} left out or not ready`].filter(Boolean).join(" · ") ||
          (side === "sales" ? "Each with its delivery, stock out, receivable and journals." : "Each with its goods receipt, stock, payable and journals.")}
      </p>
      <div className="tablewrap pimp-map-out wide">
        <table>
          <thead><tr><th>Old ID</th><th>{T.cols[0]}</th><th>{T.cols[1]}</th><th>{T.cols[2]}</th><th>Result</th></tr></thead>
          <tbody>
            {result.results.map((r) => (
              <tr key={r.row}>
                <td className="code">{r.oldRef || "—"}</td>
                {r.status === "failed" ? (
                  <td colSpan={4} className="pimp-err wrap">{r.error}</td>
                ) : (
                  <>
                    <td className="code">{r.invoiceNo}</td>
                    <td className="code">{r.receiptNo ?? "—"}</td>
                    <td className="code">{r.paymentNo ?? "—"}</td>
                    <td>{r.status === "posted" ? "Posted" : "Already posted"}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions">
        {failed.length > 0 && (
          <button type="button" className="ghost" disabled={busy} onClick={() => onRetry(failed.map((f) => f.row))}>
            {busy ? "Retrying…" : `Retry ${failed.length} failed`}
          </button>
        )}
        <button type="button" className="ghost" onClick={onRestart}>Import another file</button>
        <Link className="btn" href={T.list}>{T.listLabel}</Link>
      </div>
    </section>
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
      {blocks.length === 0 && (
        <div className="alert">
          No <strong>Docid</strong> row in what was pasted, so no invoice can be read. In this report the Docid, Supplier and
          Location rows, the item <strong>codes</strong> and the <strong>IMEIs</strong> are all in <strong>column A</strong> — select
          from column A across to the last column, from the Docid row down to the last total, then copy.
        </div>
      )}
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

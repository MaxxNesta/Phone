"use client";

import { Fragment, useMemo, useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight, CircleCheck, ClipboardPaste, X } from "lucide-react";
import { parseTsv } from "@/lib/import-purchase-invoices";
import { FA_COLUMNS, readRegister, type Category, type FaImportRow } from "@/lib/fa-import";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const money = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 0 }));
const sum = (xs: (number | null)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);
/** A, B … Z, AA, AB: the letters Excel puts over its columns. */
const colName = (i: number): string => (i < 26 ? "" : colName(Math.floor(i / 26) - 1)) + String.fromCharCode(65 + (i % 26));
/** The guide sheet: every column the register has, the twelve months spelt out as Excel shows them. */
const YEAR = new Date().getFullYear();
const GUIDE = FA_COLUMNS.flatMap((c) => (c.header.startsWith("Jan ")
  ? MON.map((m) => ({ ...c, header: `${m} ${YEAR}`, field: "Compared", example: c.example }))
  : [c]));

/**
 * The asset register pasted from Excel, read and checked. Preview only: it
 * shows what each row would become and where the file and MTK's schedule
 * disagree. Saving waits on how the assets were paid for.
 */
export function FaImport({ categories }: { categories: Category[] }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  // Names changed by hand, by Excel line; the rest keep their suggestion.
  const [names, setNames] = useState<Record<number, string>>({});
  // The month the file's NBV is as of: worked out from the file unless chosen here.
  const [nbvMonth, setNbvMonth] = useState<number | null>(null);
  const read = useMemo(() => (text ? readRegister(parseTsv(text), categories, nbvMonth) : null), [text, categories, nbvMonth]);
  const count = (s: FaImportRow["status"]) => read?.rows.filter((r) => r.status === s).length ?? 0;

  return (
    <div className="fai">
      <section className="ie-card fai-guide">
        <h3>Columns to match</h3>
        <p className="ie-note">Lay the sheet out like this and copy from the header row down. Columns are found by their header, so their order can change. The Asset schedule report exports this same layout. Hover a header for what it is used for.</p>
        <div className="fai-xl-wrap">
          <table className="fai-xl">
            <thead><tr><th />{GUIDE.map((c, i) => <th key={i}>{colName(i)}</th>)}</tr></thead>
            <tbody>
              <tr className="fai-xl-head"><th>1</th>{GUIDE.map((c, i) => <td key={i} title={c.use}>{c.header}</td>)}</tr>
              <tr><th>2</th>{GUIDE.map((c, i) => <td key={i} className={/^[d,.]+$/.test(c.example) ? "r" : undefined}>{c.example}</td>)}</tr>
              <tr className="fai-xl-field"><th>MTK</th>{GUIDE.map((c, i) => <td key={i}>{c.field === "—" ? "checked only" : c.field}</td>)}</tr>
            </tbody>
          </table>
        </div>
      </section>

      {!text ? (
        <label className="pimp-paste">
          <ClipboardPaste size={30} aria-hidden="true" />
          <span className="pimp-paste-t">Copy the asset register in Excel, then paste it here</span>
          <span className="hint">Select from the header row down · Ctrl+C · click here · Ctrl+V</span>
          <textarea aria-label="Paste the asset register from Excel" value="" onChange={(e) => setText(e.target.value)}
            onPaste={(e) => { e.preventDefault(); setText(e.clipboardData.getData("text/plain")); }} />
        </label>
      ) : !read ? (
        <div className="alert">
          No header row was found. Copy from the header row down: it needs a <strong>Cost</strong> column and a <strong>Name</strong> or
          <strong>Description</strong> column, with the other headers as listed above. <button type="button" className="ghost tiny" onClick={() => setText("")}>Paste again</button>
        </div>
      ) : (
        <section className="ie-card">
          <div className="pimp-pasted-bar">
            <strong>{read.rows.length} asset{read.rows.length === 1 ? "" : "s"} read · {read.year}</strong>
            <span className="fai-counts">
              <span><CircleCheck size={15} className="pimp-si ok" aria-hidden="true" /> {count("ok")} match</span>
              <span><AlertCircle size={15} className="pimp-si warn" aria-hidden="true" /> {count("review")} to review</span>
              <span><X size={15} className="pimp-si bad" aria-hidden="true" /> {count("blocked")} cannot be read</span>
            </span>
            <label className="fai-asof">NBV (source) as of
              <select value={read.nbvMonth ?? ""} onChange={(e) => setNbvMonth(e.target.value === "" ? null : Number(e.target.value))}>
                {read.nbvMonth === null && <option value="">Last month with a figure</option>}
                {MON.map((m, k) => <option key={m} value={k}>{m} {read.year}{read.inferred?.month === k ? ` · fits ${read.inferred.matches} row${read.inferred.matches === 1 ? "" : "s"}` : ""}</option>)}
              </select>
            </label>
            <button type="button" className="ghost tiny" onClick={() => { setText(""); setOpen(null); setNames({}); setNbvMonth(null); }}>Clear</button>
          </div>
          {read.wrongHeaders.length > 0 && (
            <div className="alert">The header row (line {read.headerLine}) is not laid out as expected: {read.wrongHeaders.slice(0, 4).join("; ")}
              {read.wrongHeaders.length > 4 ? `, and ${read.wrongHeaders.length - 4} more` : ""}. Check the columns before trusting the figures.</div>
          )}
          <div className="tablewrap">
            <table className="fai-rows">
              <thead><tr>
                <th /><th>No</th><th>Name</th><th>Category › Subcategory</th><th className="r">Life</th><th>Start · date</th>
                <th className="r">Qty</th><th className="r">Cost</th><th className="r">Op. accum</th>
                <th className="r">{read.year} depreciation</th><th className="r">NBV {read.nbvMonth !== null ? `${MON[read.nbvMonth]} ${read.year}` : "(source)"}</th>
              </tr></thead>
              <tbody>
                {read.rows.map((r) => {
                  // Only the months the file has filled in: a blank month is not yet recorded.
                  const fileDep = sum(r.excel), mtkDep = sum(r.mtk.map((v, k) => (r.excel[k] === null ? 0 : v)));
                  const isOpen = open === r.line;
                  return (
                    <Fragment key={r.line}>
                      <tr className={`fai-row ${r.status}`} onClick={() => setOpen(isOpen ? null : r.line)}>
                        <td>{r.status === "ok" ? <CircleCheck size={16} className="pimp-si ok" aria-label="Matches" />
                          : r.status === "review" ? <AlertCircle size={16} className="pimp-si warn" aria-label="To review" />
                          : <X size={16} className="pimp-si bad" aria-label="Cannot be read" />}</td>
                        <td className="mono">{r.no || r.line}</td>
                        <td className="wrap fai-desc">
                          <button type="button" className="fai-toggle" aria-expanded={isOpen}>
                            {isOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                          </button>
                          <input className="fai-name" value={names[r.line] ?? r.name} aria-label={`Name for line ${r.line}`}
                            onClick={(e) => e.stopPropagation()} onChange={(e) => setNames({ ...names, [r.line]: e.target.value })} />
                          {(names[r.line] ?? r.name) !== r.description && <div className="fai-sub fai-notes" title={r.description}>Notes: {r.description}</div>}
                        </td>
                        <td>{r.category ? <><div className="fai-sub">{r.category.group ?? r.group}</div><div>{r.category.name}</div></> : <span className="fai-bad">{r.categoryText || "—"}</span>}</td>
                        <td className="r">{r.life ?? "—"}</td>
                        <td className="nowrap">{r.start ?? r.startText}<div className="fai-sub">{r.date ?? (r.dateText || "no date")}</div></td>
                        <td className="r">{money(r.qty)}</td>
                        <td className="r">{money(r.cost)}</td>
                        <td className="r">{r.openingBlank ? <span className="fai-muted">blank</span> : money(r.opening)}</td>
                        <Compare file={fileDep} mtk={r.status === "blocked" ? null : mtkDep} />
                        <Compare file={r.nbv} mtk={r.status === "blocked" ? null : r.mtkNbv} />
                      </tr>
                      {isOpen && (
                        <tr className="fai-detail"><td /><td colSpan={10}>
                          {r.issues.length > 0 && <ul className="fai-issues">{r.issues.map((i, k) => <li key={k} className={i.level}>{i.text}</li>)}</ul>}
                          <dl className="fai-facts">
                            <div className="fai-fullnotes"><dt>Notes (the full description)</dt><dd>{r.description || "—"}</dd></div>
                            <div><dt>Excel line</dt><dd>{r.line}</dd></div>
                            <div><dt>Price</dt><dd>{money(r.price)}</dd></div>
                            <div><dt>Disposal (K)</dt><dd>{money(r.disposal)}</dd></div>
                            <div><dt>Method</dt><dd>Straight line, from the start month in full</dd></div>
                          </dl>
                          <table className="fai-months">
                            <thead><tr><th />{MON.map((m) => <th key={m} className="r">{m}</th>)}</tr></thead>
                            <tbody>
                              <tr><th>File</th>{r.excel.map((v, k) => <td key={k} className="r">{money(v)}</td>)}</tr>
                              <tr><th>MTK</th>{r.mtk.map((v, k) => <td key={k} className={`r${Math.abs((r.excel[k] ?? 0) - v) > 1 ? " fai-diff" : ""}`}>{money(v)}</td>)}</tr>
                            </tbody>
                          </table>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pimp-pasted-foot fai-foot">
            <span className="ie-note">Saving comes next: how each asset was paid for (cash, bank or on credit) is decided first. Nothing is saved or posted from this screen.</span>
            <button type="button" className="ie-btn primary" disabled>Import {read.rows.length - count("blocked")} assets</button>
          </div>
        </section>
      )}
    </div>
  );
}

/** The file's figure, with MTK's beneath it only where the two differ. */
function Compare({ file, mtk }: { file: number | null; mtk: number | null }) {
  const differs = mtk !== null && Math.abs((file ?? 0) - mtk) > 1;
  return <td className="r">{money(file)}{differs && <div className="fai-sub fai-diff">MTK {money(mtk)}</div>}</td>;
}

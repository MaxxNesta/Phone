"use client";

import { useEffect, useState } from "react";
import { Columns3, Download } from "lucide-react";

type Col = { key: string; label: string };
const KEY = "cols:products";

/**
 * Which columns of the All products table show. Cells carry data-col; a
 * hidden column is one CSS rule, so the server-drawn table needs no client
 * copy. Price levels start hidden; a saved choice wins.
 */
export function ProductColumns({ columns, defaultHidden }: { columns: Col[]; defaultHidden: string[] }) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState<string[]>(defaultHidden);
  useEffect(() => {
    try { const s = localStorage.getItem(KEY); if (s) setHidden(JSON.parse(s)); } catch { /* defaults stand */ }
  }, []);
  const save = (h: string[]) => { setHidden(h); try { localStorage.setItem(KEY, JSON.stringify(h)); } catch { /* this visit only */ } };
  const css = hidden.map((k) => `.prodtable [data-col="${k}"]{display:none}`).join("");
  return (
    <div className="dt-cols">
      <style>{css}</style>
      <button type="button" className="dt-tool" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Columns3 size={15} aria-hidden="true" /> Columns
        {hidden.length > 0 && <span className="dt-cols-n">{hidden.length} hidden</span>}
      </button>
      {open && (
        <>
          <div className="dt-cols-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="dt-cols-menu" role="group" aria-label="Columns shown">
            {columns.map((c) => (
              <label key={c.key} className="dt-cols-item">
                <input type="checkbox" checked={!hidden.includes(c.key)}
                  onChange={() => save(hidden.includes(c.key) ? hidden.filter((k) => k !== c.key) : [...hidden, c.key])} />
                {c.label}
              </label>
            ))}
            {hidden.length > 0 && (
              <button type="button" className="ghost tiny dt-cols-reset" onClick={() => save([])}>Show all</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Export with the columns chosen here, for everything the filters leave (every page). */
export function ProductExport({ columns, total }: { columns: Col[]; total: number }) {
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState<string[]>(() => columns.map((c) => c.key));
  const href = () => {
    const q = new URLSearchParams(window.location.search);
    q.delete("page");
    q.set("cols", columns.filter((c) => on.includes(c.key)).map((c) => c.key).join(","));
    return `/products/export?${q}`;
  };
  return (
    <div className="dt-cols">
      <button type="button" className="dt-tool" aria-expanded={open} onClick={() => setOpen(!open)} disabled={total === 0}>
        <Download size={15} aria-hidden="true" /> Export
      </button>
      {open && (
        <>
          <div className="dt-cols-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="dt-cols-menu" role="group" aria-label="Columns to export">
            <strong className="dt-cols-title">Columns to export</strong>
            {columns.map((c) => (
              <label key={c.key} className="dt-cols-item">
                <input type="checkbox" checked={on.includes(c.key)}
                  onChange={() => setOn(on.includes(c.key) ? on.filter((k) => k !== c.key) : [...on, c.key])} />
                {c.label}
              </label>
            ))}
            <button type="button" className="dt-cols-go" disabled={on.length === 0}
              onClick={() => { window.location.href = href(); setOpen(false); }}>
              Download CSV · {total.toLocaleString("en-US")} rows
            </button>
          </div>
        </>
      )}
    </div>
  );
}

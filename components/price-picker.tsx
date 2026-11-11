"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Search } from "lucide-react";

export type PickOption = { key: string; item: string; code: string; uom: string; lines: number; change: number | null };

/**
 * Which product the chart shows: a list you can type into rather than a long
 * select. Each entry says how often it was bought or sold and how far its
 * price moved; "Price changed" narrows the list to the ones that moved.
 */
export function PricePicker({ options, value, baseQuery }: {
  options: PickOption[]; value: string;
  /** The page's query without the product, so picking keeps every other filter. */
  baseQuery: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [moved, setMoved] = useState(false);
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const current = options.find((o) => o.key === value);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return options.filter((o) => (!moved || (o.change !== null && Math.abs(o.change) >= 0.0005))
      && (!needle || `${o.item} ${o.code}`.toLowerCase().includes(needle)));
  }, [options, q, moved]);
  const changed = options.filter((o) => o.change !== null && Math.abs(o.change) >= 0.0005).length;

  useEffect(() => { setAt(0); }, [q, moved]);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const pick = (key: string) => {
    setOpen(false); setQ("");
    const sep = baseQuery.length > 1 ? "&" : "";
    router.replace(`${baseQuery}${sep}item=${encodeURIComponent(key)}`, { scroll: false });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(i + 1, list.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (list[at]) pick(list[at].key); }
    else if (e.key === "Escape") setOpen(false);
  };
  const pct = (c: number | null) => c === null || Math.abs(c) < 0.0005 ? null : `${c > 0 ? "▲" : "▼"} ${(Math.abs(c) * 100).toFixed(Math.abs(c) < 0.001 ? 2 : 1)}%`;

  return (
    <div className="pp" ref={box}>
      <button type="button" className="pp-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="pp-btn-text">{current ? <>{current.item} <small>{current.code} · {current.uom}</small></> : "Choose a product"}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div className="pp-pop" role="dialog" aria-label="Choose a product">
          <div className="pp-search">
            <Search size={15} aria-hidden="true" />
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
              placeholder="Type a name or SKU…" aria-label="Find a product" aria-controls="pp-list" />
          </div>
          <div className="segmented pp-seg" role="radiogroup" aria-label="Which products">
            <button type="button" role="radio" aria-checked={!moved} className={`seg${!moved ? " on" : ""}`} onClick={() => setMoved(false)}>All · {options.length}</button>
            <button type="button" role="radio" aria-checked={moved} className={`seg${moved ? " on" : ""}`} onClick={() => setMoved(true)}>Price changed · {changed}</button>
          </div>
          <ul id="pp-list" className="pp-list" role="listbox">
            {list.map((o, i) => (
              <li key={o.key} role="option" aria-selected={o.key === value} data-at={i === at || undefined}
                onMouseEnter={() => setAt(i)} onMouseDown={(e) => { e.preventDefault(); pick(o.key); }}>
                <span className="pp-name">{o.item}<small>{o.code} · per {o.uom}</small></span>
                <span className="pp-meta">
                  <span>{o.lines} line{o.lines === 1 ? "" : "s"}</span>
                  {pct(o.change) && <span className={o.change! > 0 ? "ph-up" : "ph-down"}>{pct(o.change)}</span>}
                </span>
              </li>
            ))}
            {list.length === 0 && <li className="pp-empty">No product matches.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

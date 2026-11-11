"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Search } from "lucide-react";

export type PickOption = { key: string; item: string; code: string; uom: string; lines: number; change: number | null };

/**
 * Which product the chart shows: a list you can type into rather than a long
 * select. Each entry says how often it was bought or sold and how far its
 * price moved; "Price changed" narrows the list to the ones that moved.
 * Keyboard: arrows move (the list follows), Enter picks, Escape closes and
 * hands focus back to the button.
 */
export function PricePicker({ options, value, baseQuery }: {
  options: PickOption[]; value: string;
  /** The page's query without the product, so picking keeps every other filter. */
  baseQuery: string;
}) {
  const router = useRouter();
  const [loading, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [moved, setMoved] = useState(false);
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const ul = useRef<HTMLUListElement>(null);
  const current = options.find((o) => o.key === value);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return options.filter((o) => (!moved || o.change !== null)
      && (!needle || `${o.item} ${o.code}`.toLowerCase().includes(needle)));
  }, [options, q, moved]);
  // The page decides what counts as a change (a whole kyat or more) and
  // sends null for the rest, so the two always agree.
  const changed = options.filter((o) => o.change !== null).length;

  // Opening starts on the product being shown; typing or narrowing starts at the top.
  const opened = useRef(false);
  useEffect(() => {
    if (!open) { opened.current = false; return; }
    const here = list.findIndex((o) => o.key === value);
    setAt(!opened.current && here >= 0 ? here : 0);
    opened.current = true;
  }, [open, q, moved]); // eslint-disable-line react-hooks/exhaustive-deps

  // The highlighted row stays in view as the arrows move it.
  useEffect(() => {
    if (open) ul.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at, open, list]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const close = (focusButton: boolean) => { setOpen(false); setQ(""); setMoved(false); if (focusButton) btn.current?.focus(); };
  const pick = (key: string) => {
    close(true);
    if (key === value) return;
    const sep = baseQuery.length > 1 ? "&" : "";
    start(() => router.replace(`${baseQuery}${sep}item=${encodeURIComponent(key)}`, { scroll: false }));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(i + 1, list.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Home") { e.preventDefault(); setAt(0); }
    else if (e.key === "End") { e.preventDefault(); setAt(Math.max(0, list.length - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (list[at]) pick(list[at].key); }
    else if (e.key === "Escape") { e.preventDefault(); close(true); }
  };
  const pct = (c: number | null) => c === null ? null : `${c > 0 ? "▲" : "▼"} ${(Math.abs(c) * 100).toFixed(Math.abs(c) < 0.001 ? 2 : 1)}%`;

  return (
    <div className="pp" ref={box}>
      <button ref={btn} type="button" className="pp-btn" aria-haspopup="listbox" aria-expanded={open} aria-busy={loading || undefined}
        onClick={() => (open ? close(false) : setOpen(true))}>
        <span className="pp-btn-text">
          {loading ? <span className="pp-btn-name">Loading…</span>
            : current ? <><span className="pp-btn-name">{current.item}</span><small>{current.code} · {current.uom}</small></>
            : <span className="pp-btn-name">Choose a product</span>}
        </span>
        <ChevronDown size={15} aria-hidden="true" className={open ? "pp-chev up" : "pp-chev"} />
      </button>
      {open && (
        <div className="pp-pop" role="dialog" aria-label="Choose a product">
          <div className="pp-search">
            <Search size={15} aria-hidden="true" />
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
              placeholder="Type a name or SKU…" aria-label="Find a product"
              role="combobox" aria-expanded="true" aria-controls="pp-list" aria-autocomplete="list"
              aria-activedescendant={list[at] ? `pp-opt-${at}` : undefined} />
          </div>
          <div className="segmented pp-seg" role="radiogroup" aria-label="Which products">
            <button type="button" role="radio" aria-checked={!moved} className={`seg${!moved ? " on" : ""}`} onClick={() => { setMoved(false); input.current?.focus(); }}>All · {options.length}</button>
            <button type="button" role="radio" aria-checked={moved} className={`seg${moved ? " on" : ""}`} onClick={() => { setMoved(true); input.current?.focus(); }}>Price changed · {changed}</button>
          </div>
          <ul ref={ul} id="pp-list" className="pp-list" role="listbox" aria-label="Products">
            {list.map((o, i) => (
              <li key={o.key} id={`pp-opt-${i}`} data-i={i} role="option" aria-selected={o.key === value} data-at={i === at || undefined}
                onMouseMove={() => at !== i && setAt(i)} onMouseDown={(e) => { e.preventDefault(); pick(o.key); }}>
                <span className="pp-name">{o.item}<small>{o.code} · per {o.uom}</small></span>
                <span className="pp-meta">
                  <span>{o.lines} line{o.lines === 1 ? "" : "s"}</span>
                  {pct(o.change) && <span className={o.change! > 0 ? "ph-up" : "ph-down"}>{pct(o.change)}</span>}
                </span>
              </li>
            ))}
            {list.length === 0 && <li className="pp-empty" aria-disabled="true">No product matches.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

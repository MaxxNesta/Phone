"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

/**
 * Where a customer is, chosen from MIMU's township list (2026-11-27). Type a
 * township, a town in it, a city or a region, in English or Myanmar; the
 * region and city follow from the township. "Not sure yet" is an answer, so a
 * counter sale is never held up — the customer lands on the list of places to
 * complete. The list (lib/mm-places.json) loads the first time it opens.
 */
type P = { c: string; k: "R" | "C" | "T"; n: string; m: string | null; r: string; t: string | null; s: string[] };
let loaded: Promise<P[]> | null = null;
const loadPlaces = () => (loaded ??= import("@/lib/mm-places.json").then((m) => m.default as P[]));
const key = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const NOT_SURE = "-";

const describe = (p: P) =>
  p.k === "R" ? "Region only — township not known"
  : p.k === "C" ? `City, any township · ${p.r}`
  : [p.t ? `${p.t} city` : null, p.r].filter(Boolean).join(" · ");

export function PlacePicker({ name = "place_code", value, label, required = false }: {
  name?: string;
  /** The customer's place now: its code and how it reads, or null for not set. */
  value: { code: string | null; label: string | null } | null;
  label: string;
  /** A new customer must answer, even if the answer is "Not sure yet". */
  required?: boolean;
}) {
  const [code, setCode] = useState<string>(value ? (value.code ?? NOT_SURE) : "");
  const [shown, setShown] = useState<string>(value?.code ? value.label ?? "" : value ? "Not sure yet" : "");
  const [sub, setSub] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState("");
  const [places, setPlaces] = useState<P[] | null>(null);
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open && !places) loadPlaces().then(setPlaces); }, [open, places]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const hits = useMemo(() => {
    if (!places) return [];
    const q = key(find), raw = find.trim();
    const order = { T: 0, C: 1, R: 2 } as const;
    if (!raw) return places.filter((p) => p.k !== "T").sort((a, b) => order[a.k] - order[b.k] || a.n.localeCompare(b.n));
    const score = (p: P) => {
      const n = key(p.n);
      if (q && n === q) return 0;
      if (q && n.startsWith(q)) return 1;
      if (q && p.s.some((s) => s.startsWith(q))) return 2;
      if (q && (n.includes(q) || p.s.some((s) => s.includes(q)))) return 3;
      if (!q && p.m && p.m.includes(raw)) return 2;   // Myanmar script has no letters a–z
      return 9;
    };
    return places.map((p) => [p, score(p)] as const).filter(([, s]) => s < 9)
      .sort((a, b) => a[1] - b[1] || order[a[0].k] - order[b[0].k] || a[0].n.localeCompare(b[0].n))
      .slice(0, 40).map(([p]) => p);
  }, [places, find]);

  const choose = (p: P | null) => {
    if (p) { setCode(p.c); setShown(p.n); setSub(describe(p)); } else { setCode(NOT_SURE); setShown("Not sure yet"); setSub("Saved without a place; it goes on the list to complete"); }
    setOpen(false); setFind("");
  };
  const options = [null, ...hits];

  return (
    <div className="place-pick" ref={box}>
      <input type="hidden" name={name} value={code} />
      <button type="button" className={`place-pick-btn${code ? "" : " empty"}`} aria-haspopup="listbox" aria-expanded={open}
              aria-label={label} onClick={() => { setOpen(!open); setAt(0); }}>
        <span>{shown || "Choose township, city or region"}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {sub && <span className="hint">{sub}</span>}
      {required && !code && <span className="hint">Required — choose “Not sure yet” if you don’t know.</span>}
      {/* A required field the browser can check: empty until something is chosen. */}
      {required && <input tabIndex={-1} aria-hidden="true" className="place-pick-req" value={code} onChange={() => {}} required />}
      {open && (
        <div className="place-pick-menu">
          <div className="dt-multi-findbox">
            <Search size={15} aria-hidden="true" />
            <input type="search" className="dt-multi-find" autoFocus placeholder="Township, town, city or region"
                   value={find} onChange={(e) => { setFind(e.target.value); setAt(e.target.value.trim() ? 1 : 0); }}
                   onKeyDown={(e) => {
                     if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(options.length - 1, i + 1)); }
                     else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
                     else if (e.key === "Enter") { e.preventDefault(); choose(options[at] ?? null); }
                     else if (e.key === "Escape") setOpen(false);
                   }} />
          </div>
          <ul role="listbox" aria-label={label}>
            {!places && <li className="place-pick-none">Loading the township list…</li>}
            {places && options.map((p, i) => (
              <li key={p?.c ?? NOT_SURE} role="option" aria-selected={i === at} className={i === at ? "on" : undefined}
                  onMouseEnter={() => setAt(i)} onMouseDown={(e) => { e.preventDefault(); choose(p); }}>
                {p ? (<><strong>{p.n}</strong>{p.m && <span className="my">{p.m}</span>}<small>{describe(p)}</small></>)
                   : (<><strong>Not sure yet</strong><small>Save now, complete the township later</small></>)}
              </li>
            ))}
            {places && find.trim() && hits.length === 0 && <li className="place-pick-none">No township, city or region by that name.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ListPlus, SlidersHorizontal, X, Plus } from "lucide-react";
import type { PickerItem } from "@/lib/actions";
import { asVariant } from "./variant-tags";
import { useTranslations } from "next-intl";

type Node = { id: string; name: string; parent_id: string | null };
export type Pick = { itemId: string; qty: number };
type Filters = { category: string; brand: string; model: string; opts: Record<string, string> };
const NONE: Filters = { category: "", brand: "", model: "", opts: {} };

/** "iPhone 13 · 128 GB · Midnight" — the model and what sets this one apart. */
export function itemLabel(i: PickerItem) {
  const v = asVariant(i.variant) ?? [];
  return i.model && v.length ? [i.model, ...v.map((x) => x.o)].join(" · ") : i.name;
}

/**
 * How lines get onto a document: search by name, SKU, code or barcode and
 * pick from what appears underneath, or open the catalogue and tick several
 * at once. Both feed the same table, and the search box takes the focus
 * back after every add so the next scan needs no click.
 */
export function AddItemsBar({
  items, categories, onAdd, onEnter, available, availLabel: availLabelProp, empty: emptyProp, title, sub, stockToggle = false,
}: {
  /** What the number column means here — "Outstanding" against an order. */
  availLabel?: string;
  /** Said when the catalogue has nothing to offer. */
  empty?: string;
  items: PickerItem[];
  categories: Node[];
  onAdd: (picks: Pick[]) => void;
  /** Tried first on Enter — a sale reads an IMEI here. True when it was handled. */
  onEnter?: (term: string) => Promise<boolean>;
  /** Units free at the document's warehouse; the item's total when omitted. */
  available?: (itemId: string) => number;
  title: string;
  sub?: string;
  /** Selling: start the catalogue on what is in stock. */
  stockToggle?: boolean;
}) {
  const pk = useTranslations("picker");
  const availLabel = availLabelProp ?? pk("available");
  const empty = emptyProp ?? pk("nothingMatches");
  const box = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [f, setF] = useState<Filters>(NONE);
  const [showFilters, setShowFilters] = useState(false);
  // The match list shows while someone is searching, and goes once they pick.
  const [listing, setListing] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const avail = (i: PickerItem) => (available ? available(i.id) : Number(i.on_hand) || 0);

  const topOf = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    return (groupId: string) => {
      const c = byId.get(groupId);
      return c?.parent_id ?? c?.id ?? "";
    };
  }, [categories]);

  // What each filter can still offer, given the ones above it.
  const facets = useMemo(() => {
    const inCat = items.filter((i) => !f.category || topOf(i.item_group_id) === f.category);
    const brands = [...new Set(items.map((i) => i.brand).filter((b): b is string => Boolean(b)))].sort();
    const ofBrand = inCat.filter((i) => !f.brand || i.brand === f.brand);
    const models = [...new Set(ofBrand.map((i) => i.model).filter((m): m is string => Boolean(m)))].sort();
    const ofModel = ofBrand.filter((i) => !f.model || i.model === f.model);
    const attrs = new Map<string, Set<string>>();
    for (const i of ofModel) for (const v of asVariant(i.variant) ?? []) {
      if (!attrs.has(v.a)) attrs.set(v.a, new Set());
      attrs.get(v.a)!.add(v.o);
    }
    const cats = categories.filter((c) => !c.parent_id && items.some((i) => topOf(i.item_group_id) === c.id));
    return { cats, brands, models, attrs: [...attrs].slice(0, 4).map(([a, s]) => ({ a, opts: [...s].sort() })) };
  }, [items, categories, topOf, f.category, f.brand, f.model]);

  const filtering = Boolean(f.category || f.brand || f.model || Object.values(f.opts).some(Boolean));
  const match = (i: PickerItem, term: string) => {
    if (f.category && topOf(i.item_group_id) !== f.category) return false;
    if (f.brand && i.brand !== f.brand) return false;
    if (f.model && i.model !== f.model) return false;
    const v = asVariant(i.variant) ?? [];
    for (const [a, o] of Object.entries(f.opts)) if (o && !v.some((x) => x.a === a && x.o === o)) return false;
    const t = term.trim().toLowerCase();
    if (!t) return true;
    return [i.code, i.name, i.barcode ?? "", i.model ?? "", i.brand ?? "", ...v.map((x) => x.o)]
      .some((s) => s.toLowerCase().includes(t));
  };

  const hits = useMemo(
    () => (q.trim() || filtering ? byRelevance(items.filter((i) => match(i, q)), q, avail).slice(0, 8) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, q, f, filtering]);
  useEffect(() => setHi(0), [q, f]);
  useEffect(() => { if (filtering) setListing(true); }, [f, filtering]);

  const add = (picks: Pick[]) => {
    if (picks.length === 0) return;
    onAdd(picks);
    setQ(""); setMsg(null); setListing(false); setShowFilters(false);
    box.current?.focus();
  };

  async function enter() {
    const t = q.trim();
    if (!t) return;
    if (onEnter && (await onEnter(t))) { setQ(""); setMsg(null); setListing(false); box.current?.focus(); return; }
    // A scanned barcode or a typed code means one item: it goes straight on.
    const exact = items.filter((i) => i.barcode === t || i.code.toLowerCase() === t.toLowerCase());
    const pick = exact.length === 1 ? exact[0] : hits[hi];
    if (pick) add([{ itemId: pick.id, qty: 1 }]);
    else setMsg(pk("nothingMatchesTerm", { term: t }));
  }

  const setOpt = (a: string, o: string) => setF((x) => ({ ...x, opts: { ...x.opts, [a]: o } }));
  const filterFields = (
    <div className="aib-filters">
      <label>{pk("category")}<select value={f.category} onChange={(e) => setF({ ...NONE, category: e.target.value })}>
        <option value="">{pk("allCategories")}</option>
        {facets.cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>
      {facets.brands.length > 1 && (
        <label>{pk("brand")}<select value={f.brand} onChange={(e) => setF((x) => ({ ...x, brand: e.target.value, model: "", opts: {} }))}>
          <option value="">{pk("allBrands")}</option>
          {facets.brands.map((b) => <option key={b}>{b}</option>)}
        </select></label>
      )}
      <label>{pk("model")}<select value={f.model} onChange={(e) => setF((x) => ({ ...x, model: e.target.value, opts: {} }))}>
        <option value="">{pk("allModels")}</option>
        {facets.models.map((m) => <option key={m}>{m}</option>)}
      </select></label>
      {facets.attrs.map(({ a, opts }) => (
        <label key={a}>{a}<select value={f.opts[a] ?? ""} onChange={(e) => setOpt(a, e.target.value)}>
          <option value="">{pk("all")}</option>
          {opts.map((o) => <option key={o}>{o}</option>)}
        </select></label>
      ))}
      {filtering && <button type="button" className="linkish" onClick={() => setF(NONE)}>{pk("clear")}</button>}
    </div>
  );

  return (
    <div className="aib">
      <div className="aib-row">
        <div className="aib-search">
          <Search size={17} aria-hidden="true" />
          <input ref={box} id="add-items-search" value={q} autoComplete="off" aria-label={pk("searchItems")}
            onFocus={() => q.trim() && setListing(true)}
            onBlur={() => setListing(false)}
            placeholder={pk("searchPlaceholder")}
            onChange={(e) => { setQ(e.target.value); setMsg(null); setListing(true); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); enter(); }
              else if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, hits.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
              else if (e.key === "Escape") { setQ(""); setListing(false); }
            }} />
          {listing && hits.length > 0 && (
            <div className="aib-hits" role="listbox" aria-label={pk("matchingItems")}>
              {hits.map((i, n) => (
                <button key={i.id} type="button" className="aib-hit" role="option" aria-selected={n === hi}
                  // Kept from taking the focus, so the list is still there for the click.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHi(n)} onClick={() => add([{ itemId: i.id, qty: 1 }])}>
                  <Thumb i={i} />
                  <span className="aib-name"><strong>{itemLabel(i)}</strong>
                    <small>{[i.brand, i.code].filter(Boolean).join(" · ")}</small></span>
                  <span className={`aib-avail${avail(i) > 0 ? " ok" : ""}`}>{avail(i)} {availLabel.toLowerCase()}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="btn ghost aib-toggle" aria-expanded={showFilters}
          onClick={() => setShowFilters((s) => !s)}>
          <SlidersHorizontal size={15} aria-hidden="true" /> {pk("filters")}{filtering ? " •" : ""}
        </button>
        <button type="button" className="btn aib-browse" onClick={() => setBrowsing(true)}>
          <ListPlus size={16} aria-hidden="true" /> {pk("browseAdd")}
        </button>
      </div>
      {msg && <p className="hint low" role="status">{msg}</p>}
      {showFilters && filterFields}
      {browsing && (
        <Browse items={items} match={match} avail={avail} availLabel={availLabel} empty={empty} title={title} sub={sub} filters={filterFields}
          stockToggle={stockToggle}
          onClose={() => { setBrowsing(false); box.current?.focus(); }}
          onAdd={(p) => { setBrowsing(false); add(p); }} />
      )}
    </div>
  );
}

/** In stock before out of stock, then a name or code that starts with what was
 *  typed before one that only contains it, then by name. */
function byRelevance(list: PickerItem[], term: string, avail: (i: PickerItem) => number) {
  const t = term.trim().toLowerCase();
  const starts = (i: PickerItem) =>
    t && (i.name.toLowerCase().startsWith(t) || i.code.toLowerCase().startsWith(t) || (i.model ?? "").toLowerCase().startsWith(t)) ? 0 : 1;
  return [...list].sort((a, b) =>
    Number(avail(b) > 0) - Number(avail(a) > 0) || starts(a) - starts(b) || a.name.localeCompare(b.name));
}

/** The item's photo, or nothing: an empty placeholder only took space. */
export function Thumb({ i }: { i: PickerItem }) {
  if (!i.photo) return null;
  return <span className="aib-thumb"><img src={i.photo} alt="" /></span>;
}

/** The catalogue as a table: tick what is wanted, set how many, add them all. */
function Browse({ items, match, avail, availLabel, empty, title, sub, filters, stockToggle, onClose, onAdd }: {
  items: PickerItem[]; match: (i: PickerItem, q: string) => boolean; avail: (i: PickerItem) => number;
  availLabel: string; empty: string;
  title: string; sub?: string; filters: React.ReactNode; stockToggle: boolean;
  onClose: () => void; onAdd: (p: Pick[]) => void;
}) {
  const pk = useTranslations("picker");
  const [q, setQ] = useState("");
  const [inStock, setInStock] = useState(stockToggle);
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const rows = byRelevance(items.filter((i) => match(i, q) && (!inStock || avail(i) > 0)), q, avail);
  const shown = rows.slice(0, 200);
  const count = Object.keys(chosen).length;
  const toggle = (id: string) => setChosen((c) => {
    const n = { ...c };
    if (id in n) delete n[id]; else n[id] = 1;
    return n;
  });

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="aib-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="aib-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <div><h2>{title}</h2>{sub && <p className="page-sub">{sub}</p>}</div>
          <button type="button" className="aib-x" onClick={onClose} aria-label={pk("close")}><X size={18} /></button>
        </header>
        <div className="aib-search">
          <Search size={17} aria-hidden="true" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
            placeholder={pk("catalogueSearch")} aria-label={pk("searchCatalogue")} />
        </div>
        {filters}
        {stockToggle && (
          <div className="scopetabs" style={{ margin: "4px 0 0" }}>
            <button type="button" className="scopetab" data-active={inStock} onClick={() => setInStock(true)}>{pk("inStock")}</button>
            <button type="button" className="scopetab" data-active={!inStock} onClick={() => setInStock(false)}>{pk("allItems")}</button>
          </div>
        )}
        <div className="aib-tablewrap">
          <table className="aib-table">
            <thead>
              <tr>
                <th className="tight">
                  <input type="checkbox" aria-label={pk("selectAllShown")}
                    checked={shown.length > 0 && shown.every((i) => i.id in chosen)}
                    onChange={(e) => setChosen((c) => {
                      const n = { ...c };
                      for (const i of shown) { if (e.target.checked) n[i.id] ??= 1; else delete n[i.id]; }
                      return n;
                    })} />
                </th>
                <th>{pk("productVariant")}</th><th>{pk("sku")}</th><th className="r">{availLabel}</th><th className="r">{pk("qty")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id} data-on={i.id in chosen || undefined} onClick={(e) => {
                  if ((e.target as HTMLElement).closest("input")) return;
                  toggle(i.id);
                }}>
                  <td className="tight"><input type="checkbox" checked={i.id in chosen} onChange={() => toggle(i.id)}
                    aria-label={pk("selectItem", { name: itemLabel(i) })} /></td>
                  <td><span className="aib-prod"><Thumb i={i} />
                    <span className="aib-name"><strong>{itemLabel(i)}</strong>
                      <small>{[i.brand, i.model].filter(Boolean).join(" / ")}</small></span></span></td>
                  <td className="m">{i.code}</td>
                  <td className={`r aib-avail${avail(i) > 0 ? " ok" : ""}`}>{avail(i)}</td>
                  <td className="r">
                    <input type="number" min={1} className="aib-qty" value={chosen[i.id] ?? ""} placeholder="0"
                      aria-label={pk("quantityOf", { name: itemLabel(i) })}
                      onChange={(e) => {
                        const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                        setChosen((c) => {
                          const x = { ...c };
                          if (n > 0) x[i.id] = n; else delete x[i.id];
                          return x;
                        });
                      }} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="page-sub">{q || items.length ? pk("nothingMatches") : empty}</td></tr>}
            </tbody>
          </table>
          {rows.length > shown.length && <p className="hint low">{pk("showing200", { n: rows.length })}</p>}
        </div>
        <footer>
          <span className="page-sub">{pk("nSelected", { n: count })}</span>
          <button type="button" className="btn ghost" onClick={onClose}>{pk("cancel")}</button>
          <button type="button" className="btn" disabled={count === 0}
            onClick={() => onAdd(Object.entries(chosen).map(([itemId, qty]) => ({ itemId, qty })))}>
            <Plus size={15} aria-hidden="true" /> {pk("addSelected")}
          </button>
        </footer>
      </aside>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Search, ShoppingCart, Smartphone, X } from "lucide-react";
import type { SellableItem, ScannedUnit } from "@/lib/phone";
import { variantLine } from "@/lib/pos-facets";
import { money } from "@/lib/format";
import { useTranslations } from "next-intl";

/** Keeps Tab inside a dialog and puts Escape to the caller. */
function useDialogKeys(root: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab") return;
      const f = [...(root.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? [])];
      if (f.length === 0) return;
      const at = f.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      f[(at < 0 ? 0 : (at + (e.shiftKey ? -1 : 1) + f.length) % f.length)].focus();
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = overflow; };
  }, [onClose, root]);
}

const Photo = ({ item, size }: { item: SellableItem; size: number }) => (
  <span className="pu-photo" style={{ width: size, height: size * 1.2 }}>
    {item.photo ? <img src={item.photo} alt="" /> : <Smartphone size={size * 0.4} aria-hidden="true" />}
  </span>
);

/**
 * Which units of a serialised variant go on the sale: a centered sheet with the
 * product, a search that takes a scanned IMEI, and a list of the units on the
 * shelf with checkboxes. The caller hands in only units that are in stock here
 * and not already on the sale; nothing here can pick any other.
 */
export function PosUnitPicker({ item, units, onAdd, onClose }: {
  item: SellableItem; units: ScannedUnit[];
  onAdd: (picked: ScannedUnit[]) => void; onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const tr = useTranslations("pos");
  const search = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useDialogKeys(root, onClose);
  useEffect(() => { search.current?.focus(); }, []);

  const shown = useMemo(() => {
    const t = q.trim();
    return t ? units.filter((u) => u.imei.includes(t) || (u.imei2 ?? "").includes(t)) : units;
  }, [units, q]);
  const allShown = shown.length > 0 && shown.every((u) => picked.has(u.serial_id));
  const someShown = shown.some((u) => picked.has(u.serial_id));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setPicked((p) => {
    const n = new Set(p);
    if (allShown) shown.forEach((u) => n.delete(u.serial_id)); else shown.forEach((u) => n.add(u.serial_id));
    return n;
  });
  const count = units.filter((u) => picked.has(u.serial_id)).length;
  const variant = variantLine(item);

  // Enter: a scanned IMEI that is on the list is ticked, and the box is ready for the next.
  const enter = () => {
    const t = q.trim();
    if (!t) return;
    const exact = units.find((u) => u.imei === t || u.imei2 === t) ?? (shown.length === 1 ? shown[0] : null);
    if (exact) { setPicked((p) => new Set(p).add(exact.serial_id)); setQ(""); }
  };

  return createPortal(
    <div className="pu-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={root} className="pu" role="dialog" aria-modal="true" aria-labelledby="pu-title">
        <header className="pu-head">
          <h2 id="pu-title">{tr("selectImeis")}</h2>
          <button type="button" className="pu-x" aria-label={tr("close")} onClick={onClose}><X size={18} /></button>
        </header>

        <div className="pu-prod">
          <Photo item={item} size={56} />
          <div className="pu-prod-text">
            <strong>{item.model}</strong>
            {variant && <span className="pu-sub">{variant}</span>}
            <span className="pu-price">
              {item.price != null && item.price > 0 ? <>{money(item.price)} <small>MMK</small></> : <em>{tr("noPriceSet")}</em>}
              <span className="pu-avail">{tr("available", { n: units.length })}</span>
            </span>
          </div>
        </div>

        <form className="pu-search" onSubmit={(e) => { e.preventDefault(); enter(); }} role="search">
          <Search size={17} aria-hidden="true" />
          <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" inputMode="numeric"
            placeholder={tr("searchImei")} aria-label={tr("searchImeiLabel")} />
        </form>

        <div className="pu-bar">
          <label className="pu-all">
            <input type="checkbox" checked={allShown} ref={(el) => { if (el) el.indeterminate = !allShown && someShown; }}
              onChange={toggleAll} disabled={shown.length === 0} />
            {q.trim() ? tr("selectAllShown") : tr("selectAll")}
          </label>
          <span className="pu-n" aria-live="polite">{tr("shownOf", { shown: shown.length, total: units.length })}</span>
        </div>

        <ul className="pu-list" aria-label={tr("imeisOnShelf")}>
          {shown.map((u) => (
            <li key={u.serial_id}>
              <label className={`pu-row${picked.has(u.serial_id) ? " on" : ""}`}>
                <input type="checkbox" checked={picked.has(u.serial_id)} onChange={() => toggle(u.serial_id)} />
                <span className="pu-row-text">
                  <span className="m">{u.imei}</span>
                  <span className="pu-row-sub">{tr("availableAt", { location: u.location_name, code: item.code })}</span>
                </span>
              </label>
            </li>
          ))}
          {shown.length === 0 && (
            <li className="pu-none">{units.length === 0 ? tr("noUnitsHere") : tr("noImeiMatch")}</li>
          )}
        </ul>

        <footer className="pu-foot">
          <span className="pu-count"><b>{count}</b> {tr("selected")}</span>
          <button type="button" className="pu-add" disabled={count === 0} onClick={() => onAdd(units.filter((u) => picked.has(u.serial_id)))}>
            <ShoppingCart size={16} aria-hidden="true" /> {count === 0 ? tr("addToCart") : tr("addNToCart", { n: count })}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** A light confirmation after units go on the sale: what was added, and where to go next. */
export function PosAddedConfirm({ item, imeis, cartUnits, onContinue, onViewCart }: {
  item: SellableItem; imeis: string[]; cartUnits: number; onContinue: () => void; onViewCart: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const tr = useTranslations("pos");
  const cont = useRef<HTMLButtonElement>(null);
  useDialogKeys(root, onContinue);
  useEffect(() => { cont.current?.focus(); }, []);
  const variant = variantLine(item);

  return createPortal(
    <div className="pu-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onContinue(); }}>
      <div ref={root} className="pu pu-small" role="dialog" aria-modal="true" aria-labelledby="pa-title">
        <button type="button" className="pu-x pu-x-abs" aria-label={tr("close")} onClick={onContinue}><X size={18} /></button>
        <div className="pa-top">
          <span className="pa-check" aria-hidden="true"><Check size={28} strokeWidth={3} /></span>
          <h2 id="pa-title">{tr("addedToCart")}</h2>
          <p>{tr("addedOk", { n: imeis.length })}</p>
        </div>
        <div className="pu-prod pa-prod">
          <Photo item={item} size={52} />
          <div className="pu-prod-text">
            <strong>{item.model}</strong>
            {variant && <span className="pu-sub">{variant}</span>}
            {item.price != null && item.price > 0 && <span className="pu-price">{money(item.price)} <small>MMK</small></span>}
          </div>
        </div>
        <div className="pa-imeis">
          <h3>{tr("addedImeis")}</h3>
          <ol>{imeis.map((s) => <li key={s}><span className="m">{s}</span></li>)}</ol>
        </div>
        <div className="pa-actions">
          <button ref={cont} type="button" className="pa-ghost" onClick={onContinue}>{tr("continueShopping")}</button>
          <button type="button" className="pu-add" onClick={onViewCart}>{tr("viewCartN", { n: cartUnits })}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

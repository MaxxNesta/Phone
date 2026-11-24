"use client";

import { useActionState, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions";
import { useNotice } from "@/components/toast";

type Cell = { price: number | null; validFrom: string | null; history: { price: number | null; from: string }[] };
export type PriceUnit = { uomId: string; code: string; isBase: boolean; per: string | null; cells: Record<string, Cell> };
export type PriceProduct = { itemId: string; code: string; name: string; units: PriceUnit[] };
type Level = { id: string; name: string; isDefault: boolean };
type Act = (prev: unknown, fd: FormData) => Promise<ActionResult>;
type Pick = { itemId: string; uomId: string; levelId: string };

const mmk = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const nice = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const PAGE = 40;

/**
 * Price levels, laid out as the Astryx preview (2026-11-24): products down
 * with their units beneath, a column per level; a price opens the Set price
 * panel beside the list; the levels are managed in a dialog.
 */
export function PriceList({ products, levels, today, openLevels, setAction, clearAction, manage }: {
  products: PriceProduct[]; levels: Level[]; today: string; openLevels: boolean;
  setAction: Act; clearAction: Act; manage: ReactNode;
}) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState("all");
  const [shown, setShown] = useState(PAGE);
  const [pick, setPick] = useState<Pick | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  // The page steps aside for the panel, as it does for the IMEI drawer.
  useEffect(() => {
    document.documentElement.classList.toggle("price-panel-open", !!pick);
    return () => document.documentElement.classList.remove("price-panel-open");
  }, [pick]);
  useEffect(() => { if (openLevels) dialog.current?.showModal(); }, [openLevels]);

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return products.filter((p) => !n || `${p.code} ${p.name}`.toLowerCase().includes(n))
      .filter((p) => only === "all" || (only === "packs") === (p.units.length > 1));
  }, [products, q, only]);
  const priced = products.filter((p) => p.units.some((u) => u.isBase && Object.values(u.cells).some((c) => c.price != null))).length;
  const product = pick ? products.find((p) => p.itemId === pick.itemId) : undefined;

  return (
    <div className="pl3-page">
      <div className="pl3-head">
        <div>
          <span className="pl3-eyebrow">Master data</span>
          <h1>Price levels</h1>
          <p>Selling prices by product and unit, at every price level</p>
        </div>
        <button type="button" className="pl3-btn" onClick={() => dialog.current?.showModal()}>Manage price levels</button>
      </div>

      <div className="pl3-bar">
        <span className="pl3-count">{levels.length} level{levels.length === 1 ? "" : "s"} · {priced} of {products.length} products priced</span>
        <input type="search" className="pl3-search" placeholder="Search products…" aria-label="Search products" value={q}
          onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} />
        <select className="pl3-select" aria-label="Show" value={only} onChange={(e) => { setOnly(e.target.value); setShown(PAGE); }}>
          <option value="all">All products</option>
          <option value="packs">Sold in packs</option>
          <option value="single">One unit only</option>
        </select>
      </div>

      <div className="pl3-tablewrap">
        <table className="pl3-table">
          <colgroup><col /><col style={{ width: 150 }} />{levels.map((l) => <col key={l.id} style={{ width: 150 }} />)}</colgroup>
          <thead>
            <tr>
              <th>Product</th><th>Unit</th>
              {levels.map((l) => <th key={l.id} className="r">{l.name}{l.isDefault ? " (Default)" : ""} <small>MMK</small></th>)}
            </tr>
          </thead>
          <tbody>
            {list.slice(0, shown).map((p) => p.units.map((u, i) => (
              <tr key={`${p.itemId}-${u.uomId}`} className={i === p.units.length - 1 ? "pl3-last" : undefined}>
                {i === 0 && (
                  <td rowSpan={p.units.length} className="pl3-prod">
                    <strong>{p.name}</strong>
                    <span>{p.code}</span>
                  </td>
                )}
                <td className="pl3-unit">
                  {u.code}
                  {u.per && <span>{u.per}</span>}
                </td>
                {levels.map((l) => {
                  const c = u.cells[l.id];
                  const on = pick?.itemId === p.itemId && pick.uomId === u.uomId && pick.levelId === l.id;
                  return (
                    <td key={l.id} className="r">
                      <button type="button" className={`pl3-cell${on ? " on" : ""}`}
                        aria-label={`${p.name}, ${u.code}, ${l.name}: ${c?.price != null ? mmk(c.price) : "no price"}`}
                        onClick={() => setPick({ itemId: p.itemId, uomId: u.uomId, levelId: l.id })}>
                        {c?.price != null ? mmk(c.price) : <span className="pl3-none">—</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            )))}
          </tbody>
        </table>
        {list.length === 0 && <div className="pl3-empty">No product matches.</div>}
        {list.length > shown && (
          <div className="pl3-more">
            <button type="button" className="pl3-btn" onClick={() => setShown((n) => n + PAGE)}>
              Show more · {list.length - shown} left
            </button>
          </div>
        )}
      </div>

      {pick && product && (
        <SetPrice key={`${pick.itemId}|${pick.uomId}|${pick.levelId}`} product={product} pick={pick} levels={levels} today={today}
          setAction={setAction} clearAction={clearAction} onPick={setPick} onClose={() => setPick(null)} />
      )}

      <dialog ref={dialog} className="pl3-dialog" aria-labelledby="pl3-dialog-title"
        onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
        <div className="pl3-dialog-head">
          <div>
            <h2 id="pl3-dialog-title">Manage price levels</h2>
            <p>The price levels customers are quoted at. Each is a column of the price list.</p>
          </div>
          <button type="button" className="pl3-x" aria-label="Close" onClick={() => dialog.current?.close()}>×</button>
        </div>
        <div className="pl3-dialog-body">{manage}</div>
        <div className="pl3-dialog-foot">
          <button type="button" className="pl3-btn" onClick={() => dialog.current?.close()}>Close</button>
        </div>
      </dialog>
    </div>
  );
}

/** The side panel: one price of one unit at one level, from a date; every price before it below. */
function SetPrice({ product, pick, levels, today, setAction, clearAction, onPick, onClose }: {
  product: PriceProduct; pick: Pick; levels: Level[]; today: string;
  setAction: Act; clearAction: Act; onPick: (p: Pick) => void; onClose: () => void;
}) {
  const router = useRouter();
  const unit = product.units.find((u) => u.uomId === pick.uomId) ?? product.units[0];
  const cell = unit.cells[pick.levelId];
  const rows = cell?.history ?? [];
  const now = rows.find((r) => r.from <= today);
  const [open, setOpen] = useState(true);
  const [saveState, save, saving] = useActionState<ActionResult | null, FormData>(setAction as never, null);
  const [clearState, clear, clearing] = useActionState<ActionResult | null, FormData>(clearAction as never, null);
  useNotice(saveState, { ok: "Price saved" });
  useNotice(clearState, { ok: "Price removed" });
  useEffect(() => {
    if ((saveState && "ok" in saveState) || (clearState && "ok" in clearState)) { router.refresh(); onClose(); }
  }, [saveState, clearState]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const error = (saveState && "error" in saveState && saveState.error) || (clearState && "error" in clearState && clearState.error);
  const hidden = (
    <>
      <input type="hidden" name="item_id" value={product.itemId} />
      <input type="hidden" name="uom_id" value={pick.uomId} />
      <input type="hidden" name="price_level_id" value={pick.levelId} />
      <input type="hidden" name="stay" value="1" />
    </>
  );

  return (
    <aside className="pl3-panel" role="dialog" aria-label="Set price">
      <div className="pl3-panel-head">
        <div>
          <h2>Set price</h2>
          <p>{product.name} · {product.code}</p>
        </div>
        <button type="button" className="pl3-x" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <form action={save} className="pl3-panel-body" id="pl3-set">
        {hidden}
        {error && <div className="alert">{error}</div>}
        <label className="pl3-field">Unit
          <select value={pick.uomId} onChange={(e) => onPick({ ...pick, uomId: e.target.value })}>
            {product.units.map((u) => <option key={u.uomId} value={u.uomId}>{u.per ? `${u.code} · ${u.per}` : u.code}</option>)}
          </select>
        </label>
        <label className="pl3-field">Price level
          <select value={pick.levelId} onChange={(e) => onPick({ ...pick, levelId: e.target.value })}>
            {levels.map((l) => <option key={l.id} value={l.id}>{l.name}{l.isDefault ? " (Default)" : ""}</option>)}
          </select>
        </label>
        <label className="pl3-field">Price (MMK)
          <input name="price" type="number" min="0" step="any" inputMode="decimal" required autoFocus
            defaultValue={now?.price ?? ""} placeholder={now?.price == null ? "No price" : undefined} />
        </label>
        <label className="pl3-field">Effective from
          <span className="pl3-hint">Invoices before this date keep their price; the price before it stays in the history.</span>
          <input name="valid_from" type="date" defaultValue={today} required />
        </label>
        <hr />
        <button type="button" className="pl3-hist-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className={`pl3-caret${open ? " open" : ""}`} aria-hidden="true">›</span>
          <strong>Price history</strong>
          <span className="pl3-badge">{rows.length}</span>
        </button>
        {open && (rows.length === 0 ? <p className="pl3-hint">Never priced at this level.</p> : (
          <ul className="pl3-hist">
            {rows.map((r, i) => (
              <li key={r.from}>
                <span>{nice(r.from)}</span>
                <span className="pl3-hist-r">
                  {r.from > today && <span className="pl3-badge info">Starts later</span>}
                  {r === now && <span className="pl3-badge">Current</span>}
                  {r.price == null ? <span className="pl3-none">Removed</span>
                    : i === 0 ? <strong>MMK {mmk(r.price)}</strong> : <span>MMK {mmk(r.price)}</span>}
                </span>
              </li>
            ))}
          </ul>
        ))}
      </form>
      <div className="pl3-panel-foot">
        {now?.price != null && (
          <form action={clear}>
            {hidden}
            <button type="submit" className="pl3-btn ghost" disabled={clearing}>Remove from today</button>
          </form>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="pl3-btn" onClick={onClose}>Cancel</button>
        <button type="submit" form="pl3-set" className="pl3-btn primary" disabled={saving}>{saving ? "Saving…" : "Save price"}</button>
      </div>
    </aside>
  );
}

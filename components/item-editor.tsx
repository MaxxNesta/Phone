"use client";

import { useActionState, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import type { ActionResult } from "@/lib/actions";
import { optionLabel } from "@/lib/item-code";
import { PackSizes } from "./pack-sizes";
import { PartNumbers, type PartNo } from "./part-numbers";
import { ItemPhotoRow, type PhotoInfo } from "./item-photo-row";
import { HelpHint } from "./help-hint";
import { useNotice } from "@/components/toast";

export type EditorItem = {
  id: string; code: string; name: string; nameCustom: boolean; barcode: string;
  /** kg per unit, for freight split by weight; "" when not set. */
  weightKg: string;
  isActive: boolean; isStocked: boolean; identity: string; tracksSerial: boolean;
  uom: string; brand: string | null; category: string;
  parentId: string | null; parentName: string | null;
  /** A product that varies: its own settings, its variants listed below. */
  isModel: boolean;
  /** A product's own settings (a model or a plain item; a variant inherits them). */
  nameMy: string; brandId: string; uomId: string; ownPhoto: string | null;
  /** Whose photo shows and why: the model's default, a colour's own (2026-11-25). */
  photoInfo: PhotoInfo;
  packs: { uomId: string; factor: number; price?: number | null; barcode?: string | null }[];
  /** The unit purchases start in (0214). */
  buyUomId: string | null;
  /** Part numbers, or null when the company has them switched off. */
  partNumbers: PartNo[] | null;
  /** Packs and unit conversion in use (lib/features.ts unitPacksOn), or packs already on this product. */
  unitPacks: boolean;
  /** Stock or a document already counts in the unit (this product or a variant): it cannot change. */
  unitLocked: boolean;
  brands: { id: string; code: string; name: string }[];
  uoms: { id: string; code: string; name: string }[];
  parts: { a: string; o: string }[];
  photo: string | null;
  /** The other variants of the same product, this one included. Empty for a plain item. */
  siblings: { id: string; code: string; name: string; qty: number; parts: string[]; photo: string | null }[];
  /** Today's price per level: the stock unit's, and each pack's by unit id (0236). */
  levels: { id: string; name: string; price: string; packs?: Record<string, string> }[];
  stock: { onHand: number; reserved: number; available: number; avgCost: number | null };
  /** What a unit of the latest receipt cost, landed costs included. Null without cost access. */
  unitCost: number | null;
  seeCost: boolean;
  purchases: { id: string; no: string | null; date: string; supplier: string | null; qty: number; unitCost: number | null }[];
  serials: { id: string; imei: string; status: string; where: string | null }[];
  serialCount: number;
};

const n0 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const n1 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });
const TRACKING: Record<string, string> = { IMEI: "IMEI tracked", SERIAL: "Serial tracked", OPTIONAL: "Optional serial", NONE: "Counted by quantity" };

/** One section: its name and what it is for on the left, its fields across the rest (2026-11-25 layout). */
function Row({ title, sub, children, onChange }: { title: string; sub?: string; children: ReactNode; onChange?: () => void }) {
  return (
    <section className="ie3-row" onChange={onChange}>
      <div className="ie3-label"><h3>{title}</h3>{sub && <p>{sub}</p>}</div>
      <div className="ie3-body">{children}</div>
    </section>
  );
}

/** A value that is shown, not typed: on the line of the fields beside it, dashed. */
function ReadOnly({ label, value, note, mono }: { label: string; value: string; note?: string; mono?: boolean }) {
  return (
    <div className="ie3-field ie3-ro">
      <span>{label}</span>
      <output className={mono ? "mono" : undefined}>{value}</output>
      {note && <small>{note}</small>}
    </div>
  );
}

/**
 * The one editor an item has, a model, a variant or a plain product: after
 * the Astryx preview (2026-11-25), full width, sections as rows, fields as
 * lines; type and spacing carry the hierarchy, black for the action.
 */
export function ItemEditor({ item, action, tracking }: {
  item: EditorItem; action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  /** The product's tracking and warranty fields, saved with the rest. */
  tracking?: ReactNode;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action as never, null);
  useNotice(state);
  const isVariant = !!item.parentId;
  const isModel = item.isModel;
  /** Holds the product's own settings: a model, or an item with no variants. */
  const product = !isVariant;
  // Pack sizes, part numbers and the photo keep their own state; any change to them counts.
  const [touched, setTouched] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const defaultName = isVariant && item.parentName
    ? `${item.parentName} ${item.parts.map((p) => optionLabel(p.a, p.o)).join(" / ")}`.trim() : item.name;

  const start = () => ({
    name: item.name, nameCustom: item.nameCustom, code: item.code, barcode: item.barcode, active: item.isActive, weightKg: item.weightKg,
    nameMy: item.nameMy, brandId: item.brandId, uomId: item.uomId,
    // Keyed "level" for the stock unit, "level|unit" for a pack: one cell of the price grid each.
    prices: Object.fromEntries(item.levels.flatMap((l) => [[l.id, l.price],
      ...item.packs.map((p) => [`${l.id}|${p.uomId}`, l.packs?.[p.uomId] ?? ""])])) as Record<string, string>,
  });
  const [f, setF] = useState(start);
  useEffect(() => { setF(start()); setTouched(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [item]);
  useEffect(() => { if (state && "ok" in state) router.refresh(); }, [state, router]);

  const dirty = touched || JSON.stringify(f) !== JSON.stringify(start());
  const valid = f.name.trim() !== "" && f.code.trim() !== "";
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const touch = () => setTouched(true);

  // Margins against the first price level, from what a unit cost.
  const first = Number(f.prices[item.levels[0]?.id] ?? "");
  const cost = item.unitCost;
  const gp = cost !== null && first > 0 ? first - cost : null;

  const [q, setQ] = useState("");
  const siblings = useMemo(() => item.siblings.filter((s) =>
    !q || `${s.code} ${s.name} ${s.parts.join(" ")}`.toLowerCase().includes(q.toLowerCase())), [item.siblings, q]);
  const units = [{ id: "", code: item.uom, factor: 1 },
    ...[...item.packs].sort((a, b) => a.factor - b.factor)
      .map((p) => ({ id: p.uomId, code: item.uoms.find((u) => u.id === p.uomId)?.code ?? "?", factor: p.factor }))];
  const variantCount = item.siblings.length;

  return (
    <form action={formAction} className="ie3">
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="name" value={f.name} />
      <input type="hidden" name="name_custom" value={f.nameCustom ? "1" : "0"} />
      <input type="hidden" name="code" value={f.code} />
      <input type="hidden" name="barcode" value={f.barcode} />
      {!isModel && <input type="hidden" name="weight_kg" value={f.weightKg} />}
      <input type="hidden" name="is_active" value={f.active ? "1" : "0"} />
      {product && <>
        <input type="hidden" name="name_my" value={f.nameMy} />
        <input type="hidden" name="brand_id" value={f.brandId} />
        <input type="hidden" name="base_uom_id" value={f.uomId} />
        {item.isStocked && <input type="hidden" name="is_stocked" value="on" />}
        <input type="hidden" name="return_to" value={`/items/${item.id}/edit`} />
      </>}

      <header className="ie3-head">
        <div>
          <h1>{f.name || "Untitled"} <span className={`ie3-badge${f.active ? "" : " off"}`}>{f.active ? "Active" : "Inactive"}</span></h1>
          <p>
            {isVariant && item.parentName ? <><Link href={`/items/${item.parentId}/edit`}>{item.parentName}</Link> · </> : null}
            <span className="mono">{item.code}</span> · {item.category}{isModel ? ` · ${variantCount} variants` : ""}
          </p>
        </div>
        <div className="ie3-acts">
          <span className="ie3-dirty" aria-live="polite">{dirty ? "Unsaved changes" : ""}</span>
          <Link className="ie3-btn ghost" href="/products">Back to products</Link>
          <button type="button" className="ie3-btn" disabled={!dirty}
            onClick={() => { setF(start()); setTouched(false); setResetKey((k) => k + 1); }}>Cancel</button>
          <button type="submit" className="ie3-btn primary" disabled={pending || !dirty || !valid}>
            {pending ? "Saving…" : isVariant ? "Save variant" : isModel ? "Save product" : "Save item"}
          </button>
        </div>
      </header>

      {state && "error" in state && <div className="alert" role="alert">{state.error}</div>}

      <Row title={isVariant ? "Variant identity" : isModel ? "Product details" : "Item identity"}
        sub={isModel ? `Brand, unit, packs and status apply to all ${variantCount} variants.` : isVariant ? "This variant's own name, code and barcode." : "What the item is called and how it is found."}>
        <div className="ie3-grid">
          <label className="ie3-field wide">
            <span>{isVariant ? "Full name" : isModel ? "Product name" : "Name"}</span>
            <span className="ie3-name">
              <input value={f.name} maxLength={200}
                onChange={(e) => set({ name: e.target.value, nameCustom: isVariant && e.target.value.trim() !== defaultName })} />
              {isVariant && f.nameCustom && (
                <button type="button" className="ie3-reset" title="Reset to the generated name" aria-label="Reset name"
                  onClick={() => set({ name: defaultName, nameCustom: false })}><RotateCcw size={13} aria-hidden="true" /></button>
              )}
            </span>
          </label>
          {isModel ? <ReadOnly label="Model code" value={item.code} mono /> : (
            <label className="ie3-field">
              <span>{isVariant ? "Variant SKU" : "SKU"}</span>
              <input value={f.code} className="mono" style={{ textTransform: "uppercase" }} onChange={(e) => set({ code: e.target.value })} />
            </label>
          )}
          {isModel ? (
            <label className="ie3-field"><span>Name (Burmese)</span>
              <input value={f.nameMy} placeholder="Optional" onChange={(e) => set({ nameMy: e.target.value })} /></label>
          ) : (
            <label className="ie3-field"><span>Barcode</span>
              <input value={f.barcode} inputMode="numeric" className="mono" placeholder="Scan or type" onChange={(e) => set({ barcode: e.target.value })} /></label>
          )}
          {isVariant
            ? item.parts.map((p) => <ReadOnly key={p.a} label={p.a.charAt(0).toUpperCase() + p.a.slice(1)} value={p.o} />)
            : <>
                {!isModel && (
                  <label className="ie3-field"><span>Name (Burmese)</span>
                    <input value={f.nameMy} placeholder="Optional" onChange={(e) => set({ nameMy: e.target.value })} /></label>
                )}
                <ReadOnly label="Category" value={item.category} />
                <label className="ie3-field"><span>Brand</span>
                  <select value={f.brandId} onChange={(e) => set({ brandId: e.target.value })}>
                    <option value="">None</option>
                    {item.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select></label>
                {item.unitLocked
                  ? <ReadOnly label="Unit" value={item.uoms.find((u) => u.id === f.uomId)?.code ?? item.uom} note="Locked once used" />
                  : (
                    <label className="ie3-field"><span>Unit</span>
                      <select value={f.uomId} onChange={(e) => set({ uomId: e.target.value })}>
                        {item.uoms.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}
                      </select></label>
                  )}
              </>}
          {item.isStocked && (isVariant || !tracking) && <ReadOnly label="Tracking" value={TRACKING[item.identity] ?? item.identity} />}
          {!isModel && (
            <label className="ie3-field">
              <span>Weight (kg) <HelpHint label="About weight">Optional. Used when freight is split by weight: a charge is shared by weight times quantity.</HelpHint></span>
              <input value={f.weightKg} type="number" inputMode="decimal" min="0" step="any" placeholder="e.g. 0.2"
                onChange={(e) => set({ weightKg: e.target.value })} />
            </label>
          )}
          <label className="ie3-field"><span>Status</span>
            <select value={f.active ? "1" : "0"} onChange={(e) => set({ active: e.target.value === "1" })}>
              <option value="1">Active</option><option value="0">Inactive</option>
            </select></label>
        </div>
      </Row>

      {product && item.unitPacks && (
        <Row key={`u${resetKey}`} title="Units and packs" sub={`Each pack holds so many of a smaller unit; stock is kept in ${item.uom}.${isModel ? ` For all ${variantCount} variants.` : ""}`} onChange={touch}>
          <PackSizes uoms={item.uoms} baseUomId={f.uomId} initial={item.packs} spareParts buyUomId={item.buyUomId} priced={false} layout="rows" />
        </Row>
      )}

      {tracking && (
        <Row key={`t${resetKey}`} title="Tracking and warranty" sub={isModel ? `For all ${variantCount} variants.` : "How each unit is told apart, and how long it is covered."} onChange={touch}>
          {tracking}
        </Row>
      )}

      {item.partNumbers && !isModel && (
        <Row key={`n${resetKey}`} title="Part numbers" sub="A part number finds the item when typed, ignoring spaces and dashes." onChange={touch}>
          <PartNumbers initial={item.partNumbers} />
        </Row>
      )}

      <Row key={`p${resetKey}`} title="Photo"
        sub={isModel ? "Every variant's default; a colour can have its own." : isVariant && item.photoInfo.scope ? `${item.photoInfo.scope.option}'s photo, or ${item.photoInfo.modelName}'s when ${item.photoInfo.scope.option} has none.` : "Shown on the till and in search."}>
        <ItemPhotoRow mode={isModel ? "model" : isVariant && item.photoInfo.scope ? "variant" : "plain"}
          shown={isModel ? item.ownPhoto : item.photo} own={item.ownPhoto} info={item.photoInfo} variants={variantCount} onChange={touch} />
      </Row>

      {!isModel && (
        <Row title="Pricing" sub="Read only. Prices are set, dated, in Products › Price levels.">
          <table className="ie3-table">
            <colgroup><col />{item.levels.map((l) => <col key={l.id} style={{ width: 160 }} />)}</colgroup>
            <thead><tr><th>Unit</th>{item.levels.map((l) => <th key={l.id} className="r">{l.name}</th>)}</tr></thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id || "base"}>
                  <td>{u.code}{u.id && <small> · {u.factor.toLocaleString("en-US", { maximumFractionDigits: 4 })} {item.uom}</small>}</td>
                  {item.levels.map((l) => {
                    const v = f.prices[u.id ? `${l.id}|${u.id}` : l.id];
                    return <td key={l.id} className="r">{v !== undefined && v !== "" ? Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }) : <span className="ie3-none">—</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="ie3-hint">Set prices, with their dates and history, in <Link href={`/items/prices?q=${encodeURIComponent(item.code)}`}>Products › Price levels</Link>.</p>
          {item.seeCost && (
            <div className="ie3-kpis">
              <ReadOnly label="Last unit cost" value={cost === null ? "—" : `MMK ${n0(cost)}`} />
              <ReadOnly label={`Gross profit vs ${item.levels[0]?.name ?? "price 1"}`} value={gp === null ? "—" : `MMK ${n0(gp)}`} />
              <ReadOnly label="Margin" value={gp === null ? "—" : `${n1((gp / first) * 100)}%`} />
              <ReadOnly label="Markup" value={gp === null || !cost ? "—" : `${n1((gp / cost) * 100)}%`} />
            </div>
          )}
        </Row>
      )}

      {item.isStocked && !isModel && (
        <Row title={item.tracksSerial ? "Stock, IMEIs and purchases" : "Stock and purchases"} sub="On hand across warehouses, and the latest receipts.">
          <div className="ie3-kpis">
            <ReadOnly label="On hand" value={n0(item.stock.onHand)} />
            <ReadOnly label="Reserved" value={n0(item.stock.reserved)} />
            <ReadOnly label="Available" value={n0(item.stock.available)} />
            {item.seeCost && <ReadOnly label="Avg. cost" value={item.stock.avgCost === null ? "—" : `MMK ${n0(item.stock.avgCost)}`} />}
          </div>
          <p className="ie3-hint"><Link href={`/items/stock?q=${encodeURIComponent(item.code)}`}>View in Stock position</Link>
            {item.tracksSerial && item.serialCount > 0 && <> · <Link href={`/inventory/phones?q=${encodeURIComponent(item.code)}`}>{item.serialCount} IMEIs in IMEI inventory</Link></>}</p>
          {item.tracksSerial && item.serials.length > 0 && (
            <table className="ie3-table">
              <thead><tr><th>IMEI</th><th>Where</th><th>Status</th></tr></thead>
              <tbody>{item.serials.map((s) => (
                <tr key={s.id}><td><Link href={`/imei/${s.id}`} className="mono">{s.imei}</Link></td><td>{s.where ?? "—"}</td>
                  <td>{s.status === "IN_STOCK" ? "On shelf" : s.status.replace(/_/g, " ").toLowerCase()}</td></tr>))}</tbody>
            </table>
          )}
          {item.purchases.length === 0 ? <p className="ie3-hint">No purchases yet: receipts appear here once stock is received.</p> : (
            <table className="ie3-table">
              <thead><tr><th>Date</th><th>Receipt</th><th>Supplier</th><th className="r">Qty</th>{item.seeCost && <th className="r">Unit cost</th>}</tr></thead>
              <tbody>{item.purchases.map((p) => (
                <tr key={p.id}><td>{p.date}</td><td><Link href={`/documents/${p.id}`}>{p.no ?? "—"}</Link></td>
                  <td>{p.supplier ?? "—"}</td><td className="r">{n0(p.qty)}</td>
                  {item.seeCost && <td className="r">{p.unitCost === null ? "—" : n0(p.unitCost)}</td>}</tr>))}</tbody>
            </table>
          )}
        </Row>
      )}

      {(isVariant || isModel) && (
        <Row title={isModel ? "Variants" : "Other variants"} sub="Each is sold, stocked and priced on its own.">
          {variantCount > 6 && (
            <input type="search" className="ie3-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search variants…" aria-label="Search variants" />
          )}
          <table className="ie3-table">
            <thead><tr><th>Variant</th><th>Code</th><th>Options</th><th className="r">Stock</th></tr></thead>
            <tbody>
              {siblings.map((s) => (
                <tr key={s.id} aria-current={s.id === item.id ? "page" : undefined}>
                  <td>
                    <Link href={`/items/${s.id}/edit`} className="ie3-variant">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {s.photo ? <img src={s.photo} alt="" /> : <span className="ie3-vthumb" />}
                      {s.name}
                    </Link>
                  </td>
                  <td className="mono">{s.code}</td><td>{s.parts.join(" · ")}</td><td className="r">{n0(s.qty)}</td>
                </tr>
              ))}
              {siblings.length === 0 && <tr><td colSpan={4} className="ie3-none">No variant matches.</td></tr>}
            </tbody>
          </table>
        </Row>
      )}
    </form>
  );
}

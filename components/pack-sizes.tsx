"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { UOM, unitLabel } from "@/lib/uom-labels";

type Uom = { id: string; code: string; name: string; name_my?: string | null };
type Pack = { key: number; uomId: string; factor: string; price: string; barcode: string };

/**
 * The packs an item is bought and sold in, each holding so many base units.
 *
 * The item's own unit is never one of them — it is what they convert to, its
 * factor is 1 by definition, and offering it would be a second answer to a
 * question already settled. It is excluded from the picker rather than
 * merely rejected on save, so the rule is visible before the mistake.
 *
 * Editing this list cannot disturb a posted document: every line stores the
 * factor it used, so a carton that becomes 20s next year leaves last year's
 * receipts saying 24.
 */
export function PackSizes({
  uoms, baseUomId, initial, spareParts = false, buyUomId = null,
}: {
  /** The unit purchase lines start in (0214); null is the stock unit. */
  buyUomId?: string | null;
  /** A spare-parts shop: a selling price per pack, and the ladder underneath. */
  spareParts?: boolean;
  uoms: Uom[];
  baseUomId: string;
  initial: { uomId: string; factor: number; price?: number | null; barcode?: string | null }[];
}) {
  const pk = useTranslations("packSizes");
  const [packs, setPacks] = useState<Pack[]>(
    initial.map((p, i) => ({ key: i, uomId: p.uomId, factor: String(p.factor), price: p.price == null ? "" : String(p.price), barcode: p.barcode ?? "" })),
  );
  const base = uoms.find((u) => u.id === baseUomId);
  const available = uoms.filter((u) => u.id !== baseUomId);

  const set = (key: number, patch: Partial<Pack>) =>
    setPacks((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const payload = JSON.stringify(
    packs
      .filter((p) => p.uomId && Number(p.factor) > 0)
      .map((p) => ({ uomId: p.uomId, factor: Number(p.factor), price: !spareParts || p.price === "" ? null : Number(p.price),
                     barcode: spareParts ? p.barcode.trim() || null : null })),
  );
  const [buy, setBuy] = useState(buyUomId ?? "");
  const codeOf = (id: string) => uoms.find((u) => u.id === id)?.code ?? "?";

  return (
    <div className="field" style={{ marginTop: "0.6rem" }}>
      <label>{spareParts ? UOM.alt : pk("label")}</label>
      <input type="hidden" name="packs" value={payload} />

      {spareParts && packs.length > 0 ? (
        /* A spare-parts shop: one row a pack, the columns named once. */
        <div className="packgrid" role="table" aria-label={pk("label")}>
          <div className="packgrid-head" role="row">
            <span>{UOM.pack}</span><span>{UOM.factor}</span><span>{UOM.sellsAt}</span><span>{UOM.barcode}</span><span />
          </div>
          {packs.map((p) => (
            <div key={p.key} className="packgrid-row" role="row">
              <select value={p.uomId} onChange={(e) => set(p.key, { uomId: e.target.value })} aria-label="Pack unit">
                <option value="">{pk("chooseUnit")}</option>
                {available.map((u) => <option key={u.id} value={u.id}>{unitLabel(u)}</option>)}
              </select>
              <span className="packgrid-qty">
                <input type="number" min="0" step="any" value={p.factor} onChange={(e) => set(p.key, { factor: e.target.value })}
                       aria-label={pk("perPack")} />
                <span>{base?.code}</span>
              </span>
              <input type="number" min="0" step="any" value={p.price} placeholder={pk("pricePlaceholder")}
                     onChange={(e) => set(p.key, { price: e.target.value })} aria-label={pk("packPrice")} />
              <input value={p.barcode} placeholder="Scan the box" onChange={(e) => set(p.key, { barcode: e.target.value })}
                     aria-label="Pack barcode" />
              <button type="button" className="ghost tiny" onClick={() => setPacks((ps) => ps.filter((x) => x.key !== p.key))}>
                {pk("remove")}
              </button>
            </div>
          ))}
        </div>
      ) : packs.length === 0 ? (
        <span className="hint">
          {pk("onlyBase", { unit: base?.code ?? pk("ownUnit") })}
        </span>
      ) : (
        packs.map((p) => (
          <div key={p.key} className="packrow">
            <select value={p.uomId} onChange={(e) => set(p.key, { uomId: e.target.value })}>
              <option value="">{pk("chooseUnit")}</option>
              {available.map((u) => (
                <option key={u.id} value={u.id}>{u.code} · {u.name}</option>
              ))}
            </select>
            <span className="packrow-eq">{pk("holds")}</span>
            <input
              type="number" min="0" step="any" value={p.factor}
              onChange={(e) => set(p.key, { factor: e.target.value })}
              aria-label={pk("perPack")}
            />
            <span className="packrow-eq">{base?.code ?? pk("units")}</span>
            {spareParts && <>
              <span className="packrow-eq">{pk("sellsAt")}</span>
              <input
                type="number" min="0" step="any" value={p.price} placeholder={pk("pricePlaceholder")}
                onChange={(e) => set(p.key, { price: e.target.value })}
                aria-label={pk("packPrice")}
              />
            </>}
            <button type="button" className="ghost tiny"
                    onClick={() => setPacks((ps) => ps.filter((x) => x.key !== p.key))}>
              {pk("remove")}
            </button>
          </div>
        ))
      )}

      <button
        type="button" className="ghost tiny" style={{ marginTop: "0.4rem" }}
        onClick={() => setPacks((ps) => [...ps, { key: Date.now(), uomId: "", factor: "", price: "", barcode: "" }])}
      >
        {pk("add")}
      </button>
      <span className="hint">
        {pk("hint", { unit: base?.code ?? pk("units") })}
      </span>
      {spareParts && base && (
        <label className="packbuy">
          <span>{UOM.buy}</span>
          <select name="purchase_uom_id" value={buy} onChange={(e) => setBuy(e.target.value)}>
            <option value="">{unitLabel(base)} · {UOM.stockUnit}</option>
            {packs.filter((p) => p.uomId).map((p) => <option key={p.key} value={p.uomId}>{codeOf(p.uomId)} of {p.factor || "?"} {base.code}</option>)}
          </select>
          <span className="hint">အဝယ်များ ဤယူနစ်ဖြင့် စသည် · Purchases start in this unit</span>
        </label>
      )}
      {spareParts && base && (
        <PackLadder base={base.code} baseMy={base.name_my} packs={packs
          .filter((p) => p.uomId && Number(p.factor) > 0)
          .map((p) => ({ code: uoms.find((u) => u.id === p.uomId)?.code ?? "?", my: uoms.find((u) => u.id === p.uomId)?.name_my, factor: Number(p.factor),
                         price: p.price === "" ? null : Number(p.price) }))} />
      )}
    </div>
  );
}

const n4 = (n: number) => Number(n.toFixed(4)).toLocaleString("en-US", { maximumFractionDigits: 4 });

/**
 * The packs as boxes inside boxes, biggest outside: what one carton holds,
 * down to the unit stock is counted in. Each box says how many of the next
 * box it holds and how many stock units that is; a unit smaller than the
 * stock unit (feet on an item counted in metres) sits inside it the same way.
 */
export function PackLadder({ base, baseMy, packs }: {
  base: string;
  /** The stock unit's Myanmar name, shown first. */
  baseMy?: string | null;
  packs: { code: string; my?: string | null; factor: number; price?: number | null }[];
}) {
  if (packs.length === 0) return null;
  const all = [...packs, { code: base, my: baseMy, factor: 1, price: null, isBase: true }]
    .sort((a, b) => b.factor - a.factor) as { code: string; my?: string | null; factor: number; price?: number | null; isBase?: boolean }[];
  const say = (u: { code: string; my?: string | null }) => (u.my ? `${u.my} ${u.code}` : u.code);
  const level = (i: number): ReactNode => {
    const u = all[i], next = all[i + 1];
    return (
      <div className={`ladder-box${u.isBase ? " base" : ""}`}>
        <div className="ladder-head">
          <strong>1 {say(u)}</strong>
          {next && <span>= {n4(u.factor / next.factor)} {say(next)}</span>}
          {!u.isBase && next && !next.isBase && <span className="ladder-base">= {n4(u.factor)} {base}</span>}
          {!u.isBase && !next && <span className="ladder-base">= {n4(u.factor)} {base}</span>}
          {u.isBase && <span className="ladder-tag">{UOM.base}</span>}
          {u.price != null && <span className="ladder-price">{UOM.sellsAt} {n4(u.price)}</span>}
        </div>
        {next && level(i + 1)}
      </div>
    );
  };
  return <div className="ladder" aria-label="Pack sizes, largest first">{level(0)}</div>;
}

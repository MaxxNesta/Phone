"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

type Uom = { id: string; code: string; name: string };
type Pack = { key: number; uomId: string; factor: string; price: string };

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
  uoms, baseUomId, initial, spareParts = false,
}: {
  /** A spare-parts shop: a selling price per pack, and the ladder underneath. */
  spareParts?: boolean;
  uoms: Uom[];
  baseUomId: string;
  initial: { uomId: string; factor: number; price?: number | null }[];
}) {
  const pk = useTranslations("packSizes");
  const [packs, setPacks] = useState<Pack[]>(
    initial.map((p, i) => ({ key: i, uomId: p.uomId, factor: String(p.factor), price: p.price == null ? "" : String(p.price) })),
  );
  const base = uoms.find((u) => u.id === baseUomId);
  const available = uoms.filter((u) => u.id !== baseUomId);

  const set = (key: number, patch: Partial<Pack>) =>
    setPacks((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const payload = JSON.stringify(
    packs
      .filter((p) => p.uomId && Number(p.factor) > 0)
      .map((p) => ({ uomId: p.uomId, factor: Number(p.factor), price: !spareParts || p.price === "" ? null : Number(p.price) })),
  );

  return (
    <div className="field" style={{ marginTop: "0.6rem" }}>
      <label>{pk("label")}</label>
      <input type="hidden" name="packs" value={payload} />

      {packs.length === 0 ? (
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
        onClick={() => setPacks((ps) => [...ps, { key: Date.now(), uomId: "", factor: "", price: "" }])}
      >
        {pk("add")}
      </button>
      <span className="hint">
        {pk("hint", { unit: base?.code ?? pk("units") })}
      </span>
      {spareParts && base && (
        <PackLadder base={base.code} packs={packs
          .filter((p) => p.uomId && Number(p.factor) > 0)
          .map((p) => ({ code: uoms.find((u) => u.id === p.uomId)?.code ?? "?", factor: Number(p.factor),
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
export function PackLadder({ base, packs }: {
  base: string;
  packs: { code: string; factor: number; price?: number | null }[];
}) {
  if (packs.length === 0) return null;
  const all = [...packs, { code: base, factor: 1, price: null, isBase: true }]
    .sort((a, b) => b.factor - a.factor) as { code: string; factor: number; price?: number | null; isBase?: boolean }[];
  const level = (i: number): ReactNode => {
    const u = all[i], next = all[i + 1];
    return (
      <div className={`ladder-box${u.isBase ? " base" : ""}`}>
        <div className="ladder-head">
          <strong>1 {u.code}</strong>
          {next && <span>= {n4(u.factor / next.factor)} {next.code}</span>}
          {!u.isBase && next && !next.isBase && <span className="ladder-base">= {n4(u.factor)} {base}</span>}
          {!u.isBase && !next && <span className="ladder-base">= {n4(u.factor)} {base}</span>}
          {u.isBase && <span className="ladder-tag">stock unit</span>}
          {u.price != null && <span className="ladder-price">sells at {n4(u.price)}</span>}
        </div>
        {next && level(i + 1)}
      </div>
    );
  };
  return <div className="ladder" aria-label="Pack sizes, largest first">{level(0)}</div>;
}

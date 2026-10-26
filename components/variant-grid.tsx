"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions";
import { ItemThumb } from "./item-thumb";
import { VariantTags } from "./variant-tags";
import type { VariantPart } from "@/lib/variants";
import { useTranslations } from "next-intl";
import { RotateCcw } from "lucide-react";
import { optionLabel } from "@/lib/item-code";

export type GridRow = {
  id: string; code: string; name: string;
  /** The name was typed, not generated from the product and its values. */
  nameIsCustom?: boolean;
  /** Other codes for the same physical configuration, e.g. "IW007". */
  twins?: string | null;
  barcode: string | null;
  /** The current price at each level, by level id. */
  prices: Record<string, string | number> | null;
  is_active: boolean; on_hand: string;
  photoSrc: string | null;
  parts: VariantPart[] | null;
};

/**
 * Every size and colour of one product, edited together.
 *
 * A form that does one variant at a time is twelve page loads to put
 * twelve barcodes on a shirt, which is why the barcodes never got entered.
 * This is a grid because the job is a grid.
 *
 * Clashing barcodes are shown while typing, before the save is attempted:
 * the database refuses them anyway, but finding out at the end of twelve
 * rows is finding out too late to remember which scanner slipped.
 */
const priceOf = (r: GridRow, levelId: string) => {
  const p = r.prices?.[levelId];
  return p === undefined || p === null ? "" : String(Number(p));
};

/** The storage option of a variant ("128 GB"), or null for a product with none. */
const storageOf = (r: GridRow) =>
  r.parts?.find((x) => /storage|capacity/i.test(x.attribute))?.option ?? null;

export function VariantGrid({
  action, parentId, rows: initial, levels, uom, productName, activation = false,
}: {
  /** The product is sold sealed and activated: each row says which it is. */
  activation?: boolean;
  /** The product the generated names start with. */
  productName: string;
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  parentId: string;
  rows: GridRow[];
  /** Every price level, a column each — Retail first in a retail shop. */
  levels: { id: string; name: string }[];
  uom: string;
}) {
  const router = useRouter();
  const g = useTranslations("variantGrid");
  const c = useTranslations("common");
  const [state, formAction, pending] =
    useActionState<ActionResult | null, FormData>(action as never, null);

  // The generated name: the product's, then each value — what Reset puts back.
  const defaultName = (r: GridRow) =>
    `${productName} ${(r.parts ?? []).map((x) => optionLabel(x.attribute, x.option)).join(" / ")}`.trim();
  const [rows, setRows] = useState(() => initial.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    nameCustom: !!r.nameIsCustom,
    barcode: r.barcode ?? "",
    prices: Object.fromEntries(levels.map((l) => [l.id, priceOf(r, l.id)])),
    isActive: r.is_active,
  })));

  useEffect(() => { if (state && "ok" in state) router.refresh(); }, [state, router]);

  /* A scanner types the barcode and presses Enter. Enter here moves to the
     next row's barcode instead of submitting, so a shelf of boxes can be
     scanned one after another; the page opens with the cursor in the first
     empty one, ready for the first scan. */
  useEffect(() => {
    const first = [...document.querySelectorAll<HTMLInputElement>("input[data-barcode]")].find((i) => !i.value);
    first?.focus();
  }, []);
  const nextBarcode = (from: HTMLInputElement) => {
    const all = [...document.querySelectorAll<HTMLInputElement>("input[data-barcode]")];
    all[all.indexOf(from) + 1]?.focus();
  };

  const set = (id: string, patch: Partial<(typeof rows)[number]>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  /** Barcodes typed twice in this grid, flagged as they are typed. */
  const clashing = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of rows) {
      const b = r.barcode.trim();
      if (b) count.set(b, (count.get(b) ?? 0) + 1);
    }
    return new Set([...count.entries()].filter(([, n]) => n > 1).map(([b]) => b));
  }, [rows]);

  /** Codes typed twice in this grid. */
  const codeClash = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of rows) {
      const k = r.code.trim().toUpperCase();
      if (k) count.set(k, (count.get(k) ?? 0) + 1);
    }
    return new Set([...count.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [rows]);
  const codeEmpty = rows.some((r) => !r.code.trim());

  const dirty = rows.some((r, i) =>
    r.code.trim().toUpperCase() !== initial[i].code ||
    r.name.trim() !== initial[i].name ||
    r.barcode !== (initial[i].barcode ?? "") ||
    levels.some((l) => r.prices[l.id] !== priceOf(initial[i], l.id)) ||
    r.isActive !== initial[i].is_active);

  const byId = new Map(initial.map((r) => [r.id, r]));

  /* Set prices by storage: one price per level for every variant of a storage
     size, applied to the grid (not saved) so a rare colour can still be
     overridden in its own row before saving. A blank level is left alone. */
  const storages = useMemo(
    () => [...new Set(initial.map(storageOf).filter((x): x is string => !!x))],
    [initial]);
  const [bulk, setBulk] = useState<Record<string, Record<string, string>>>({});
  const bulkSet = (storage: string, levelId: string, v: string) =>
    setBulk((b) => ({ ...b, [storage]: { ...b[storage], [levelId]: v } }));
  const applyStorage = (storage: string) =>
    setRows((rs) => rs.map((r) => {
      if (storageOf(byId.get(r.id)!) !== storage) return r;
      const prices = { ...r.prices };
      for (const l of levels) { const v = bulk[storage]?.[l.id]; if (v) prices[l.id] = v; }
      return { ...r, prices };
    }));

  return (
    <form action={formAction}>
      <input type="hidden" name="parent_id" value={parentId} />
      <input type="hidden" name="rows" value={JSON.stringify(rows)} />

      {state && "error" in state && <div className="alert">{state.error}</div>}
      {state && "ok" in state && !dirty && (
        <div className="page-sub" style={{ color: "var(--ok)", marginBottom: "0.5rem" }}>
          {g("saved")}
        </div>
      )}

      {storages.length > 0 && (
        <div className="tablewrap" style={{ marginBottom: "var(--s3)" }}>
          <table>
            <caption style={{ textAlign: "left", fontWeight: 600, padding: "0 0 6px" }}>
              {g("byStorage")}
              <span className="page-sub" style={{ fontWeight: 400 }}>
                {" "}{g("byStorageNote")}
              </span>
            </caption>
            <thead>
              <tr>
                <th>{g("storage")}</th>
                {levels.map((l) => <th key={l.id} className="r">{g("levelPrice", { level: l.name })}</th>)}
                <th />
              </tr>
            </thead>
            <tbody>
              {storages.map((st) => (
                <tr key={st}>
                  <td>{st} <span className="page-sub">{g("variantCount", { n: initial.filter((r) => storageOf(r) === st).length })}</span></td>
                  {levels.map((l) => (
                    <td key={l.id} className="narrow">
                      <input type="number" min="0" step="any" aria-label={g("priceForAll", { level: l.name, storage: st })}
                        value={bulk[st]?.[l.id] ?? ""} onChange={(e) => bulkSet(st, l.id, e.target.value)} />
                    </td>
                  ))}
                  <td><button type="button" className="ghost" onClick={() => applyStorage(st)}>{g("applyTo", { storage: st })}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th colSpan={2}>{g("variant")}</th>
              <th>{g("variantSku")}</th>
              <th>{c("barcode")}</th>
              {levels.map((l) => (
                <th key={l.id} className="r">
                  {g("levelPrice", { level: l.name })}
                  <div className="subline">{g("per", { unit: uom })}</div>
                </th>
              ))}
              <th className="r">{g("onHand")}</th>
              {activation && <th>Activated</th>}
              <th>{c("active")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const v = byId.get(r.id)!;
              const dup = r.barcode.trim() !== "" && clashing.has(r.barcode.trim());
              return (
                <tr key={r.id}>
                  <td className="vgroup-thumb">
                    <ItemThumb src={v.photoSrc} name={v.name} />
                  </td>
                  <td className="wrap">
                    <span className="pf2-name vg-name">
                      <input type="text" value={r.name} aria-label={`Name of ${v.code}`}
                        className={r.nameCustom ? "custom" : undefined}
                        onChange={(e) => set(r.id, { name: e.target.value, nameCustom: e.target.value.trim() !== defaultName(v) })} />
                      {r.nameCustom && (
                        <button type="button" className="pf2-reset" title="Reset to default name"
                          aria-label={`Reset the name of ${v.code}`}
                          onClick={() => set(r.id, { name: defaultName(v), nameCustom: false })}>
                          <RotateCcw size={12} aria-hidden="true" />
                        </button>
                      )}
                      {v.twins && <span className="pf2-similar kept" title={`Same configuration as ${v.twins}`}>Same as {v.twins}</span>}
                    </span>
                    {/* lib/variants carries the ids for grouping; the tag
                        only needs the two words. */}
                    <VariantTags className="vartags-inline"
                      variant={v.parts?.map((x) => ({ a: x.attribute, o: x.option })) ?? null} />
                    <a href={`/items/${v.id}/edit`} className="vg-open">Edit this variant</a>
                  </td>
                  {/* The shop's own code (IPC010) can be typed here; the generated
                      one stays until somebody does. */}
                  <td className="narrow">
                    <input type="text" aria-label={g("codeFor", { name: v.name })}
                      value={r.code} onChange={(e) => set(r.id, { code: e.target.value })}
                      style={{ textTransform: "uppercase", minWidth: "9rem",
                               ...(codeClash.has(r.code.trim().toUpperCase()) || !r.code.trim()
                                 ? { borderColor: "var(--bad)" } : {}) }} />
                  </td>
                  <td>
                    <input
                      type="text" inputMode="numeric" aria-label={g("barcodeFor", { name: v.name })}
                      value={r.barcode} data-barcode
                      onChange={(e) => set(r.id, { barcode: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); nextBarcode(e.currentTarget); } }}
                      placeholder={g("scanOrType")}
                      style={{ minWidth: "10rem", ...(dup ? { borderColor: "var(--bad)" } : {}) }}
                    />
                    {dup && (
                      <div className="subline" style={{ color: "var(--bad)" }}>
                        {g("alsoOnAnother")}
                      </div>
                    )}
                  </td>
                  {levels.map((l) => (
                    <td key={l.id} className="narrow">
                      <input
                        type="number" min="0" step="any" aria-label={g("priceFor", { level: l.name, name: v.name })}
                        value={r.prices[l.id]}
                        onChange={(e) => set(r.id, { prices: { ...r.prices, [l.id]: e.target.value } })}
                      />
                    </td>
                  ))}
                  <td className="r">{Number(v.on_hand)}</td>
                  {activation && (
                    <td>{v.parts?.some((x) => x.attribute === "Activation")
                      ? <span className="imei-pill ok">On</span> : <span className="imei-pill">Off · Standard</span>}</td>
                  )}
                  <td>
                    <label className="check">
                      <input type="checkbox" checked={r.isActive}
                             onChange={(e) => set(r.id, { isActive: e.target.checked })}
                             aria-label={g("activeFor", { name: v.name })} />
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="ie-bar">
        <a className="ie-btn" href="/items">Back to products</a>
        <button type="submit" className="ie-btn primary" disabled={pending || !dirty || clashing.size > 0 || codeClash.size > 0 || codeEmpty}>
          {pending ? c("saving") : g("save", { n: rows.length })}
        </button>
        {(codeClash.size > 0 || codeEmpty) && (
          <span className="page-sub" style={{ color: "var(--bad)" }}>
            {codeEmpty ? g("codeEmpty") : g("codeClash")}
          </span>
        )}
        {clashing.size > 0 && (
          <span className="page-sub" style={{ color: "var(--bad)" }}>
            {g("barcodeClash")}
          </span>
        )}
        {!dirty && clashing.size === 0 && (
          <span className="page-sub">{g("nothingChanged")}</span>
        )}
      </div>
    </form>
  );
}

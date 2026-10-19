"use client";

import { VariantPicker, type PickerAttribute } from "./variant-picker";
import { PackSizes } from "./pack-sizes";
import { useActionState, useEffect, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions";
import { createBrandInline, type PickerBrand } from "@/lib/actions";
import { ConfirmOtherBrand } from "./brand-form";
import { ItemPhotoField } from "./item-photo-field";
import { composeItemCode } from "@/lib/item-code";
import { itemCodeTakenBy } from "@/lib/item-code-actions";
import { useTranslations } from "next-intl";

type Node = {
  id: string; code: string; segment: string; name: string;
  parent_id: string | null;
  identity?: string;
};

const TRACKING = [
  { v: "IMEI", label: "IMEI", note: "iPhone, cellular iPad and Watch. IMEI 2 and serial kept beside it." },
  { v: "SERIAL", label: "Serial number", note: "Mac, Wi-Fi iPad, AirPods. One serial per unit." },
  { v: "NONE", label: "Quantity only", note: "Cases, cables, chargers. Counted, not named." },
] as const;
type Uom = { id: string; code: string; name: string };

/** What a product of each Apple type is called, as a hint in the name field. */
const NAME_EXAMPLE: Record<string, string> = {
  iphone: "iPhone 18",
  ipad: "iPad Air 11-inch (M3)",
  mac: "MacBook Air 13-inch (M4)",
  "apple watch": "Apple Watch Series 11",
  airpods: "AirPods Pro 3",
};
type Brand = { id: string; code: string; name: string };

// Category depth is capped at two: Category, then Sub category.
const LEVELS = ["levelCategory", "levelSub"] as const;

/**
 * One dropdown per level of the tree. Choosing a category reveals the next
 * dropdown of its children, and the item code assembles from the chain as you
 * go — 01 + 01 + 01 + 001 becomes 010101001.
 */
export function ItemForm({
  action,
  nodes,
  uoms,
  brands,
  returnTo,
  presetGroupId,
  variantAttributes,
  retail,
  canAddBrand,
}: {
  /** Owner only (brands.manage): the shop sells Apple. */
  canAddBrand?: boolean;
  /** Phone retail: nothing expires and nothing is recalled by lot, so the
   *  batch switches are not offered. */
  retail?: boolean;
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  nodes: Node[];
  uoms: Uom[];
  brands: Brand[];
  returnTo: string;
  presetGroupId?: string;
  /** The ways products may vary here. Empty where none are set up, which is
   *  the state every catalogue starts in. */
  variantAttributes?: PickerAttribute[];
}) {
  const f = useTranslations("itemForm");
  const c = useTranslations("common");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never,
    null
  );

  const [tracksBatch, setTracksBatch] = useState(false);
  const [tracksExpiry, setTracksExpiry] = useState(false);
  const [brandList, setBrandList] = useState<Brand[]>(brands);
  // Apple unless chosen otherwise: it is what the shop sells.
  const [brandId, setBrandId] = useState(
    brands.find((b) => b.code === "APPLE" || b.name.toLowerCase() === "apple")?.id ?? "");
  const [askBrand, setAskBrand] = useState(false);
  // Controlled, because the pack sizes below have to exclude whichever
  // unit is currently the base — a box cannot contain boxes.
  const [baseUomId, setBaseUomId] = useState(uoms[0]?.id ?? "");
  const [addingBrand, setAddingBrand] = useState(false);
  const [newBrandName, setNewBrandName] = useState("");
  const [brandError, setBrandError] = useState<string | null>(null);
  const [brandPending, startBrand] = useTransition();

  function addBrand() {
    const name = newBrandName.trim();
    if (!name) return;
    setBrandError(null);
    startBrand(async () => {
      const res = await createBrandInline({ name, confirmed: true });
      setAskBrand(false);
      if (!res.ok) {
        setBrandError(res.error);
        return;
      }
      const created: PickerBrand = res.brand;
      setBrandList((list) => [...list, created].sort((a, b) => a.name.localeCompare(b.name)));
      setBrandId(created.id);
      setAddingBrand(false);
      setNewBrandName("");
    });
  }

  // Ancestry of the preset category, so opening this from inside a category
  // starts with the dropdowns already filled in.
  const initialChain = (): string[] => {
    if (!presetGroupId) return [];
    const out: string[] = [];
    let cur = nodes.find((n) => n.id === presetGroupId);
    while (cur) {
      out.unshift(cur.id);
      const pid: string | null = cur.parent_id;
      cur = pid ? nodes.find((n) => n.id === pid) : undefined;
    }
    return out;
  };

  const [chain, setChain] = useState<string[]>(initialChain);
  const [serial, setSerial] = useState("");
  // Controlled only so the variant preview can name the product it is
  // about to make twelve of.
  const [itemName, setItemName] = useState("");

  const childrenOf = (parentId: string | null) =>
    nodes.filter((n) => n.parent_id === parentId);

  // One select per filled level, plus one more offering the next level down.
  const selects: Array<{ depth: number; options: Node[]; value: string }> = [];
  let parent: string | null = null;
  for (let d = 0; ; d++) {
    const options = childrenOf(parent);
    if (options.length === 0) break;
    const value = chain[d] ?? "";
    selects.push({ depth: d, options, value });
    if (!value) break;
    parent = value;
  }

  const selectedId = chain.length > 0 ? chain[chain.length - 1] : "";
  const selected = nodes.find((n) => n.id === selectedId);
  // The type (top category) says how its products are tracked, until the
  // person filling this in says otherwise for this one product.
  const typeIdentity = nodes.find((n) => n.id === chain[0])?.identity ?? "NONE";
  const [trackOverride, setTrackOverride] = useState<{ root: string; v: string } | null>(null);
  const tracking = trackOverride && trackOverride.root === chain[0] ? trackOverride.v : typeIdentity;
  const groupCode = selected?.code ?? "";
  const preview = groupCode && serial ? composeItemCode(groupCode, serial) : "";

  // Is the code already somebody's? Asked a moment after typing stops, so the
  // answer is on screen before Save, not in an error after it.
  const [takenBy, setTakenBy] = useState<string | null>(null);
  useEffect(() => {
    setTakenBy(null);
    if (!preview) return;
    let stale = false;
    const t = window.setTimeout(() => {
      itemCodeTakenBy(preview).then((n) => { if (!stale) setTakenBy(n); }).catch(() => {});
    }, 300);
    return () => { stale = true; window.clearTimeout(t); };
  }, [preview]);
  // The name field speaks the type's language: an iPad is named as an iPad
  // model, an accessory just by what it is.
  const typeName = nodes.find((n) => n.id === chain[0])?.name ?? "";
  const accessory = /accessor/i.test(typeName);
  const nameLabel = !typeName ? f("model") : accessory ? f("accessoryName") : f("typeModel", { type: typeName });
  const namePlaceholder = accessory ? "20W USB-C Power Adapter"
    : NAME_EXAMPLE[typeName.toLowerCase()] ?? (typeName ? `${typeName} …` : "iPhone 18");

  function pick(depth: number, id: string) {
    // Choosing at one level invalidates everything below it.
    setChain(id ? [...chain.slice(0, depth), id] : chain.slice(0, depth));
  }

  return (
    <form action={formAction} className="form wide">
      {state && "error" in state && <div className="alert">{state.error}</div>}

      <input type="hidden" name="item_group_id" value={selectedId} />
      <input type="hidden" name="brand_id" value={brandId} />
      <input type="hidden" name="return_to" value={returnTo} />

      <div className="card">
        <div className="card-head">
          <h2>{f("whereItBelongs")}</h2>
          <span className="m" style={{ color: "var(--muted)" }}>
            {groupCode ? f("categoryCode", { code: groupCode }) : f("chooseCategory")}
          </span>
        </div>
        <div className="card-body">
          <div className="row">
            {selects.map((s) => (
              <div className="field" key={s.depth}>
                <label htmlFor={`lvl-${s.depth}`}>
                  {LEVELS[s.depth] ? f(LEVELS[s.depth]) : f("level", { n: s.depth + 1 })}
                </label>
                <select
                  id={`lvl-${s.depth}`}
                  value={s.value}
                  onChange={(e) => pick(s.depth, e.target.value)}
                >
                  <option value="">
                    {s.depth === 0 ? f("choose") : f("noneFileHere")}
                  </option>
                  {s.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.segment} · {o.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {selected && (
            <p className="page-sub" style={{ marginTop: "1rem" }}>
              {f("filingInto")}{" "}
              <span className="m">
                {chain
                  .map((id) => nodes.find((n) => n.id === id)?.name)
                  .filter(Boolean)
                  .join(" → ")}
              </span>
            </p>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>{f("theProduct")}</h2>
          {preview && (
            <span className="m" style={{ color: "var(--link)" }}>{f("codeWillBe", { code: preview })}</span>
          )}
        </div>
        <div className="card-body">
          <div className="row">
            <div className="field">
              <label htmlFor="serial">{f("itemCode")}</label>
              <input
                id="serial" name="serial" type="text" required
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                placeholder="001"
                aria-invalid={takenBy ? true : undefined}
                style={takenBy ? { borderColor: "var(--bad)" } : undefined}
              />
              {takenBy ? (
                <span className="hint" role="alert" style={{ color: "var(--bad)" }}>
                  {f("codeTaken", { code: preview, name: takenBy })}
                </span>
              ) : (
                <span className="hint">
                  {groupCode
                    ? f("joinedWithHyphen", { code: groupCode })
                    : f("ownPiece")}
                </span>
              )}
            </div>

            <div className="field">
              <label htmlFor="name">{nameLabel}</label>
              <input id="name" name="name" type="text" required placeholder={namePlaceholder}
                     value={itemName} onChange={(e) => setItemName(e.target.value)} />
            </div>

            <div className="field">
              <label htmlFor="name_my">{f("nameBurmese")}</label>
              <input id="name_my" name="name_my" type="text" />
            </div>

            <div className="field">
              <label htmlFor="brand_select">{c("brand")}</label>
              {addingBrand ? (
                <>
                  <input
                    id="brand_select" type="text" autoFocus
                    value={newBrandName}
                    onChange={(e) => setNewBrandName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (newBrandName.trim()) setAskBrand(true); } }}
                    placeholder="Advics"
                  />
                  <span className="actions" style={{ marginTop: "0.4rem" }}>
                    <button type="button" className="tiny" disabled={brandPending || !newBrandName.trim()} onClick={() => setAskBrand(true)}>
                      {brandPending ? f("saving") : f("add")}
                    </button>
                    <button type="button" className="ghost tiny" onClick={() => { setAddingBrand(false); setBrandError(null); }}>
                      {c("cancel")}
                    </button>
                  </span>
                  {brandError && <span className="hint" style={{ color: "var(--bad)" }}>{brandError}</span>}
                  <ConfirmOtherBrand open={askBrand} name={newBrandName.trim()} busy={brandPending}
                    onCancel={() => setAskBrand(false)} onConfirm={addBrand} />
                </>
              ) : (
                <>
                  <select id="brand_select" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                    <option value="">{f("noneOption")}</option>
                    {brandList.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                  {canAddBrand && (
                    <span className="hint">
                      <button type="button" className="ghost tiny" style={{ padding: 0 }} onClick={() => setAddingBrand(true)}>{f("newBrand")}</button>
                    </span>
                  )}
                </>
              )}
            </div>

            <div className="field">
              <label htmlFor="base_uom_id">{f("baseUnit")}</label>
              <select id="base_uom_id" name="base_uom_id" required value={baseUomId}
                      onChange={(e) => setBaseUomId(e.target.value)}>
                {uoms.map((u) => (
                  <option key={u.id} value={u.id}>{u.code} · {u.name}</option>
                ))}
              </select>
              <span className="hint">{f("baseUnitHint")}</span>
            </div>

            {/* The pack sizes were only on the edit panel, so a new item was
                complete except for the one thing its creator had just been
                told by the supplier — and finding it again meant the list,
                the row menu, and Edit. It belongs where the unit is set. */}
            <PackSizes key={baseUomId} uoms={uoms} baseUomId={baseUomId} initial={[]} />

            <div className="field">
              <label htmlFor="sale_price">{f("defaultRetailPrice")}</label>
              <input id="sale_price" name="sale_price" type="number" min="0" step="any" />
              <span className="hint">{f("defaultRetailPriceHint")}</span>
            </div>

            <ItemPhotoField />
          </div>

          {retail ? <input type="hidden" name="is_stocked" value="on" /> : (
          <label className="check" htmlFor="is_stocked" style={{ marginTop: "1rem" }}>
            <input id="is_stocked" name="is_stocked" type="checkbox" defaultChecked />
            {f("stocked")}
          </label>
          )}

          {/* Its own panel, not two more ticks at the foot of the card.
              Whether an item keeps lots decides what every future receipt of
              it will ask for and whether a recall can name the units — a
              bigger decision than the fields above it, and it was reading as
              the smallest thing on the form. Two switches rather than one: a
              batch is traceability, which plenty of goods need without a
              shelf life, and expiry is the extra perishables need, which has
              to belong to a batch. */}
          <fieldset className="trackbox">
            <legend>{f("traceability")}</legend>

            <div className="field" style={{ marginBottom: "0.75rem" }}>
              <label>{f("trackedBy")}</label>
              <div className="paymodes tracking" role="radiogroup" aria-label={f("trackedBy")}>
                {TRACKING.map((t) => (
                  <button key={t.v} type="button" className="paymode" role="radio"
                    aria-pressed={tracking === t.v} aria-checked={tracking === t.v}
                    onClick={() => setTrackOverride({ root: chain[0] ?? "", v: t.v })}>
                    {f(`tracking.${t.v}.label`)}
                  </button>
                ))}
              </div>
              <input type="hidden" name="identity" value={tracking} />
              <span className="hint">{f(`tracking.${tracking}.note`)}
                {tracking !== "NONE" && ` ${f("trackingEach")}`}</span>
            </div>
            <div className="row" style={{ marginBottom: "0.75rem" }}>
              <div className="field">
                <label htmlFor="warranty_months">{f("customerWarranty")}</label>
                <input id="warranty_months" name="warranty_months" type="number" min="0" max="120" />
                <span className="hint">{f("customerWarrantyHint")}</span>
              </div>
              <div className="field">
                <label htmlFor="supplier_warranty_months">{f("supplierWarranty")}</label>
                <input id="supplier_warranty_months" name="supplier_warranty_months" type="number" min="0" max="120" />
              </div>
            </div>

            {!retail && (<>
            <label className="trackbox-opt" htmlFor="tracks_batch">
              <input
                id="tracks_batch" name="tracks_batch" type="checkbox"
                checked={tracksBatch}
                onChange={(e) => {
                  setTracksBatch(e.target.checked);
                  if (!e.target.checked) setTracksExpiry(false);
                }}
              />
              <span>
                <strong>{f("trackBatches")}</strong>
                <span className="trackbox-note">{f("trackBatchesNote")}</span>
              </span>
            </label>

            <label className={`trackbox-opt sub${tracksBatch ? "" : " off"}`}
                   htmlFor="tracks_expiry">
              <input
                id="tracks_expiry" name="tracks_expiry" type="checkbox"
                checked={tracksExpiry}
                disabled={!tracksBatch}
                onChange={(e) => setTracksExpiry(e.target.checked)}
              />
              <span>
                <strong>{f("batchesExpire")}</strong>
                <span className="trackbox-note">
                  {tracksBatch
                    ? f("batchesExpireOn")
                    : f("batchesExpireOff")}
                </span>
              </span>
            </label>

            {/* Said here because this is where somebody expects to type a
                date and finds only a tick. The date is not the item's: one
                item has many lots, each with its own, so it is asked for per
                batch on the way in — and typed by whoever is holding the
                carton, since nothing derives it. */}
            {tracksBatch && (
              <p className="trackbox-where">
                {tracksExpiry
                  ? f("batchWhereExpiry")
                  : f("batchWhere")}
              </p>
            )}
            </>)}
          </fieldset>

          {/* This form creates; adding variants to a product that already has
              stock and history is a larger question and is not offered here. */}
          <VariantPicker serial={serial} name={itemName}
            attributes={(variantAttributes ?? []).filter((a) => !a.identities || a.identities.includes(tracking))} />
        </div>
      </div>

      <div className="actions">
        <button type="submit" disabled={pending || !selectedId || !serial || !!takenBy}>
          {pending ? f("saving") : preview ? f("saveCode", { code: preview }) : f("saveItem")}
        </button>
        {!selectedId && <span className="page-sub">{f("chooseCategoryFirst")}</span>}
      </div>
    </form>
  );
}

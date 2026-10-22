"use client";

import { VariantPicker, type PickerAttribute } from "./variant-picker";
import { PackSizes } from "./pack-sizes";
import { useActionState, useEffect, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions";
import { createBrandInline, type PickerBrand } from "@/lib/actions";
import { ConfirmOtherBrand } from "./brand-form";
import { ItemPhotoField } from "./item-photo-field";
import { MODEL_CODE, modelItemCode } from "@/lib/item-code";
import { nextModelNumber } from "@/lib/actions";
import { Hash, Sparkles, PenLine, Info, Package, ShieldCheck } from "lucide-react";
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
  // A product that comes in variants is not sold itself: its variants carry the codes.
  const [hasVariants, setHasVariants] = useState(false);
  const [codesReady, setCodesReady] = useState(true);
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

  /* Item code assignment, chosen first. Auto numbers under a model code
     (the category's code unless another is typed) from the next free
     number; manual takes the code as typed — for the product itself, or for
     each variant in the preview. */
  const [codeMode, setCodeMode] = useState<"model" | "manual">("model");
  const [modelCode, setModelCode] = useState("");
  const [manualCode, setManualCode] = useState("");
  const prefix = (modelCode || groupCode).trim().toUpperCase();
  const prefixOk = MODEL_CODE.test(prefix);
  const [nextNo, setNextNo] = useState<number | null>(null);
  useEffect(() => {
    setNextNo(null);
    if (codeMode !== "model" || !prefixOk) return;
    let live = true;
    const t = window.setTimeout(() => {
      nextModelNumber(prefix).then((n) => { if (live) setNextNo(n); }).catch(() => {});
    }, 300);
    return () => { live = false; window.clearTimeout(t); };
  }, [codeMode, prefix, prefixOk]);
  const firstCode = prefixOk && nextNo !== null ? modelItemCode(prefix, nextNo) : "";
  const manualSingle = codeMode === "manual" && !hasVariants;
  const preview = manualSingle ? manualCode.trim().toUpperCase() : "";

  // Is the typed code already somebody's? Asked a moment after typing stops,
  // so the answer is on screen before Save, not in an error after it.
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
  const codeOk = codeMode === "model" ? prefixOk : hasVariants ? codesReady : !!preview;
  const canSave = !pending && !!selectedId && codeOk && !takenBy && (!hasVariants || codesReady);
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
    <form action={formAction} className="form wide pf">
      <input type="hidden" name="item_group_id" value={selectedId} />
      <input type="hidden" name="brand_id" value={brandId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <input type="hidden" name="code_mode" value={codeMode} />
      <input type="hidden" name="model_code" value={codeMode === "model" ? prefix : ""} />
      <input type="hidden" name="serial" value={manualSingle ? preview : ""} />

      {/* Save stays in reach while the form scrolls. */}
      <div className="pf-bar">
        <span className="pf-bar-code">
          {codeMode === "model"
            ? (firstCode ? f("firstCodeWillBe", { code: firstCode }) : f("chooseModelCode"))
            : preview ? f("codeWillBe", { code: preview }) : hasVariants ? f("manualVariantsHint") : f("typeItemCode")}
        </span>
        <button type="submit" disabled={!canSave}>
          {pending ? f("saving") : f("saveProduct")}
        </button>
      </div>
      {state && "error" in state && <div className="alert">{state.error}</div>}

      {/* 1 — how codes are made, first, because everything below is named by it. */}
      <section className="card pf-card pf-accent">
        <div className="pf-head">
          <span className="pf-step">1</span>
          <span className="pf-icon tone-blue"><Hash size={16} aria-hidden="true" /></span>
          <div className="pf-title">
            <h2>{f("codeAssignment")} <span className="pf-badge">{f("required")}</span></h2>
            <p>{f("codeAssignmentSub")}</p>
          </div>
        </div>
        <div className="pf-body">
          <div className="pf-choices" role="radiogroup" aria-label={f("codeAssignment")}>
            {([
              ["model", Sparkles, "autoTitle", "autoDesc", "autoExample"],
              ["manual", PenLine, "manualTitle", "manualDesc", "manualExample"],
            ] as const).map(([mode, Icon, title, desc, ex]) => (
              <button key={mode} type="button" role="radio" aria-checked={codeMode === mode}
                className={`pf-choice${codeMode === mode ? " on" : ""}`} onClick={() => setCodeMode(mode)}>
                <span className="pf-choice-icon"><Icon size={18} aria-hidden="true" /></span>
                <span className="pf-choice-text">
                  <strong>{f(title)}</strong>
                  <span>{f(desc)}</span>
                  <em>{f(ex)}</em>
                </span>
                <span className="pf-radio" aria-hidden="true" />
              </button>
            ))}
          </div>

          {codeMode === "model" ? (
            <div className="pf-split">
              <div className="field">
                <label htmlFor="model_code_input">{f("modelCode")}</label>
                <input id="model_code_input" type="text" value={modelCode} placeholder={groupCode || "IPC"}
                  onChange={(e) => setModelCode(e.target.value)} style={{ textTransform: "uppercase" }}
                  aria-invalid={prefix && !prefixOk ? true : undefined} />
                <span className="hint">
                  {!prefix ? f("chooseModelCode") : !prefixOk ? f("modelCodeChars")
                    : firstCode ? f("firstCodeWillBe", { code: firstCode }) : f("checking")}
                </span>
              </div>
              <div className="pf-info">
                <Info size={15} aria-hidden="true" />
                <span><strong>{f("howItWorks")}</strong> {f("howItWorksBody")}</span>
              </div>
            </div>
          ) : manualSingle ? (
            <div className="pf-split">
              <div className="field">
                <label htmlFor="item_code_input">{f("itemCode")}</label>
                <input id="item_code_input" type="text" value={manualCode} placeholder="ADP01"
                  onChange={(e) => setManualCode(e.target.value)} style={{
                    textTransform: "uppercase", ...(takenBy ? { borderColor: "var(--bad)" } : {}) }}
                  aria-invalid={takenBy ? true : undefined} />
                {takenBy
                  ? <span className="hint" role="alert" style={{ color: "var(--bad)" }}>{f("codeTaken", { code: preview, name: takenBy })}</span>
                  : <span className="hint">{f("itemCodeManualHint")}</span>}
              </div>
              <div className="pf-info">
                <Info size={15} aria-hidden="true" />
                <span>{f("manualVariantsLater")}</span>
              </div>
            </div>
          ) : (
            <div className="pf-info">
              <Info size={15} aria-hidden="true" />
              <span>{f("manualVariantsHint")}</span>
            </div>
          )}
        </div>
      </section>

      {/* 2 — what the product is. */}
      <section className="card pf-card">
        <div className="pf-head">
          <span className="pf-step">2</span>
          <span className="pf-icon tone-orange"><Package size={16} aria-hidden="true" /></span>
          <div className="pf-title">
            <h2>{f("basicInfo")}</h2>
            <p>
              {selected
                ? <>{f("filingInto")} <span className="m">{chain.map((id) => nodes.find((n) => n.id === id)?.name).filter(Boolean).join(" → ")}</span></>
                : f("chooseCategory")}
            </p>
          </div>
        </div>
        <div className="pf-body">
          <div className="row">
            {selects.map((sel) => (
              <div className="field" key={sel.depth}>
                <label htmlFor={`lvl-${sel.depth}`}>
                  {LEVELS[sel.depth] ? f(LEVELS[sel.depth]) : f("level", { n: sel.depth + 1 })}
                </label>
                <select id={`lvl-${sel.depth}`} value={sel.value} onChange={(e) => pick(sel.depth, e.target.value)}>
                  <option value="">{sel.depth === 0 ? f("choose") : f("noneFileHere")}</option>
                  {sel.options.map((o) => (
                    <option key={o.id} value={o.id}>{o.segment} · {o.name}</option>
                  ))}
                </select>
              </div>
            ))}

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

            {/* Pack sizes belong where the unit is set: the supplier has just
                said how many come in a carton. */}
            <PackSizes key={baseUomId} uoms={uoms} baseUomId={baseUomId} initial={[]} />

            <div className="field">
              <label htmlFor="sale_price">{f("defaultRetailPrice")}</label>
              <input id="sale_price" name="sale_price" type="number" min="0" step="any" />
              <span className="hint">{f("defaultRetailPriceHint")}</span>
            </div>

            <ItemPhotoField />
          </div>

          {retail ? <input type="hidden" name="is_stocked" value="on" /> : (
          <label className="check" htmlFor="is_stocked" style={{ marginTop: "0.75rem" }}>
            <input id="is_stocked" name="is_stocked" type="checkbox" defaultChecked />
            {f("stocked")}
          </label>
          )}
        </div>
      </section>

      {/* 3 — how each unit is named and guaranteed. Two batch switches rather
          than one: a batch is traceability, expiry is the extra perishables
          need, and expiry has to belong to a batch. */}
      <section className="card pf-card">
        <div className="pf-head">
          <span className="pf-step">3</span>
          <span className="pf-icon tone-teal"><ShieldCheck size={16} aria-hidden="true" /></span>
          <div className="pf-title">
            <h2>{f("traceability")}</h2>
            <p>{f(`tracking.${tracking}.note`)}{tracking !== "NONE" && ` ${f("trackingEach")}`}</p>
          </div>
        </div>
        <div className="pf-body">
          <div className="row">
            <div className="field">
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
            </div>
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

          <label className={`trackbox-opt sub${tracksBatch ? "" : " off"}`} htmlFor="tracks_expiry">
            <input
              id="tracks_expiry" name="tracks_expiry" type="checkbox"
              checked={tracksExpiry}
              disabled={!tracksBatch}
              onChange={(e) => setTracksExpiry(e.target.checked)}
            />
            <span>
              <strong>{f("batchesExpire")}</strong>
              <span className="trackbox-note">{tracksBatch ? f("batchesExpireOn") : f("batchesExpireOff")}</span>
            </span>
          </label>

          {/* The date is not the item's: one item has many lots, each with
              its own, so it is asked for per batch on the way in. */}
          {tracksBatch && (
            <p className="trackbox-where">{tracksExpiry ? f("batchWhereExpiry") : f("batchWhere")}</p>
          )}
          </>)}
        </div>
      </section>

      {/* 4 and 5 — the variants and what will be created. This form creates;
          adding variants to a product with stock and history is not offered here. */}
      <VariantPicker name={itemName} mode={codeMode} prefix={prefixOk ? prefix : ""} nextNo={nextNo}
        onActive={setHasVariants} onCodesReady={setCodesReady}
        attributes={(variantAttributes ?? []).filter((a) => !a.identities || a.identities.includes(tracking))} />

      <div className="actions">
        <button type="submit" disabled={!canSave}>
          {pending ? f("saving") : f("saveProduct")}
        </button>
        {!selectedId && <span className="page-sub">{f("chooseCategoryFirst")}</span>}
      </div>
    </form>
  );
}

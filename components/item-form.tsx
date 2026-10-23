"use client";

import { useVariantPlan, VariantOptions, VariantPreview, type PickerAttribute } from "./variant-picker";
import { PackSizes } from "./pack-sizes";
import { useActionState, useEffect, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions";
import { createBrandInline, type PickerBrand } from "@/lib/actions";
import { ConfirmOtherBrand } from "./brand-form";
import { ItemPhotoField } from "./item-photo-field";
import { MODEL_CODE, modelItemCode } from "@/lib/item-code";
import { nextModelNumber } from "@/lib/actions";
import Link from "next/link";
import { Sparkles, PenLine, Smartphone, Barcode, Boxes, Plus, Check } from "lucide-react";
import { HelpHint } from "./help-hint";
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
  const [showWarranty, setShowWarranty] = useState(false);
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

  /* Item codes. Auto numbers under a model code (the category's code unless
     another is typed) from the next free number; manual takes the code as
     typed — for the product itself, or for each variant in the preview. */
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

  // Offered for this kind of product and this brand: Memory is the Mac's,
  // RAM is everyone's but Apple's.
  const brand = brandList.find((b) => b.id === brandId);
  const brandCodes = brand ? [brand.code.toUpperCase(), brand.name.toUpperCase()] : [];
  const attributes = (variantAttributes ?? []).filter((a) =>
    (!a.identities || a.identities.includes(tracking)) &&
    !(a.not_for_brands ?? []).some((code) => brandCodes.includes(code.toUpperCase())));
  const plan = useVariantPlan(attributes, hasVariants, codeMode, prefixOk ? prefix : "");

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

  const infoDone = !!selectedId && itemName.trim() !== "" && !!baseUomId;
  const codesDone = codeMode === "model" ? prefixOk : hasVariants ? plan.ready : !!preview && !takenBy;
  const variantsDone = !hasVariants || plan.kept.length > 0;
  const canSave = !pending && infoDone && codesDone && variantsDone && plan.ready;

  // The name field speaks the type's language: an iPad is named as an iPad
  // model, an accessory just by what it is.
  const typeName = nodes.find((n) => n.id === chain[0])?.name ?? "";
  const accessory = /accessor/i.test(typeName);
  const nameLabel = accessory ? "Product name" : typeName ? `${typeName} model` : "Product name";
  const namePlaceholder = accessory ? "20W USB-C Power Adapter"
    : NAME_EXAMPLE[typeName.toLowerCase()] ?? (typeName ? `${typeName} …` : "iPhone 18");

  function pick(depth: number, id: string) {
    // Choosing at one level invalidates everything below it.
    setChain(id ? [...chain.slice(0, depth), id] : chain.slice(0, depth));
  }

  /** Where the person is, at a glance; each step jumps to its section. */
  const steps = [
    { id: "pf-info", label: "Product information", done: infoDone },
    { id: "pf-codes", label: "Item codes", done: codesDone },
    { id: "pf-tracking", label: "Traceability", done: true },
    ...(hasVariants ? [
      { id: "pf-variants", label: "Variants", done: plan.kept.length > 0 },
      { id: "pf-review", label: "Review", done: plan.ready && plan.kept.length > 0 },
    ] : []),
  ];

  const saveButton = (
    <button type="submit" className="pf2-save" disabled={!canSave}>
      {pending ? "Saving…" : hasVariants && plan.kept.length > 0
        ? `Save ${plan.kept.length} ${plan.kept.length === 1 ? "variant" : "variants"}` : "Save product"}
    </button>
  );

  return (
    <form action={formAction} className="form pf2">
      <input type="hidden" name="item_group_id" value={selectedId} />
      <input type="hidden" name="brand_id" value={brandId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <input type="hidden" name="code_mode" value={codeMode} />
      <input type="hidden" name="model_code" value={codeMode === "model" ? prefix : ""} />
      <input type="hidden" name="serial" value={manualSingle ? preview : ""} />
      <input type="hidden" name="identity" value={tracking} />

      {/* Progress first, actions beside it, both in reach while the form scrolls. */}
      <div className="pf2-bar">
        <ol className="pf2-steps">
          {steps.map((s, i) => (
            <li key={s.id} className={s.done ? "done" : undefined}>
              <a href={`#${s.id}`}>
                <span className="dot">{s.done ? <Check size={11} strokeWidth={3} aria-hidden="true" /> : i + 1}</span>
                {s.label}
              </a>
            </li>
          ))}
        </ol>
        <span className="pf2-bar-acts">
          <Link href={returnTo} className="btn ghost">Cancel</Link>
          {saveButton}
        </span>
      </div>
      {state && "error" in state && <div className="alert">{state.error}</div>}

      <div className={`pf2-grid${hasVariants ? " split" : ""}`}>
        <div className="pf2-col">
          {/* 1 — what the product is, and whether it comes in configurations. */}
          <section className="card pf2-card" id="pf-info">
            <div className="pf2-head">
              <span className="pf2-step">1</span>
              <div className="pf2-title">
                <h2>Product information</h2>
                <HelpHint label="About product information">
                  The category decides how the product is filed and tracked; the name is what appears on
                  receipts and in search. Turn on variants when the product comes in configurations — storage,
                  colour, region — that are each stocked and priced on their own.
                </HelpHint>
              </div>
              <label className="pf2-toggle" htmlFor="has_variants">
                <input id="has_variants" type="checkbox" role="switch" checked={hasVariants}
                  onChange={(e) => setHasVariants(e.target.checked)} />
                <span className="track" aria-hidden="true" />
                <span>This product comes in variants</span>
              </label>
            </div>
            <div className="pf2-body pf2-info">
              <ItemPhotoField tile />
              <div className="pf2-fields">
                {selects.map((sel) => (
                  <div className="field" key={sel.depth}>
                    <label htmlFor={`lvl-${sel.depth}`}>{sel.depth === 0 ? "Category" : "Sub category"}<b>*</b></label>
                    <select id={`lvl-${sel.depth}`} value={sel.value} onChange={(e) => pick(sel.depth, e.target.value)}>
                      <option value="">{sel.depth === 0 ? "Choose…" : "— file directly here —"}</option>
                      {sel.options.map((o) => (
                        <option key={o.id} value={o.id}>{o.segment} · {o.name}</option>
                      ))}
                    </select>
                  </div>
                ))}

                <div className="field">
                  <label htmlFor="brand_select">Brand</label>
                  {addingBrand ? (
                    <>
                      <span className="pf2-inline">
                        <input
                          id="brand_select" type="text" autoFocus
                          value={newBrandName}
                          onChange={(e) => setNewBrandName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (newBrandName.trim()) setAskBrand(true); } }}
                          placeholder="Brand name"
                        />
                        <button type="button" className="tiny" disabled={brandPending || !newBrandName.trim()} onClick={() => setAskBrand(true)}>
                          {brandPending ? "Saving…" : "Add"}
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
                    <span className="pf2-inline">
                      <select id="brand_select" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                        <option value="">— none —</option>
                        {brandList.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                      {canAddBrand && (
                        <button type="button" className="ghost tiny" onClick={() => setAddingBrand(true)}>
                          <Plus size={13} aria-hidden="true" /> New brand
                        </button>
                      )}
                    </span>
                  )}
                </div>

                <div className="field">
                  <label htmlFor="name">{nameLabel}</label>
                  <input id="name" name="name" type="text" required placeholder={namePlaceholder}
                         value={itemName} onChange={(e) => setItemName(e.target.value)} />
                </div>

                <div className="field">
                  <label htmlFor="name_my">Name (Burmese)</label>
                  <input id="name_my" name="name_my" type="text" placeholder={itemName || "Optional"} />
                </div>

                <div className="field">
                  <label htmlFor="base_uom_id">Base unit
                    <HelpHint label="About the base unit">Stock is always counted in this unit, and it cannot be changed once the product is saved.</HelpHint>
                  </label>
                  <select id="base_uom_id" name="base_uom_id" required value={baseUomId}
                          onChange={(e) => setBaseUomId(e.target.value)}>
                    {uoms.map((u) => (
                      <option key={u.id} value={u.id}>{u.code} · {u.name}</option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="sale_price">Default retail price
                    <HelpHint label="About the default price">Optional. With variants, they all start at this price; set each one's own price after saving.</HelpHint>
                  </label>
                  <span className="pf2-money">
                    <span>MMK</span>
                    <input id="sale_price" name="sale_price" type="number" min="0" step="any" placeholder="0" />
                  </span>
                </div>

                <div className="pf2-wide">
                  <PackSizes key={baseUomId} uoms={uoms} baseUomId={baseUomId} initial={[]} />
                </div>

                {retail ? <input type="hidden" name="is_stocked" value="on" /> : (
                  <label className="check pf2-wide" htmlFor="is_stocked">
                    <input id="is_stocked" name="is_stocked" type="checkbox" defaultChecked />
                    {f("stocked")}
                  </label>
                )}
              </div>
            </div>
          </section>

          {/* 2 — how codes are made. */}
          <section className="card pf2-card" id="pf-codes">
            <div className="pf2-head">
              <span className="pf2-step">2</span>
              <div className="pf2-title">
                <h2>Item code assignment</h2>
                <HelpHint label="About item codes">
                  {hasVariants
                    ? "Each variant gets its own item code. Auto numbers them under one model code from the next free number; manual lets you type each one, for example to keep the codes you used before."
                    : "Auto gives the product the next free number under a model code; manual keeps exactly the code you type."}
                </HelpHint>
              </div>
            </div>
            <div className="pf2-body">
              <div className="pf2-seg" role="radiogroup" aria-label="Item code assignment">
                {([
                  ["model", Sparkles, "Auto-assign codes", hasVariants ? "One model code; every variant numbered from the next free number." : "The next free number under a model code."],
                  ["manual", PenLine, "Assign manually", hasVariants ? "Type a unique item code for each variant." : "Type the item code yourself."],
                ] as const).map(([mode, Icon, title, desc]) => (
                  <button key={mode} type="button" role="radio" aria-checked={codeMode === mode}
                    className={`pf2-option${codeMode === mode ? " on" : ""}`} onClick={() => setCodeMode(mode)}>
                    <span className="pf2-radio" aria-hidden="true" />
                    <Icon size={17} aria-hidden="true" />
                    <span className="txt"><strong>{title}</strong><span>{desc}</span></span>
                  </button>
                ))}
              </div>

              {codeMode === "model" ? (
                <div className="field pf2-codefield">
                  <label htmlFor="model_code_input">Model code<b>*</b>
                    <HelpHint label="How auto codes work">
                      Type a short model code, such as VT. The {hasVariants ? "variants are" : "product is"} numbered
                      under it from the next number nobody has used: VT001, VT002… The numbers are taken again when you
                      save, so two people saving at once never share one.
                    </HelpHint>
                  </label>
                  <input id="model_code_input" type="text" value={modelCode} placeholder={groupCode || "IPC"}
                    onChange={(e) => setModelCode(e.target.value)} style={{ textTransform: "uppercase" }}
                    aria-invalid={prefix && !prefixOk ? true : undefined} />
                  <span className="hint">
                    {!prefix ? "Type a model code, e.g. VT." : !prefixOk ? "Letters and digits only."
                      : firstCode ? <>First code will be <strong>{firstCode}</strong></> : "Checking the next number…"}
                  </span>
                </div>
              ) : manualSingle ? (
                <div className="field pf2-codefield">
                  <label htmlFor="item_code_input">Item code<b>*</b>
                    <HelpHint label="About manual codes">The whole code, kept exactly as typed — no category prefix is added.</HelpHint>
                  </label>
                  <input id="item_code_input" type="text" value={manualCode} placeholder="ADP01"
                    onChange={(e) => setManualCode(e.target.value)} style={{
                      textTransform: "uppercase", ...(takenBy ? { borderColor: "var(--bad)" } : {}) }}
                    aria-invalid={takenBy ? true : undefined} />
                  {takenBy
                    ? <span className="hint" role="alert" style={{ color: "var(--bad)" }}>{preview} is already used by {takenBy}.</span>
                    : <span className="hint">Kept exactly as typed.</span>}
                </div>
              ) : (
                <p className="hint pf2-note">Type each variant's code in the Variant preview.</p>
              )}
            </div>
          </section>

          {/* 3 — how stock is tracked: a separate question from whether it has variants. */}
          <section className="card pf2-card" id="pf-tracking">
            <div className="pf2-head">
              <span className="pf2-step">3</span>
              <div className="pf2-title">
                <h2>Traceability</h2>
                <HelpHint label="About traceability">
                  How each unit is told apart in stock. IMEI and serial number name every unit, so a sale,
                  a return or a warranty claim points at one phone; quantity only counts them.
                </HelpHint>
              </div>
              {!showWarranty && (
                <button type="button" className="pf2-link" onClick={() => setShowWarranty(true)}>
                  <Plus size={13} aria-hidden="true" /> Add warranty
                </button>
              )}
            </div>
            <div className="pf2-body">
              <div className="pf2-seg three" role="radiogroup" aria-label="Tracked by">
                {TRACKING.map((t) => {
                  const Icon = t.v === "IMEI" ? Smartphone : t.v === "SERIAL" ? Barcode : Boxes;
                  return (
                    <button key={t.v} type="button" role="radio" aria-checked={tracking === t.v}
                      className={`pf2-option${tracking === t.v ? " on" : ""}`}
                      onClick={() => setTrackOverride({ root: chain[0] ?? "", v: t.v })}>
                      <span className="pf2-radio" aria-hidden="true" />
                      <Icon size={17} aria-hidden="true" />
                      <span className="txt"><strong>{t.label}</strong><span>{t.v === "IMEI" ? "Each unit has an IMEI" : t.v === "SERIAL" ? "Each unit has a serial" : "Counted, not named"}</span></span>
                    </button>
                  );
                })}
              </div>

              {showWarranty && (
                <div className="pf2-fields" style={{ marginTop: 10 }}>
                  <div className="field">
                    <label htmlFor="warranty_months">Customer warranty (months)
                      <HelpHint label="About customer warranty">Copied onto each sale; leave blank for none.</HelpHint>
                    </label>
                    <input id="warranty_months" name="warranty_months" type="number" min="0" max="120" />
                  </div>
                  <div className="field">
                    <label htmlFor="supplier_warranty_months">Supplier warranty (months)</label>
                    <input id="supplier_warranty_months" name="supplier_warranty_months" type="number" min="0" max="120" />
                  </div>
                </div>
              )}

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
                  <span><strong>{f("trackBatches")}</strong></span>
                </label>
                <label className={`trackbox-opt sub${tracksBatch ? "" : " off"}`} htmlFor="tracks_expiry">
                  <input
                    id="tracks_expiry" name="tracks_expiry" type="checkbox"
                    checked={tracksExpiry}
                    disabled={!tracksBatch}
                    onChange={(e) => setTracksExpiry(e.target.checked)}
                  />
                  <span><strong>{f("batchesExpire")}</strong></span>
                </label>
              </>)}
            </div>
          </section>

          {/* 4 — the configurations, picked as values. */}
          {hasVariants && (
            <section className="card pf2-card" id="pf-variants">
              <div className="pf2-head">
                <span className="pf2-step">4</span>
                <div className="pf2-title">
                  <h2>Variants</h2>
                  <HelpHint label="About variants">
                    Pick the values this product comes in. Every combination becomes its own stocked item with its
                    own code, price and barcode; drop any combination you do not sell in the preview.
                  </HelpHint>
                </div>
              </div>
              <div className="pf2-body">
                <VariantOptions attributes={attributes} v={plan} />
              </div>
            </section>
          )}
        </div>

        {/* 5 — what will be created, beside the form while it is filled in. */}
        {hasVariants && (
          <div className="pf2-side">
            <VariantPreview v={plan} mode={codeMode} prefix={prefixOk ? prefix : ""} nextNo={nextNo} name={itemName} />
          </div>
        )}
      </div>
    </form>
  );
}

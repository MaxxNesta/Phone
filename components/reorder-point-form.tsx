"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/lib/actions";

/** A model and the variants on its shelves; a plain item has none. */
type Model = { id: string; name: string; category: string; variants: { id: string; parts: { a: string; o: string }[] }[] };
type Location = { id: string; code: string; name: string };

/**
 * "+ Reorder point" and the dialog it opens. A small form asked in place,
 * rather than one that unfolds into the page and pushes the stock list down.
 * Closes itself once the point is saved: the page comes back with one more.
 */
export function AddReorderPointForm({
  action,
  items,
  locations,
  count,
}: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  items: Model[];
  locations: Location[];
  /** Reorder points already set: when it changes, the save went through. */
  count: number;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never,
    null
  );
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const nothingToChooseFrom = items.length === 0 || locations.length === 0;

  // Model, then each option in turn — storage, colour, SIM — offering only
  // what that model actually comes in, down to the one variant.
  const categories = [...new Set(items.map((m) => m.category))].sort();
  const [category, setCategory] = useState(categories[0] ?? "");
  const models = items.filter((m) => m.category === category);
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const model = models.find((m) => m.id === modelId);
  const attrs = model ? [...new Set(model.variants.flatMap((v) => v.parts.map((p) => p.a)))] : [];
  const matching = (upTo: number) => (model?.variants ?? []).filter((v) =>
    attrs.slice(0, upTo).every((a) => !picked[a] || v.parts.some((p) => p.a === a && p.o === picked[a])));
  const variant = model && model.variants.length > 0
    ? (() => { const m = matching(attrs.length); return m.length === 1 ? m[0] : null; })()
    : null;
  const itemId = model ? (model.variants.length === 0 ? model.id : variant?.id ?? "") : "";

  useEffect(() => { setOpen(false); }, [count]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)} disabled={nothingToChooseFrom}
        title={nothingToChooseFrom ? "Needs at least one stocked item and one warehouse" : undefined}>
        + Reorder point
      </button>
      <dialog ref={ref} className="confirm sheetish"
        onCancel={(e) => { e.preventDefault(); setOpen(false); }}
        onClick={(e) => { if (e.target === ref.current) setOpen(false); }}>
        <form action={formAction} className="confirm-panel">
          <h2 className="confirm-title">New reorder point</h2>
          <p className="confirm-detail">Flag an item at a warehouse once its stock drops below this.</p>
          {state && "error" in state && <div className="alert" style={{ marginTop: 10 }}>{state.error}</div>}

          <div className="sheet-fields">
            <input type="hidden" name="item_id" value={itemId} />
            <div className="sheet-row">
              <div className="field">
                <label htmlFor="rp-cat">Category</label>
                <select id="rp-cat" value={category} onChange={(e) => {
                  setCategory(e.target.value);
                  setModelId(items.find((m) => m.category === e.target.value)?.id ?? "");
                  setPicked({});
                }}>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="rp-item">{category ? `${category} model` : "Model"}</label>
                <select id="rp-item" value={modelId} onChange={(e) => { setModelId(e.target.value); setPicked({}); }}>
                  {models.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
            </div>
            {attrs.length > 0 && (
              <div className="sheet-row">
                {attrs.map((a, n) => {
                  const opts = [...new Set(matching(n).flatMap((v) => v.parts.filter((p) => p.a === a).map((p) => p.o)))];
                  return (
                    <div className="field" key={a}>
                      <label htmlFor={`rp-${a}`}>{a}</label>
                      <select id={`rp-${a}`} value={picked[a] ?? ""}
                        onChange={(e) => {
                          // A change here may rule out what is chosen after it.
                          const next: Record<string, string> = {};
                          for (const x of attrs.slice(0, n)) if (picked[x]) next[x] = picked[x];
                          if (e.target.value) next[a] = e.target.value;
                          setPicked(next);
                        }}>
                        <option value="">Choose…</option>
                        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
            {locations.length === 1 ? (
              <input type="hidden" name="location_id" value={locations[0].id} />
            ) : (
              <div className="field">
                <label htmlFor="rp-loc">Warehouse</label>
                <select id="rp-loc" name="location_id" required>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            )}
            <div className="field">
              <label htmlFor="rp-min">Reorder point</label>
              <input id="rp-min" name="min_qty" type="number" min="0" step="any" required placeholder="2" />
            </div>
          </div>

          <div className="confirm-actions">
            <button type="button" className="ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" disabled={pending || !itemId}>{pending ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

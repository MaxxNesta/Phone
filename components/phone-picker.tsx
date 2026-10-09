"use client";

import { useMemo, useState } from "react";
import type { CatalogModel } from "@/lib/queries";

export type VariantCatalog = {
  brands: { id: string; name: string }[];
  types: { id: string; name: string }[];
  models: CatalogModel[];
};

/**
 * A product picked the way it is sold: category (iPhone, iPad, Mac…), brand
 * when the category carries more than one, model,
 * then one choice per attribute the model varies by — Storage, Colour, SIM
 * for an iPhone; Chip, Memory, Storage for a Mac. Each list offers only what
 * some variant of the model carries, and the last choice names the item. All
 * of it is master data: types are the top categories, and the option lists
 * are kept under Settings > Catalogue.
 */
export function PhonePicker({ catalog, value, onPick }: {
  catalog: VariantCatalog;
  /** The item currently on the line, so an existing line opens on it. */
  value: string;
  onPick: (itemId: string) => void;
}) {
  // Where the current item sits in the catalogue, to start from it.
  const start = useMemo(() => {
    for (const m of catalog.models) {
      const v = m.variants.find((x) => x.itemId === value);
      if (v) return { type: m.typeId, model: m.id, opts: v.opts };
    }
    return { type: "", model: "", opts: {} as Record<string, string> };
  }, [catalog, value]);

  const [type, setType] = useState(start.type);
  const [brandId, setBrandId] = useState(
    catalog.models.find((m) => m.id === start.model)?.brandId ?? "");
  const [modelId, setModelId] = useState(start.model);
  const [opts, setOpts] = useState<Record<string, string>>(start.opts);

  const typesInUse = catalog.types.filter((t) => catalog.models.some((m) => m.typeId === t.id));
  const ofType = catalog.models.filter((m) => m.typeId === type);
  // Brand is a step only when this category carries more than one.
  const brandsHere = catalog.brands.filter((b) => ofType.some((m) => m.brandId === b.id));
  const askBrand = brandsHere.length > 1;
  const models = askBrand && brandId ? ofType.filter((m) => m.brandId === brandId) : ofType;
  const model = catalog.models.find((m) => m.id === modelId);

  // Options still possible given the choices made before this attribute.
  const optionsFor = (attrIdx: number) => {
    if (!model) return [];
    const a = model.attrs[attrIdx];
    const earlier = model.attrs.slice(0, attrIdx);
    const fits = model.variants.filter((v) => earlier.every((e) => !opts[e.id] || v.opts[e.id] === opts[e.id]));
    return a.options.filter((o) => fits.some((v) => v.opts[a.id] === o.id));
  };

  const resolve = (m: CatalogModel | undefined, chosen: Record<string, string>) => {
    if (!m) return;
    const hit = m.variants.find((v) => m.attrs.every((a) => v.opts[a.id] === chosen[a.id]));
    if (hit) onPick(hit.itemId);
  };

  const chooseModel = (id: string) => {
    setModelId(id);
    const m = catalog.models.find((x) => x.id === id);
    // One option left for an attribute is not a question.
    const auto: Record<string, string> = {};
    m?.attrs.forEach((a) => {
      const left = a.options.filter((o) => m.variants.some((v) =>
        v.opts[a.id] === o.id && Object.entries(auto).every(([k, val]) => v.opts[k] === val)));
      if (left.length === 1) auto[a.id] = left[0].id;
    });
    setOpts(auto);
    resolve(m, auto);
  };

  const chooseOpt = (attrIdx: number, optId: string) => {
    if (!model) return;
    const next: Record<string, string> = {};
    model.attrs.forEach((a, i) => {
      if (i < attrIdx) next[a.id] = opts[a.id];
      else if (i === attrIdx) next[a.id] = optId;
    });
    // Later choices that no longer fit are cleared; one left is taken.
    model.attrs.slice(attrIdx + 1).forEach((a) => {
      const left = a.options.filter((o) => model.variants.some((v) =>
        v.opts[a.id] === o.id && Object.entries(next).every(([k, val]) => !val || v.opts[k] === val)));
      if (opts[a.id] && left.some((o) => o.id === opts[a.id])) next[a.id] = opts[a.id];
      else if (left.length === 1) next[a.id] = left[0].id;
    });
    setOpts(next);
    resolve(model, next);
  };

  // One row per step, its choices as cells to click. A row appears once the
  // step before it is answered, so the table grows as the item narrows.
  const cell = (key: string, label: string, on: boolean, pick: () => void) => (
    <button key={key} type="button" className="cgrid-opt" aria-pressed={on} onClick={pick}>{label}</button>
  );
  return (
    <table className="cgrid">
      <tbody>
        <tr>
          <th scope="row">Category</th>
          <td><div className="cgrid-opts">
            {typesInUse.map((t) => cell(t.id, t.name, type === t.id,
              () => { setType(t.id); setBrandId(""); setModelId(""); setOpts({}); }))}
          </div></td>
        </tr>
        {type && askBrand && (
          <tr>
            <th scope="row">Brand</th>
            <td><div className="cgrid-opts">
              {brandsHere.map((b) => cell(b.id, b.name, brandId === b.id,
                () => { setBrandId(b.id); setModelId(""); setOpts({}); }))}
            </div></td>
          </tr>
        )}
        {type && (!askBrand || brandId) && (
          <tr>
            <th scope="row">Model</th>
            <td><div className="cgrid-opts">
              {models.map((m) => cell(m.id, m.name, modelId === m.id, () => chooseModel(m.id)))}
              {models.length === 0 && <span className="page-sub">Nothing in this category yet.</span>}
            </div></td>
          </tr>
        )}
        {model?.attrs.map((a, i) => model.attrs.slice(0, i).every((e) => opts[e.id]) && (
          <tr key={a.id}>
            <th scope="row">{a.name}</th>
            <td><div className="cgrid-opts">
              {optionsFor(i).map((o) => cell(o.id, o.name, opts[a.id] === o.id, () => chooseOpt(i, o.id)))}
            </div></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

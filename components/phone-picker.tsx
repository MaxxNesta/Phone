"use client";

import { useMemo, useState } from "react";
import type { CatalogModel } from "@/lib/queries";

export type VariantCatalog = {
  brands: { id: string; name: string }[];
  types: { id: string; name: string }[];
  models: CatalogModel[];
};

/**
 * A product picked the way it is sold: type (iPhone, iPad, Mac…), model,
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
  const [modelId, setModelId] = useState(start.model);
  const [opts, setOpts] = useState<Record<string, string>>(start.opts);

  const typesInUse = catalog.types.filter((t) => catalog.models.some((m) => m.typeId === t.id));
  const models = catalog.models.filter((m) => m.typeId === type);
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

  return (
    <div className="vpick">
      <label className="vpick-field">
        <span>Type</span>
        <select value={type} onChange={(e) => { setType(e.target.value); setModelId(""); setOpts({}); }}>
          <option value="">Choose…</option>
          {typesInUse.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label className="vpick-field">
        <span>Model</span>
        <select value={modelId} disabled={!type} onChange={(e) => chooseModel(e.target.value)}>
          <option value="">{type ? "Choose…" : "Type first"}</option>
          {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
      {model?.attrs.map((a, i) => {
        const ready = model.attrs.slice(0, i).every((e) => opts[e.id]);
        return (
          <label className="vpick-field" key={a.id}>
            <span>{a.name}</span>
            <select value={opts[a.id] ?? ""} disabled={!ready} onChange={(e) => chooseOpt(i, e.target.value)}>
              <option value="">Choose…</option>
              {optionsFor(i).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        );
      })}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Layers, ListChecks, CheckCircle2, AlertCircle, Wand2 } from "lucide-react";
import { modelItemCode } from "@/lib/item-code";

export type PickerAttribute = {
  id: string; code: string; name: string;
  /** The product identities it is offered for — Memory is for Macs. Null is all. */
  identities?: string[] | null;
  options: { id: string; code: string; name: string }[];
};

/**
 * Turning one product into the things that sit on a shelf: the Variants card
 * (which attributes and values) and the Variant preview card (what will be
 * created, under which codes).
 *
 * Off by default and silent when off, because most of a trading catalogue
 * has no variants. Ticking Black, White, S, M and L describes six
 * combinations, and a shop that stocks Black in all three sizes but White
 * only in M sells four of them, so each combination can be dropped in the
 * preview — the grid is the starting point, not the answer.
 *
 * How codes are given is chosen at the top of the form (`mode`): numbered
 * under a model code, shown here as they will be assigned, or typed for each
 * variant in the preview. What this produces is a plan, not the items — the
 * server builds those, so a form replayed cannot make two sets.
 */
export function VariantPicker({
  attributes, name = "", mode, prefix, nextNo, onActive, onCodesReady,
}: {
  attributes: PickerAttribute[];
  name?: string;
  /** From the form's Item code assignment. */
  mode: "model" | "manual";
  /** The model code, upper-cased, and the first free number under it. */
  prefix: string;
  nextNo: number | null;
  /** Told when variants are switched on or off. */
  onActive?: (on: boolean) => void;
  /** Told whether every variant has a usable code, so Save can wait. */
  onCodesReady?: (ready: boolean) => void;
}) {
  const v = useTranslations("variantPicker");
  const [on, setOn] = useState(false);
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  /** Combinations offered but not sold, by key. Exclusions rather than
   *  inclusions, so ticking another colour adds its combinations already on. */
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [start, setStart] = useState("");

  const toggleAttribute = (id: string) =>
    setChosen((c) => {
      const next = { ...c };
      if (id in next) delete next[id]; else next[id] = [];
      return next;
    });

  const toggleOption = (attrId: string, optId: string) =>
    setChosen((c) => {
      const have = c[attrId] ?? [];
      return { ...c, [attrId]: have.includes(optId) ? have.filter((x) => x !== optId) : [...have, optId] };
    });

  // Only attributes with something ticked count: one with none would multiply
  // the combinations by zero.
  const plan = useMemo(
    () => attributes
      .filter((a) => (chosen[a.id]?.length ?? 0) > 0)
      .map((a) => ({ attributeId: a.id, optionIds: chosen[a.id]! })),
    [attributes, chosen],
  );

  /** Every combination, in the order the attributes are declared, so a shirt
   *  is "M / Red" and never "Red / M". */
  const combos = useMemo(() => {
    if (plan.length === 0) return [];
    let rows: { id: string; code: string; label: string }[][] = [[]];
    for (const p of plan) {
      const attr = attributes.find((a) => a.id === p.attributeId)!;
      const opts = attr.options.filter((o) => p.optionIds.includes(o.id));
      rows = rows.flatMap((c) => opts.map((o) => [...c, { id: o.id, code: o.code, label: o.name }]));
    }
    return rows.map((parts) => ({
      key: parts.map((p) => p.id).join("|"),
      optionIds: parts.map((p) => p.id),
      label: parts.map((p) => p.label).join(" / "),
    }));
  }, [plan, attributes]);

  const kept = combos.filter((c) => !dropped.has(c.key));
  const toggleCombo = (key: string) =>
    setDropped((d) => {
      const next = new Set(d);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const typed = (key: string) => (codes[key] ?? "").trim().toUpperCase();
  const codeAt = (i: number) =>
    prefix && nextNo !== null ? modelItemCode(prefix, nextNo + i) : prefix ? `${prefix}…` : "…";

  /** Codes typed twice in this list, flagged as they are typed. */
  const twice = useMemo(() => {
    const n = new Map<string, number>();
    for (const c of kept) { const t = typed(c.key); if (t) n.set(t, (n.get(t) ?? 0) + 1); }
    return new Set([...n].filter(([, k]) => k > 1).map(([t]) => t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kept, codes]);
  const missing = mode === "manual" ? kept.filter((c) => !typed(c.key)).length : 0;
  const ready = !on || kept.length === 0 || (mode === "model" ? !!prefix : missing === 0 && twice.size === 0);
  useEffect(() => { onCodesReady?.(ready); }, [ready, onCodesReady]);

  /** IPC010 down the list: IPC010, IPC011, IPC012… keeping the zeros. */
  const fillDown = () => {
    const m = start.trim().toUpperCase().match(/^(.*?)(\d+)$/);
    if (!m) return;
    const [, p, digits] = m;
    setCodes((cur) => {
      const next = { ...cur };
      kept.forEach((c, i) => { next[c.key] = p + String(Number(digits) + i).padStart(digits.length, "0"); });
      return next;
    });
  };

  /**
   * What the server is asked to build. The attributes travel apart from the
   * combinations: they are what the product varies by, recorded even for a
   * combination nobody stocks, while the combinations are the items to make.
   */
  const payload = useMemo(() => JSON.stringify({
    attributes: plan.map((p) => p.attributeId),
    combos: kept.map((c) => c.optionIds),
    ...(mode === "manual" ? { codes: kept.map((c) => typed(c.key)) } : { modelCode: prefix }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [plan, kept, mode, codes, prefix]);

  if (attributes.length === 0) {
    return <p className="hint" style={{ marginTop: "1rem" }}>{v("noAttributes")}</p>;
  }

  return (
    <>
      <section className="card pf-card">
        <div className="pf-head">
          <span className="pf-step">4</span>
          <span className="pf-icon tone-violet"><Layers size={16} aria-hidden="true" /></span>
          <div className="pf-title">
            <h2>{v("variantsTitle")}</h2>
            <p>{v("variantsSub")}</p>
          </div>
          <label className="pf-switch" htmlFor="has_variants">
            <input id="has_variants" type="checkbox" checked={on}
              onChange={(e) => {
                setOn(e.target.checked);
                onActive?.(e.target.checked);
                if (!e.target.checked) { setChosen({}); setDropped(new Set()); }
              }} />
            <span>{v("comesInVariants")}</span>
          </label>
        </div>
        {on && (
          <div className="pf-body">
            <input type="hidden" name="variant_plan" value={payload} />
            <div className="pf-attrs">
              {attributes.map((a) => {
                const picked = chosen[a.id];
                return (
                  <div key={a.id} className={`pf-attr${a.id in chosen ? " on" : ""}`}>
                    <label className="check">
                      <input type="checkbox" checked={a.id in chosen} onChange={() => toggleAttribute(a.id)} />
                      <strong>{a.name}</strong>
                    </label>
                    {a.id in chosen && (
                      <div className="varpick-opts">
                        {a.options.length === 0
                          ? <span className="hint">{v("noValues", { name: a.name })}</span>
                          : a.options.map((o) => (
                            <label key={o.id} className={`varchip${picked?.includes(o.id) ? " on" : ""}`}>
                              <input type="checkbox" checked={picked?.includes(o.id) ?? false}
                                onChange={() => toggleOption(a.id, o.id)} />
                              {o.name}
                            </label>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {on && combos.length > 0 && (
        <section className="card pf-card">
          <div className="pf-head">
            <span className="pf-step">5</span>
            <span className="pf-icon tone-green"><ListChecks size={16} aria-hidden="true" /></span>
            <div className="pf-title">
              <h2>{v("previewTitle")}</h2>
              <p>{v("willBeCreated", { kept: kept.length, total: combos.length })}</p>
            </div>
            {mode === "manual" && (
              <div className="pf-fill">
                <input type="text" value={start} placeholder="IPC010" aria-label={v("firstCode")}
                  onChange={(e) => setStart(e.target.value)} />
                <button type="button" className="ghost tiny" onClick={fillDown} disabled={!/\d$/.test(start.trim())}>
                  <Wand2 size={14} aria-hidden="true" /> {v("fillDown")}
                </button>
              </div>
            )}
          </div>
          <div className="pf-body flush">
            <table className="pf-table">
              <thead>
                <tr>
                  <th className="pf-keep">
                    <input type="checkbox" aria-label={v("all")} checked={kept.length === combos.length}
                      onChange={(e) => setDropped(e.target.checked ? new Set() : new Set(combos.map((c) => c.key)))} />
                  </th>
                  <th className="pf-n">#</th>
                  <th className="pf-code">{v("itemCode")}</th>
                  <th>{v("variant")}</th>
                  <th>{v("previewName")}</th>
                </tr>
              </thead>
              <tbody>
                {combos.map((c) => {
                  const keep = !dropped.has(c.key);
                  const at = kept.indexOf(c);
                  const t = typed(c.key);
                  const bad = keep && mode === "manual" && (!t || twice.has(t));
                  return (
                    <tr key={c.key} className={keep ? undefined : "off"}>
                      <td className="pf-keep">
                        <input type="checkbox" checked={keep} onChange={() => toggleCombo(c.key)}
                          aria-label={c.label} />
                      </td>
                      <td className="pf-n">{keep ? at + 1 : "—"}</td>
                      <td className="pf-code">
                        {!keep ? <span className="muted">—</span>
                          : mode === "model" ? <span className="m">{codeAt(at)}</span>
                          : (
                            <input type="text" className={`m varcode${bad && t ? " bad" : ""}`} value={codes[c.key] ?? ""}
                              aria-label={v("codeFor", { name: c.label })} placeholder={v("code")}
                              onChange={(e) => setCodes((x) => ({ ...x, [c.key]: e.target.value }))} />
                          )}
                      </td>
                      <td>{c.label}</td>
                      <td className="muted">{name || v("thisProduct")} {c.label}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className={`pf-status${ready ? " ok" : " bad"}`}>
            {ready ? <CheckCircle2 size={15} aria-hidden="true" /> : <AlertCircle size={15} aria-hidden="true" />}
            {kept.length === 0 ? v("nothingTicked")
              : mode === "model" && !prefix ? v("modelCodeNeeded")
              : twice.size > 0 ? v("codeTwiceHere")
              : missing > 0 ? v("codesMissingN", { n: missing })
              : v("codesReady", { n: kept.length })}
          </div>
        </section>
      )}
    </>
  );
}

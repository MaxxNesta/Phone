"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  HardDrive, Palette, Smartphone, Wifi, Cpu, Ruler, Globe2, MemoryStick, Tag,
  Search, CheckCircle2, AlertCircle, Wand2, ChevronLeft, ChevronRight, RotateCcw, AlertTriangle, X, Info,
} from "lucide-react";
import { modelItemCode, optionLabel } from "@/lib/item-code";
import { physicalKey, repeats } from "@/lib/variant-identity";

export type PickerAttribute = {
  id: string; code: string; name: string;
  /** The product identities it is offered for — Memory is for Macs. Null is all. */
  identities?: string[] | null;
  /** Brand codes it is not offered for — RAM is not for APPLE. Null is every brand. */
  not_for_brands?: string[] | null;
  options: { id: string; code: string; name: string }[];
};

type Combo = { key: string; optionIds: string[]; parts: { attributeId: string; label: string; name: string }[]; label: string };

/** How a variant's units are named, when it differs from its product's. */
export const VARIANT_TRACKING = [
  ["IMEI", "IMEI"], ["SERIAL", "Serial"], ["OPTIONAL", "Optional"], ["NONE", "Quantity"],
] as const;

/**
 * One product's configurations: which values of which attributes it comes
 * in, which of the combinations are actually sold, and — when codes are typed
 * by hand — each one's code. Held here and shared by the options card on the
 * left of the form and the preview on the right.
 *
 * Ticking Black, White, S, M and L describes six combinations, and a shop that
 * stocks Black in all three sizes but White only in M sells four of them, so
 * each combination can be dropped in the preview. Drops are exclusions, so
 * ticking another colour adds its combinations already on.
 *
 * What it produces is a plan (`payload`), not items: the server builds those,
 * so a form replayed cannot make two sets.
 */
export function useVariantPlan(attributes: PickerAttribute[], on: boolean,
  mode: "model" | "manual", prefix: string, tracking = "NONE") {
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [codes, setCodes] = useState<Record<string, string>>({});
  // A name typed over the generated one, per combination; absent is the default.
  const [names, setNames] = useState<Record<string, string>>({});
  // Tracking that differs from the product's, per combination.
  const [tracks, setTracks] = useState<Record<string, string>>({});
  // Combinations someone decided to keep beside an identical one.
  const [separate, setSeparate] = useState<Set<string>>(new Set());
  useEffect(() => { if (!on) { setChosen({}); setDropped(new Set()); setNames({}); setTracks({}); setSeparate(new Set()); } }, [on]);

  const toggleOption = (attrId: string, optId: string) =>
    setChosen((c) => {
      const have = c[attrId] ?? [];
      const next = { ...c, [attrId]: have.includes(optId) ? have.filter((x) => x !== optId) : [...have, optId] };
      if (next[attrId].length === 0) delete next[attrId];
      return next;
    });

  // Attributes with nothing picked do not count: they would multiply by zero.
  const plan = useMemo(() => attributes
    .filter((a) => (chosen[a.id]?.length ?? 0) > 0)
    .map((a) => ({ attribute: a, optionIds: chosen[a.id]! })), [attributes, chosen]);

  /** Every combination, in the attributes' declared order: "M / Red", never "Red / M". */
  const combos: Combo[] = useMemo(() => {
    if (plan.length === 0) return [];
    let rows: { attributeId: string; id: string; label: string; name: string }[][] = [[]];
    for (const p of plan) {
      const opts = p.attribute.options.filter((o) => p.optionIds.includes(o.id));
      rows = rows.flatMap((c) => opts.map((o) => [...c,
        { attributeId: p.attribute.id, id: o.id, label: optionLabel(p.attribute.name, o.name), name: o.name }]));
    }
    return rows.map((parts) => ({
      key: parts.map((p) => p.id).join("|"),
      optionIds: parts.map((p) => p.id),
      parts: parts.map((p) => ({ attributeId: p.attributeId, label: p.label, name: p.name })),
      label: parts.map((p) => p.label).join(" / "),
    }));
  }, [plan]);

  const kept = combos.filter((c) => !dropped.has(c.key));
  const typed = (key: string) => (codes[key] ?? "").trim().toUpperCase();
  const twice = useMemo(() => {
    const n = new Map<string, number>();
    for (const c of kept) { const t = typed(c.key); if (t) n.set(t, (n.get(t) ?? 0) + 1); }
    return new Set([...n].filter(([, k]) => k > 1).map(([t]) => t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kept, codes]);
  const missing = mode === "manual" ? kept.filter((c) => !typed(c.key)).length : 0;

  /* The same physical configuration twice — 42MM / Black and 42 / Black.
     The first of each pair is kept as is; every later one waits until
     someone drops it or keeps it on purpose. */
  const similar = useMemo(() => {
    const at = repeats(kept.map((c) => physicalKey(c.parts)));
    return new Map([...at].map(([i, j]) => [kept[i].key, kept[j].key]));
  }, [kept]);
  const undecided = [...similar.keys()].filter((k) => !separate.has(k));
  // As the server decides it: a cellular variant of a serial-number product has an IMEI.
  const trackOf = (key: string) => tracks[key] ?? (tracking === "SERIAL"
    && combos.find((c) => c.key === key)?.parts.some((p) => /cellular/i.test(p.name)) ? "IMEI" : tracking);

  const ready = !on || (kept.length > 0 && undecided.length === 0
    && (mode === "model" ? !!prefix : missing === 0 && twice.size === 0));

  const payload = JSON.stringify({
    attributes: plan.map((p) => p.attribute.id),
    combos: kept.map((c) => c.optionIds),
    ...(mode === "manual" ? { codes: kept.map((c) => typed(c.key)) } : { modelCode: prefix }),
    // Null where the generated name and the product's tracking stand.
    names: kept.map((c) => names[c.key]?.trim() || null),
    tracking: kept.map((c) => tracks[c.key] ?? null),
    separate: kept.map((c) => separate.has(c.key)),
  });

  return {
    chosen, toggleOption, plan, combos, kept, dropped, setDropped, codes, setCodes,
    typed, twice, missing, ready, payload,
    names, setNames, tracks, setTracks, trackOf, separate, setSeparate, similar, undecided,
  };
}
export type VariantPlan = ReturnType<typeof useVariantPlan>;

/** The symbol an attribute reads as, by what it is called. */
function AttrIcon({ name }: { name: string }) {
  const n = name.toLowerCase();
  const I = /stor|capac/.test(n) ? HardDrive : /colou?r/.test(n) ? Palette : /sim/.test(n) ? Smartphone
    : /connect|wi-?fi|cellular/.test(n) ? Wifi : /chip|cpu|processor/.test(n) ? Cpu
    : /memory|ram/.test(n) ? MemoryStick : /size|screen/.test(n) ? Ruler : /region|market/.test(n) ? Globe2 : Tag;
  return <I size={15} aria-hidden="true" />;
}

/** The attribute values to pick from, as chips grouped by attribute. */
export function VariantOptions({ attributes, v }: { attributes: PickerAttribute[]; v: VariantPlan }) {
  if (attributes.length === 0) {
    return <p className="hint">No variant attributes are set up yet. Add them under Settings › Catalogue › Variants.</p>;
  }
  return (
    <>
      <input type="hidden" name="variant_plan" value={v.payload} />
      <div className="pf2-attrs">
        {attributes.filter((a) => a.options.length > 0).map((a) => (
          <div key={a.id} className={`pf2-attr${v.chosen[a.id] ? " on" : ""}`}>
            <div className="pf2-attr-name"><AttrIcon name={a.name} /> {a.name}</div>
            <div className="pf2-chips">
              {a.options.map((o) => {
                const on = v.chosen[a.id]?.includes(o.id) ?? false;
                return (
                  <button key={o.id} type="button" aria-pressed={on}
                    className={`pf2-chip${on ? " on" : ""}`} onClick={() => v.toggleOption(a.id, o.id)}>
                    {o.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * What will be created: a code, the values and the name for every
 * combination, searchable and filterable by each attribute, paged so a
 * hundred variants stay a table and not a scroll.
 */
export function VariantPreview({ v, mode, prefix, nextNo, name, canKeepDuplicates = false }: {
  v: VariantPlan; mode: "model" | "manual"; prefix: string; nextNo: number | null; name: string;
  /** May keep two variants of one configuration (items.duplicates). */
  canKeepDuplicates?: boolean;
}) {
  const defaultName = (c: Combo) => `${name || "This product"} ${c.label}`;
  const nameOf = (c: Combo) => v.names[c.key] ?? defaultName(c);
  // A similar pair the person closed without deciding stays flagged on its
  // row; the dialog comes back for the next one, or when the flag is clicked.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const asking = v.undecided.find((k) => !dismissed.has(k)) ?? null;
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Record<string, string>>({});
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [start, setStart] = useState("");
  useEffect(() => { setPage(1); }, [q, filter, pageSize]);

  const codeAt = (i: number) =>
    prefix && nextNo !== null ? modelItemCode(prefix, nextNo + i) : prefix ? `${prefix}…` : "—";
  const keptIndex = new Map(v.kept.map((c, i) => [c.key, i]));
  const codeOf = (c: Combo) => (mode === "model" ? (keptIndex.has(c.key) ? codeAt(keptIndex.get(c.key)!) : "—") : v.typed(c.key) || "—");
  const byKey = new Map(v.combos.map((c) => [c.key, c]));

  const shown = v.combos.filter((c) =>
    (!q || `${codeOf(c)} ${name} ${c.label}`.toLowerCase().includes(q.toLowerCase())) &&
    Object.entries(filter).every(([attr, val]) => !val || c.parts.find((p) => p.attributeId === attr)?.label === val));
  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const cur = Math.min(page, pages);
  const rows = shown.slice((cur - 1) * pageSize, cur * pageSize);

  /** IPC010 down the kept list: IPC010, IPC011… keeping the zeros. */
  const fillDown = () => {
    const m = start.trim().toUpperCase().match(/^(.*?)(\d+)$/);
    if (!m) return;
    const [, p, digits] = m;
    v.setCodes((cur) => {
      const next = { ...cur };
      v.kept.forEach((c, i) => { next[c.key] = p + String(Number(digits) + i).padStart(digits.length, "0"); });
      return next;
    });
  };

  return (
    <section className="card pf2-card pf2-preview" id="pf-review">
      <div className="pf2-head">
        <span className="pf2-step">5</span>
        <div className="pf2-title"><h2>Variant preview</h2></div>
        <span className={`pf2-count${v.ready ? " ok" : ""}`}>
          {v.ready && v.kept.length > 0 ? <CheckCircle2 size={14} aria-hidden="true" /> : null}
          {v.kept.length} {v.kept.length === 1 ? "variant" : "variants"}
        </span>
      </div>

      {v.combos.length === 0 ? (
        <div className="pf2-empty">Pick values under Variants to see what will be created.</div>
      ) : (<>
        <div className="pf2-tools">
          <label className="pf2-search">
            <Search size={14} aria-hidden="true" />
            <input type="search" placeholder="Search variants…" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          {v.plan.map((p) => (
            <select key={p.attribute.id} className="pf2-filter" aria-label={p.attribute.name}
              value={filter[p.attribute.id] ?? ""}
              onChange={(e) => setFilter((f) => ({ ...f, [p.attribute.id]: e.target.value }))}>
              <option value="">{p.attribute.name}</option>
              {p.attribute.options.filter((o) => p.optionIds.includes(o.id)).map((o) => (
                <option key={o.id} value={optionLabel(p.attribute.name, o.name)}>{optionLabel(p.attribute.name, o.name)}</option>
              ))}
            </select>
          ))}
          {(q || Object.values(filter).some(Boolean)) && (
            <button type="button" className="ghost tiny" onClick={() => { setQ(""); setFilter({}); }}>Reset</button>
          )}
          {mode === "manual" && (
            <span className="pf2-fill">
              <input type="text" value={start} placeholder="IPC010" aria-label="First code"
                onChange={(e) => setStart(e.target.value)} />
              <button type="button" className="ghost tiny" onClick={fillDown} disabled={!/\d$/.test(start.trim())}>
                <Wand2 size={13} aria-hidden="true" /> Fill down
              </button>
            </span>
          )}
        </div>

        <div className="pf2-tablewrap">
          <table className="pf2-table">
            <thead>
              <tr>
                <th className="k">
                  <input type="checkbox" aria-label="Keep all" checked={v.kept.length === v.combos.length}
                    onChange={(e) => v.setDropped(e.target.checked ? new Set() : new Set(v.combos.map((c) => c.key)))} />
                </th>
                <th className="n">#</th>
                <th className="code">Item code</th>
                {v.plan.map((p) => <th key={p.attribute.id}>{p.attribute.name}</th>)}
                <th>Preview name</th>
                <th className="trk">Tracking</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const keep = !v.dropped.has(c.key);
                const t = v.typed(c.key);
                const bad = keep && mode === "manual" && t !== "" && v.twice.has(t);
                return (
                  <tr key={c.key} className={keep ? undefined : "off"}>
                    <td className="k">
                      <input type="checkbox" checked={keep} aria-label={`Create ${c.label}`}
                        onChange={() => v.setDropped((d) => {
                          const next = new Set(d);
                          if (next.has(c.key)) next.delete(c.key); else next.add(c.key);
                          return next;
                        })} />
                    </td>
                    <td className="n">{keep ? keptIndex.get(c.key)! + 1 : "—"}</td>
                    <td className="code">
                      {!keep ? "—" : mode === "model" ? codeOf(c) : (
                        <input type="text" className={`pf2-code${bad ? " bad" : ""}${!t ? " empty" : ""}`}
                          value={v.codes[c.key] ?? ""} placeholder="Code" aria-label={`Code for ${c.label}`}
                          onChange={(e) => v.setCodes((x) => ({ ...x, [c.key]: e.target.value }))} />
                      )}
                    </td>
                    {v.plan.map((p) => (
                      <td key={p.attribute.id}>{c.parts.find((x) => x.attributeId === p.attribute.id)?.label}</td>
                    ))}
                    <td className="name">
                      {keep ? (
                        <span className="pf2-name">
                          <input type="text" value={nameOf(c)} aria-label={`Name of ${c.label}`}
                            className={v.names[c.key] !== undefined ? "custom" : undefined}
                            onChange={(e) => {
                              const val = e.target.value;
                              v.setNames((n) => {
                                const next = { ...n };
                                if (val === defaultName(c)) delete next[c.key]; else next[c.key] = val;
                                return next;
                              });
                            }} />
                          {v.names[c.key] !== undefined && (
                            <button type="button" className="pf2-reset" title="Reset to default name"
                              aria-label={`Reset the name of ${c.label}`}
                              onClick={() => v.setNames((n) => { const next = { ...n }; delete next[c.key]; return next; })}>
                              <RotateCcw size={12} aria-hidden="true" />
                            </button>
                          )}
                          {v.similar.has(c.key) && (
                            <button type="button" className={`pf2-similar${v.separate.has(c.key) ? " kept" : ""}`}
                              title={v.separate.has(c.key) ? "Kept beside an identical variant — click to decide again" : "Same configuration as another variant"}
                              onClick={() => { setDismissed((d) => { const n = new Set(d); n.delete(c.key); return n; });
                                               v.setSeparate((x) => { const n = new Set(x); n.delete(c.key); return n; }); }}>
                              {v.separate.has(c.key) ? "Kept separate" : "Similar"}
                            </button>
                          )}
                        </span>
                      ) : <span className="subline">{defaultName(c)}</span>}
                    </td>
                    <td className="trk">
                      {keep && (
                        <select className="pf2-trk" value={v.trackOf(c.key)} aria-label={`Tracking of ${c.label}`}
                          onChange={(e) => v.setTracks((t) => ({ ...t, [c.key]: e.target.value }))}>
                          {VARIANT_TRACKING.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                        </select>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={5 + v.plan.length} className="pf2-empty">No variant matches.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="pf2-pager">
          <span>{shown.length === v.combos.length ? `${v.combos.length} variants` : `${shown.length} of ${v.combos.length}`}</span>
          <span className="sp" />
          <label>Rows per page
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button type="button" className="ghost tiny" aria-label="Previous page" disabled={cur === 1} onClick={() => setPage(cur - 1)}>
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
          <span>{cur} / {pages}</span>
          <button type="button" className="ghost tiny" aria-label="Next page" disabled={cur === pages} onClick={() => setPage(cur + 1)}>
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
      </>)}

      <div className={`pf2-status${v.ready ? " ok" : " bad"}`}>
        {v.ready ? <CheckCircle2 size={15} aria-hidden="true" /> : <AlertCircle size={15} aria-hidden="true" />}
        {v.kept.length === 0 ? "Pick at least one value to create variants."
          : mode === "model" && !prefix ? "Type a model code to number the variants."
          : v.undecided.length > 0 ? `${v.undecided.length} ${v.undecided.length === 1 ? "variant has" : "variants have"} the same configuration as another — use the existing one or keep it separate.`
          : v.twice.size > 0 ? "The same code is typed for two variants."
          : v.missing > 0 ? `${v.missing} ${v.missing === 1 ? "variant still needs" : "variants still need"} a code.`
          : `${v.kept.length} unique item ${v.kept.length === 1 ? "code" : "codes"} ready to create.`}
      </div>

      {asking && byKey.get(asking) && byKey.get(v.similar.get(asking)!) && (() => {
        const dup = byKey.get(asking)!;
        const orig = byKey.get(v.similar.get(asking)!)!;
        const differs = v.plan.filter((p) =>
          dup.parts.find((x) => x.attributeId === p.attribute.id)?.name !== orig.parts.find((x) => x.attributeId === p.attribute.id)?.name)
          .map((p) => p.attribute.name);
        return (
          <SimilarVariant key={asking}
            existing={{ code: codeOf(orig), name: nameOf(orig), parts: orig.parts }}
            incoming={{ code: codeOf(dup), name: nameOf(dup), parts: dup.parts }}
            attributes={v.plan.map((p) => ({ id: p.attribute.id, name: p.attribute.name }))}
            differs={differs}
            canKeep={canKeepDuplicates}
            onClose={() => setDismissed((d) => new Set(d).add(asking))}
            onUseExisting={() => v.setDropped((d) => new Set(d).add(asking))}
            onKeep={() => v.setSeparate((x) => new Set(x).add(asking))}
          />
        );
      })()}
    </section>
  );
}

type Side = { code: string; name: string; parts: { attributeId: string; label: string; name: string }[] };

/**
 * Two combinations that are one physical thing — 42MM / Black and 42 / Black.
 * Using the existing one drops the newcomer from the list; keeping it makes a
 * second record with its own code and name, which only someone allowed to may do.
 */
function SimilarVariant({ existing, incoming, attributes, differs, canKeep, onClose, onUseExisting, onKeep }: {
  existing: Side; incoming: Side; attributes: { id: string; name: string }[]; differs: string[];
  canKeep: boolean; onClose: () => void; onUseExisting: () => void; onKeep: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => { if (d?.open) d.close(); };
  }, []);
  const config = (s: Side) => attributes.map((a) => `${a.name}: ${s.parts.find((p) => p.attributeId === a.id)?.label ?? "—"}`);
  return (
    <dialog ref={ref} className="confirm simv" aria-labelledby="simv-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="confirm-panel">
        <div className="simv-head">
          <span className="simv-icon" aria-hidden="true"><AlertTriangle size={18} strokeWidth={2.25} /></span>
          <div>
            <h2 id="simv-title" className="confirm-title">Similar variant found</h2>
            <p className="confirm-detail">A variant with the same configuration is already in this list.</p>
          </div>
          <button type="button" className="simv-x" aria-label="Close" onClick={onClose}><X size={16} aria-hidden="true" /></button>
        </div>
        <dl className="simv-grid">
          <div>
            <dt>Existing</dt>
            <dd><span className="code">{existing.code}</span><strong>{existing.name}</strong>
              <span className="subline">{config(existing).join(" · ")}</span></dd>
          </div>
          <div>
            <dt>New</dt>
            <dd><span className="code">{incoming.code}</span><strong>{incoming.name}</strong>
              <span className="subline">{config(incoming).join(" · ")}</span></dd>
          </div>
        </dl>
        <div className="simv-note">
          <Info size={15} aria-hidden="true" />
          <span>
            {differs.length > 0
              ? <>Only the way {differs.join(" and ")} {differs.length === 1 ? "is" : "are"} written differs, so both describe the same unit. </>
              : <>Both describe the same unit. </>}
            Keep it as a separate variant only to carry a code the shop already uses.
            {!canKeep && <> Only a manager or administrator can keep it separate.</>}
          </span>
        </div>
        <div className="confirm-actions">
          <button type="button" className="ghost" autoFocus onClick={onUseExisting}>Use existing variant</button>
          <button type="button" disabled={!canKeep} onClick={onKeep}>Keep separate</button>
        </div>
      </div>
    </dialog>
  );
}

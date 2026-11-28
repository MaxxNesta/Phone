"use client";
import { Fragment, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { MM_VIEW, MM_REGIONS, MM_NAY_PYI_TAW } from "@/lib/myanmar-map";
import { CITY_KEYS, mapTownshipKey, placeKey } from "@/lib/myanmar-townships";
import { money } from "@/lib/format";

/**
 * Net sales on a map of Myanmar's states and regions (2026-11-27). One blue,
 * light to dark; nothing sold is the neutral fill. The scale is the square
 * root of each place's share of the largest, because one region (Mandalay)
 * outsells the rest several times over and a straight scale left every other
 * region the same pale step. Hover or focus a region for its numbers; click
 * it for its townships, fetched then and only then (lib/mm-townships, a chunk
 * each, 8–38 KB). Cities that span several townships are dots.
 */
type Row = { name: string; revenue: number; qty: number; marginPct: number | null };
type Town = Row & { region: string };
type TownFile = { region: string; view: { w: number; h: number }; townships: { name: string; d: string; cx: number; cy: number }[]; dots: { name: string; x: number; y: number }[] };

const ALIAS: Record<string, string> = {
  naypyidaw: "naypyitaw", naypyitawunionterritory: "naypyitaw", tanitharyi: "tanintharyi",
  ayeyarwaddy: "ayeyarwady", irrawaddy: "ayeyarwady", saigang: "sagaing", karen: "kayin", karenni: "kayah",
};
const keyOf = (s: string) => {
  const k = s.toLowerCase().replace(/\b(region|state|division)\b/g, "").replace(/[^a-z]/g, "");
  return ALIAS[k] ?? k;
};
const STEPS = [16, 34, 52, 70, 88];
const shade = (v: number, max: number) => {
  if (v <= 0 || max <= 0) return "var(--line-soft)";
  const s = Math.min(4, Math.max(0, Math.ceil(Math.sqrt(v / max) * 5) - 1));
  return `color-mix(in srgb, var(--link) ${STEPS[s]}%, var(--surface))`;
};
const files = new Map<string, Promise<TownFile>>();
const loadTowns = (region: string) => {
  const k = placeKey(region);
  // A chunk of its own per region, served from /_next/static and cached for
  // good: a path ending in .json anywhere else is refused by the middleware.
  if (!files.has(k)) files.set(k, import(`@/lib/mm-townships/${k}.json`).then((m) => m.default as TownFile)
    .catch(() => { files.delete(k); throw new Error(`No township map for ${region}`); }));
  return files.get(k)!;
};
const add = (a: Row | undefined, b: Row, name: string): Row => ({
  name, revenue: (a?.revenue ?? 0) + b.revenue, qty: (a?.qty ?? 0) + b.qty,
  // A margin over several rows would need their cost; one row keeps its own.
  marginPct: a ? null : b.marginPct,
});

export function RegionMap({ rows, towns = [], currency }: { rows: Row[]; towns?: Town[]; currency: string }) {
  const [zoom, setZoom] = useState<string | null>(null);
  const [file, setFile] = useState<TownFile | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    if (!zoom) { setFile(null); return; }
    let live = true; setFile(null); setFailed(null);
    loadTowns(zoom).then((f) => live && setFile(f)).catch((e) => live && setFailed(String(e.message ?? e)));
    return () => { live = false; };
  }, [zoom]);

  const byKey = new Map(rows.map((r) => [keyOf(r.name), r]));
  const total = rows.reduce((s, r) => s + r.revenue, 0);
  const fig = (r: Row | undefined) => (r ? `${money(String(Math.round(r.revenue)))} ${currency}` : "no sales");
  const open = (name: string) => { setHover(null); setZoom(name); };
  const keys = (e: React.KeyboardEvent, name: string) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(name); } };

  // ------------------------------------------------------------ zoomed --
  if (zoom) {
    const region = byKey.get(keyOf(zoom));
    const mine = towns.filter((t) => keyOf(t.region) === keyOf(zoom));
    const shapeKeys = new Set(file?.townships.map((t) => placeKey(t.name)) ?? []);
    const dotKeys = new Map(file?.dots.map((d) => [keyOf(d.name), d.name]) ?? []);
    const placed = new Map<string, Row>();
    let noTownship: Row | undefined; const offMap: Row[] = [];
    for (const t of mine) {
      if (!t.name.trim()) { noTownship = add(noTownship, t, "No township"); continue; }
      const k = mapTownshipKey(t.name);
      const city = CITY_KEYS.has(k) ? dotKeys.get(keyOf(t.name)) : undefined;
      const at = shapeKeys.has(k) ? k : city ? `dot:${keyOf(city)}` : null;
      if (at) placed.set(at, add(placed.get(at), t, t.name)); else offMap.push(t);
    }
    const max = Math.max(0, ...[...placed.values()].map((r) => r.revenue));
    const top3 = new Set([...placed.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 3).filter(([, r]) => r.revenue > 0).map(([k]) => k));
    const hovered = hover ? placed.get(hover) : undefined;
    const hoverName = hover ? (hover.startsWith("dot:") ? file?.dots.find((d) => `dot:${keyOf(d.name)}` === hover)?.name
      : file?.townships.find((t) => placeKey(t.name) === hover)?.name) : null;
    return (
      <div className="rmap">
        <div className="rmap-stage">
          {!file && !failed && <div className="rmap-wait">Loading {zoom}’s townships…</div>}
          {failed && <div className="rmap-wait">{failed}</div>}
          {file && (
            <svg viewBox={`0 0 ${file.view.w} ${file.view.h}`} role="img" aria-label={`Net sales by township in ${zoom}`}
                 onMouseLeave={() => setHover(null)}>
              {file.townships.map((t) => {
                const k = placeKey(t.name), r = placed.get(k);
                return (
                  <path key={t.name} d={t.d} fill={shade(r?.revenue ?? 0, max)}
                        tabIndex={0} aria-label={`${t.name}: ${fig(r)}`}
                        onMouseEnter={() => setHover(k)} onFocus={() => setHover(k)} onBlur={() => setHover(null)}>
                    <title>{`${t.name}: ${fig(r)}`}</title>
                  </path>
                );
              })}
              {/* The outline of what is hovered, drawn on top and not in the
                  way: moving the shape itself to the top moved its node
                  mid-tap, and the tap's click was lost. */}
              {hover && !hover.startsWith("dot:") && (
                <path className="rmap-hl" d={file.townships.find((t) => placeKey(t.name) === hover)?.d ?? ""} />
              )}
              {file.dots.map((d) => {
                const k = `dot:${keyOf(d.name)}`, r = placed.get(k);
                return (
                  <circle key={d.name} cx={d.x} cy={d.y} r={9} fill={shade(r?.revenue ?? 0, max)} className={`rmap-npt${k === hover ? " on" : ""}`}
                          tabIndex={0} aria-label={`${d.name} (city): ${fig(r)}`}
                          onMouseEnter={() => setHover(k)} onFocus={() => setHover(k)} onBlur={() => setHover(null)}>
                    <title>{`${d.name} (city): ${fig(r)}`}</title>
                  </circle>
                );
              })}
              {file.townships.filter((t) => top3.has(placeKey(t.name))).map((t) => (
                <text key={t.name} x={t.cx} y={t.cy} className="rmap-label">{t.name}</text>
              ))}
              {file.dots.filter((d) => top3.has(`dot:${keyOf(d.name)}`)).map((d) => (
                <text key={d.name} x={d.x} y={d.y - 16} className="rmap-label">{d.name}</text>
              ))}
            </svg>
          )}
        </div>
        <div className="rmap-side">
          <button type="button" className="btn ghost tiny rmap-back" onClick={() => { setZoom(null); setHover(null); }}>
            <ArrowLeft size={14} aria-hidden="true" /> Myanmar
          </button>
          <div className="rmap-info" aria-live="polite">
            {hover && hoverName ? (
              <>
                <strong>{hoverName}{hover.startsWith("dot:") ? " (city)" : ""}</strong>
                {hovered ? (
                  <dl>
                    <dt>Net sales</dt><dd>{money(String(Math.round(hovered.revenue)))} <small>{currency}</small></dd>
                    <dt>Of {zoom}</dt><dd>{region?.revenue ? `${((hovered.revenue / region.revenue) * 100).toFixed(1)}%` : "—"}</dd>
                    <dt>Units</dt><dd>{hovered.qty.toLocaleString("en-US")}</dd>
                    <dt>Margin</dt><dd>{hovered.marginPct === null ? "—" : `${hovered.marginPct.toFixed(1)}%`}</dd>
                  </dl>
                ) : <p>No sales in this period.</p>}
              </>
            ) : (
              <>
                <strong>{zoom}</strong>
                <dl>
                  <dt>Net sales</dt><dd>{region ? money(String(Math.round(region.revenue))) : "—"} <small>{currency}</small></dd>
                  <dt>On the map</dt><dd>{money(String(Math.round([...placed.values()].reduce((s, r) => s + r.revenue, 0))))}</dd>
                  {noTownship && noTownship.revenue !== 0 && <><dt>No township</dt><dd>{money(String(Math.round(noTownship.revenue)))}</dd></>}
                  {offMap.filter((r) => r.revenue !== 0).map((r) => <Fragment key={r.name}><dt>{r.name}</dt><dd>{money(String(Math.round(r.revenue)))}</dd></Fragment>)}
                </dl>
              </>
            )}
          </div>
          <div className="rmap-key" aria-hidden="true">
            <div className="rmap-swatches">
              <span style={{ background: "var(--line-soft)" }} />
              {STEPS.map((s) => <span key={s} style={{ background: `color-mix(in srgb, var(--link) ${s}%, var(--surface))` }} />)}
            </div>
            <div className="rmap-ends"><span>None</span><span>Most · {max > 0 ? money(String(Math.round(max))) : "—"}</span></div>
          </div>
          {offMap.length > 0 && <p className="rmap-note">Not placed on the map: {offMap.map((r) => r.name).join(", ")}.</p>}
          <p className="rmap-note">Dots are cities of several townships. Townships: MIMU (CC BY-IGO).</p>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------- country --
  const max = Math.max(0, ...rows.map((r) => r.revenue));
  const onMap = new Set([...MM_REGIONS.map((r) => r.name), MM_NAY_PYI_TAW.name].map(keyOf));
  const offMap = rows.filter((r) => !onMap.has(keyOf(r.name)) && r.revenue !== 0);
  const top = [...rows].filter((r) => r.revenue > 0 && onMap.has(keyOf(r.name))).sort((a, b) => b.revenue - a.revenue)[0];
  const shown = hover ?? top?.name ?? null;
  const info = shown ? byKey.get(keyOf(shown)) : undefined;
  // Direct labels on the three largest only; the rest are a hover away.
  const labelled = new Set([...rows].filter((r) => r.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 3).map((r) => keyOf(r.name)));
  const npt = byKey.get(keyOf(MM_NAY_PYI_TAW.name));
  const tip = (name: string) => `${name}: ${fig(byKey.get(keyOf(name)))}`;

  return (
    <div className="rmap">
      <div className="rmap-stage">
        <svg viewBox={`0 0 ${MM_VIEW.w} ${MM_VIEW.h}`} role="img"
             aria-label={`Net sales by region${top ? `, highest in ${top.name}` : ""}`} onMouseLeave={() => setHover(null)}>
          {MM_REGIONS.map((r) => (
            <path key={r.name} d={r.d} fill={shade(byKey.get(keyOf(r.name))?.revenue ?? 0, max)}
                  tabIndex={0} role="button" aria-label={`${tip(r.name)}. Show its townships.`}
                  onClick={() => open(r.name)} onKeyDown={(e) => keys(e, r.name)}
                  onMouseEnter={() => setHover(r.name)} onFocus={() => setHover(r.name)} onBlur={() => setHover(null)}>
              <title>{tip(r.name)}</title>
            </path>
          ))}
          {hover && keyOf(hover) !== "naypyitaw" && (
            <path className="rmap-hl" d={MM_REGIONS.find((r) => keyOf(r.name) === keyOf(hover))?.d ?? ""} />
          )}
          <circle cx={MM_NAY_PYI_TAW.x} cy={MM_NAY_PYI_TAW.y} r={6} fill={shade(npt?.revenue ?? 0, max)}
                  className={`rmap-npt${keyOf(hover ?? "") === "naypyitaw" ? " on" : ""}`} tabIndex={0} role="button"
                  aria-label={`${tip(MM_NAY_PYI_TAW.name)}. Show its townships.`}
                  onClick={() => open(MM_NAY_PYI_TAW.name)} onKeyDown={(e) => keys(e, MM_NAY_PYI_TAW.name)}
                  onMouseEnter={() => setHover(MM_NAY_PYI_TAW.name)} onFocus={() => setHover(MM_NAY_PYI_TAW.name)} onBlur={() => setHover(null)}>
            <title>{tip(MM_NAY_PYI_TAW.name)}</title>
          </circle>
          {MM_REGIONS.filter((r) => labelled.has(keyOf(r.name))).map((r) => (
            <text key={r.name} x={r.cx} y={r.cy} className="rmap-label">{r.name}</text>
          ))}
        </svg>
      </div>

      <div className="rmap-side">
        <div className="rmap-info" aria-live="polite">
          {shown ? (
            <>
              <strong>{shown}</strong>
              {info ? (
                <dl>
                  <dt>Net sales</dt><dd>{money(String(Math.round(info.revenue)))} <small>{currency}</small></dd>
                  <dt>Share</dt><dd>{total > 0 ? `${((info.revenue / total) * 100).toFixed(1)}%` : "—"}</dd>
                  <dt>Units</dt><dd>{info.qty.toLocaleString("en-US")}</dd>
                  <dt>Margin</dt><dd>{info.marginPct === null ? "—" : `${info.marginPct.toFixed(1)}%`}</dd>
                </dl>
              ) : <p>No sales in this period.</p>}
            </>
          ) : <p>No sales in this period.</p>}
        </div>
        <div className="rmap-key" aria-hidden="true">
          <div className="rmap-swatches">
            <span style={{ background: "var(--line-soft)" }} />
            {STEPS.map((s) => <span key={s} style={{ background: `color-mix(in srgb, var(--link) ${s}%, var(--surface))` }} />)}
          </div>
          <div className="rmap-ends"><span>None</span><span>Most · {max > 0 ? money(String(Math.round(max))) : "—"}</span></div>
        </div>
        {offMap.length > 0 && (
          <p className="rmap-note">Not on the map: {offMap.map((r) => r.name).join(", ")}</p>
        )}
        <p className="rmap-note">Click a region for its townships. Nay Pyi Taw is the dot. Boundaries: Natural Earth.</p>
      </div>
    </div>
  );
}

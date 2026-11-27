"use client";
import { useState } from "react";
import { MM_VIEW, MM_REGIONS, MM_NAY_PYI_TAW } from "@/lib/myanmar-map";
import { money } from "@/lib/format";

/**
 * Net sales on a map of Myanmar's states and regions (2026-11-27). One blue,
 * light to dark; nothing sold is the neutral fill. The scale is the square
 * root of each region's share of the largest, because one region (Mandalay)
 * outsells the rest several times over and a straight scale left every other
 * region the same pale step. The figures are in the table below; this says
 * where. Hover or focus a region for its numbers.
 */
type Row = { name: string; revenue: number; qty: number; marginPct: number | null };

const ALIAS: Record<string, string> = {
  naypyidaw: "naypyitaw", naypyitawunionterritory: "naypyitaw", tanitharyi: "tanintharyi",
  ayeyarwaddy: "ayeyarwady", irrawaddy: "ayeyarwady", saigang: "sagaing", karen: "kayin", karenni: "kayah",
};
const keyOf = (s: string) => {
  const k = s.toLowerCase().replace(/\b(region|state|division)\b/g, "").replace(/[^a-z]/g, "");
  return ALIAS[k] ?? k;
};
const STEPS = [16, 34, 52, 70, 88];

export function RegionMap({ rows, currency }: { rows: Row[]; currency: string }) {
  const byKey = new Map(rows.map((r) => [keyOf(r.name), r]));
  const max = Math.max(0, ...rows.map((r) => r.revenue));
  const total = rows.reduce((s, r) => s + r.revenue, 0);
  const step = (v: number) => (v <= 0 || max <= 0 ? -1 : Math.min(4, Math.max(0, Math.ceil(Math.sqrt(v / max) * 5) - 1)));
  const fill = (v: number) => {
    const s = step(v);
    return s < 0 ? "var(--line-soft)" : `color-mix(in srgb, var(--link) ${STEPS[s]}%, var(--surface))`;
  };
  const places = [...MM_REGIONS.map((r) => r.name), MM_NAY_PYI_TAW.name];
  const onMap = new Set(places.map(keyOf));
  const offMap = rows.filter((r) => !onMap.has(keyOf(r.name)) && r.revenue !== 0);
  const top = [...rows].filter((r) => r.revenue > 0 && onMap.has(keyOf(r.name))).sort((a, b) => b.revenue - a.revenue)[0];
  const [hover, setHover] = useState<string | null>(null);
  const shown = hover ?? top?.name ?? null;
  const info = shown ? byKey.get(keyOf(shown)) : undefined;
  // Direct labels on the three largest only; the rest are a hover away.
  const labelled = new Set([...rows].filter((r) => r.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 3).map((r) => keyOf(r.name)));
  const ordered = [...MM_REGIONS].sort((a, b) => Number(keyOf(a.name) === keyOf(hover ?? "")) - Number(keyOf(b.name) === keyOf(hover ?? "")));
  const npt = byKey.get(keyOf(MM_NAY_PYI_TAW.name));
  const tip = (name: string) => {
    const r = byKey.get(keyOf(name));
    return r ? `${name}: ${money(String(Math.round(r.revenue)))} ${currency}` : `${name}: no sales`;
  };

  return (
    <div className="rmap">
      <svg viewBox={`0 0 ${MM_VIEW.w} ${MM_VIEW.h}`} role="img"
           aria-label={`Net sales by region${top ? `, highest in ${top.name}` : ""}`} onMouseLeave={() => setHover(null)}>
        {ordered.map((r) => (
          <path key={r.name} d={r.d} fill={fill(byKey.get(keyOf(r.name))?.revenue ?? 0)}
                className={keyOf(r.name) === keyOf(hover ?? "") ? "on" : undefined}
                tabIndex={0} aria-label={tip(r.name)}
                onMouseEnter={() => setHover(r.name)} onFocus={() => setHover(r.name)} onBlur={() => setHover(null)}>
            <title>{tip(r.name)}</title>
          </path>
        ))}
        <circle cx={MM_NAY_PYI_TAW.x} cy={MM_NAY_PYI_TAW.y} r={6} fill={fill(npt?.revenue ?? 0)}
                className={`rmap-npt${keyOf(hover ?? "") === "naypyitaw" ? " on" : ""}`} tabIndex={0} aria-label={tip(MM_NAY_PYI_TAW.name)}
                onMouseEnter={() => setHover(MM_NAY_PYI_TAW.name)} onFocus={() => setHover(MM_NAY_PYI_TAW.name)} onBlur={() => setHover(null)}>
          <title>{tip(MM_NAY_PYI_TAW.name)}</title>
        </circle>
        {MM_REGIONS.filter((r) => labelled.has(keyOf(r.name))).map((r) => (
          <text key={r.name} x={r.cx} y={r.cy} className="rmap-label">{r.name}</text>
        ))}
      </svg>

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
        <p className="rmap-note">Nay Pyi Taw is the dot. Boundaries: Natural Earth.</p>
      </div>
    </div>
  );
}

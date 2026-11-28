"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { MM_VIEW, MM_REGIONS, MM_NAY_PYI_TAW } from "@/lib/myanmar-map";
import type { Markets, MarketFig } from "@/lib/markets";

/**
 * The Executive dashboard's Markets tab (2026-11-28): where the money came
 * from, on a big map in the page's own face. Hover a region for its figures
 * (a card follows the pointer); the ranked list beside it and the map point
 * at each other; click a region and the map flies into it, then its
 * townships (MIMU) fade in, loaded only then. Shading is the square root of
 * each place's share of the largest, so the regions after the biggest still
 * read apart.
 */
type Measure = keyof MarketFig;
const MEASURES: Record<Measure, string> = { sales: "Net sales", gp: "Gross profit", units: "Units", invoices: "Invoices" };
type TownFile = { region: string; view: { w: number; h: number }; townships: { name: string; d: string; cx: number; cy: number }[]; dots: { name: string; x: number; y: number }[] };
const ALL = [...MM_REGIONS.map((r) => r.name), MM_NAY_PYI_TAW.name];

const placeKey = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const kyat = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const short = (n: number) => { const a = Math.abs(n), s = n < 0 ? "−" : "";
  return a >= 1e9 ? `${s}${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${s}${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${s}${Math.round(a / 1e3)}K` : `${s}${Math.round(a)}`; };
const STEPS = ["var(--xh-1)", "var(--xh-2)", "var(--xh-3)", "var(--xh-4)", "var(--mk-top)"];
const shade = (v: number, max: number) => (v <= 0 || max <= 0 ? "var(--xh-0)" : STEPS[Math.min(4, Math.max(0, Math.ceil(Math.sqrt(v / max) * 5) - 1))]);
const files = new Map<string, Promise<TownFile>>();
const loadTowns = (region: string) => {
  const k = placeKey(region);
  if (!files.has(k)) files.set(k, import(`@/lib/mm-townships/${k}.json`).then((m) => m.default as TownFile).catch((e) => { files.delete(k); throw e; }));
  return files.get(k)!;
};

export function ExecMarkets({ data, period }: { data: Markets; period: string }) {
  const [measure, setMeasure] = useState<Measure>("sales");
  const [hover, setHover] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [file, setFile] = useState<TownFile | null>(null);
  const [view, setView] = useState<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: MM_VIEW.w, h: MM_VIEW.h });
  const [phase, setPhase] = useState<"country" | "flying" | "towns">("country");
  const stage = useRef<HTMLDivElement>(null);
  const paths = useRef<Record<string, SVGGraphicsElement | null>>({});

  const R = data.regions;
  const ranked = useMemo(() => Object.entries(R).filter(([n]) => n !== "No region").sort((a, b) => b[1][measure] - a[1][measure]), [R, measure]);
  const total = ranked.reduce((t, [, f]) => t + f[measure], 0);
  const max = Math.max(0, ranked[0]?.[1][measure] ?? 0);
  const totals = Object.values(R).reduce((t, f) => ({ sales: t.sales + f.sales, gp: t.gp + f.gp, invoices: t.invoices + f.invoices }), { sales: 0, gp: 0, invoices: 0 });
  const bySales = Object.entries(R).filter(([n]) => n !== "No region").sort((a, b) => b[1].sales - a[1].sales);
  const unsold = ALL.filter((n) => !(R[n]?.sales > 0));
  const share = (n: number) => (totals.sales ? Math.round((n / totals.sales) * 100) : 0);

  const fly = (to: typeof view, done: () => void) => {
    const from = view, t0 = performance.now(), ms = 650;
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms), e = ease(t);
      setView({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: from.w + (to.w - from.w) * e, h: from.h + (to.h - from.h) * e });
      if (t < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  };
  const open = (name: string) => {
    const el = paths.current[name];
    if (!el || phase !== "country") return;
    const b = el.getBBox(), pad = 14, ratio = MM_VIEW.w / MM_VIEW.h;
    let w = b.width + pad * 2, h = b.height + pad * 2;
    if (w / h > ratio) h = w / ratio; else w = h * ratio;
    setZoom(name); setHover(null); setTip(null); setPhase("flying");
    const load = loadTowns(name).catch(() => null);
    fly({ x: b.x + b.width / 2 - w / 2, y: b.y + b.height / 2 - h / 2, w, h }, () => load.then((f) => { setFile(f); setPhase("towns"); }));
  };
  const back = () => {
    setPhase("flying"); setFile(null); setHover(null);
    fly({ x: 0, y: 0, w: MM_VIEW.w, h: MM_VIEW.h }, () => { setZoom(null); setPhase("country"); });
  };
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && phase === "towns") back(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  });

  const move = (e: React.MouseEvent) => { const r = stage.current?.getBoundingClientRect(); if (r) setTip({ x: e.clientX - r.left, y: e.clientY - r.top }); };
  const tv = zoom ? data.towns[zoom] ?? {} : {};
  const townMax = Math.max(0, ...Object.values(tv));
  const fig = hover && phase === "country" ? R[hover] : undefined;
  const townFig = hover && phase === "towns" ? (tv[hover] ?? tv[`city:${hover}`] ?? 0) : 0;
  const keys = (e: React.KeyboardEvent, n: string) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(n); } };
  const isMoney = measure === "sales" || measure === "gp";

  if (totals.sales === 0 && !Object.keys(R).length) {
    return <p className="xd-quiet">No sales were posted in this period, so there is nowhere to show yet.</p>;
  }
  const [r1, r2, r3] = bySales;
  return (
    <>
      <section className="xd-hero">
        <p className="xd-headline">
          {r1 && <><strong>{r1[0]}</strong> brought in {share(r1[1].sales)}% of sales</>}
          {r2 && r3 ? <>; with <strong>{r2[0]}</strong> and <strong>{r3[0]}</strong> it is {share(r1[1].sales + r2[1].sales + r3[1].sales)}%.</> : "."}
        </p>
        <div className="xd-kpis">
          <div className="xd-kpi"><span className="xd-kpi-label">Net sales</span><span className="xd-kpi-value">{short(totals.sales)}</span><span className="xd-kpi-sub">MMK, {bySales.length} region{bySales.length === 1 ? "" : "s"}</span></div>
          <div className="xd-kpi"><span className="xd-kpi-label">Gross profit</span><span className="xd-kpi-value">{short(totals.gp)}</span><span className="xd-kpi-sub">{totals.sales ? ((totals.gp / totals.sales) * 100).toFixed(1) : "0.0"}% margin</span></div>
          <div className="xd-kpi"><span className="xd-kpi-label">Top region</span><span className="xd-kpi-value">{r1?.[0] ?? "—"}</span><span className="xd-kpi-sub">{r1 ? `${short(r1[1].sales)} · ${r1[1].invoices} invoices` : ""}</span></div>
          <div className="xd-kpi"><span className="xd-kpi-label">Not yet sold to</span><span className="xd-kpi-value">{unsold.length} region{unsold.length === 1 ? "" : "s"}</span><span className="xd-kpi-sub">{unsold.slice(0, 4).join(", ")}{unsold.length > 4 ? "…" : ""}</span></div>
        </div>
      </section>

      <section className="xd-sec mk">
        <header>
          <h2>{zoom ? `${zoom}, by township` : "Where it sold"}</h2>
          <span>{zoom ? "Dots are cities of several townships · Esc to go back" : `${period} · click a region to fly into its townships`}</span>
          <div className="mk-measures" role="group" aria-label="Measure">
            {(Object.keys(MEASURES) as Measure[]).map((m) => (
              <button key={m} type="button" aria-pressed={m === measure} onClick={() => setMeasure(m)} disabled={!!zoom && m !== "sales"}>{MEASURES[m]}</button>
            ))}
          </div>
        </header>

        <div className="mk-body">
          <div className="mk-stage" ref={stage} onMouseMove={move} onMouseLeave={() => { setHover(null); setTip(null); }}>
            {zoom && <button type="button" className="mk-back" onClick={back} disabled={phase !== "towns"}>← Myanmar</button>}

            <svg className={`mk-svg${phase === "towns" ? " gone" : ""}`} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} role="img" aria-label="Myanmar by region">
              {MM_REGIONS.map((r) => {
                const f = R[r.name];
                return (
                  <path key={r.name} ref={(el) => { paths.current[r.name] = el; }} d={r.d} fill={shade(f?.[measure] ?? 0, max)}
                        className={`${hover === r.name ? "on" : ""}${zoom && zoom !== r.name ? " dim" : ""}`}
                        tabIndex={phase === "country" ? 0 : -1} role="button" aria-label={`${r.name}: ${f ? kyat(f[measure]) : "no sales"}. Show its townships.`}
                        onMouseEnter={() => setHover(r.name)} onFocus={() => setHover(r.name)} onClick={() => open(r.name)} onKeyDown={(e) => keys(e, r.name)} />
                );
              })}
              <circle ref={(el) => { paths.current[MM_NAY_PYI_TAW.name] = el; }} cx={MM_NAY_PYI_TAW.x} cy={MM_NAY_PYI_TAW.y} r={7}
                      fill={shade(R[MM_NAY_PYI_TAW.name]?.[measure] ?? 0, max)} className={`mk-dot${hover === MM_NAY_PYI_TAW.name ? " on" : ""}`}
                      tabIndex={phase === "country" ? 0 : -1} role="button" aria-label={`Nay Pyi Taw. Show its townships.`}
                      onMouseEnter={() => setHover(MM_NAY_PYI_TAW.name)} onClick={() => open(MM_NAY_PYI_TAW.name)} onKeyDown={(e) => keys(e, MM_NAY_PYI_TAW.name)} />
              {phase === "country" && ranked.slice(0, 3).map(([n]) => {
                const r = MM_REGIONS.find((x) => x.name === n);
                return r ? <text key={n} x={r.cx} y={r.cy} className="mk-label">{n}</text> : null;
              })}
            </svg>

            {phase === "towns" && file && (
              <svg className="mk-svg mk-towns" viewBox={`0 0 ${file.view.w} ${file.view.h}`} role="img" aria-label={`${zoom} by township`}>
                {file.townships.map((t) => (
                  <path key={t.name} d={t.d} fill={shade(tv[t.name] ?? 0, townMax)} className={hover === t.name ? "on" : undefined} onMouseEnter={() => setHover(t.name)} />
                ))}
                {file.dots.map((d) => (
                  <circle key={d.name} cx={d.x} cy={d.y} r={11} fill={shade(tv[`city:${d.name}`] ?? 0, townMax)} className={`mk-dot${hover === d.name ? " on" : ""}`} onMouseEnter={() => setHover(d.name)} />
                ))}
                {Object.entries(tv).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n]) => {
                  const nm = n.replace(/^city:/, "");
                  const t = file.townships.find((x) => x.name === nm), d = file.dots.find((x) => x.name === nm);
                  return t ? <text key={n} x={t.cx} y={t.cy} className="mk-label">{nm}</text> : d ? <text key={n} x={d.x} y={d.y - 18} className="mk-label">{nm}</text> : null;
                })}
              </svg>
            )}

            {tip && hover && (
              <div className="mk-tip" style={{ left: Math.min(tip.x + 18, (stage.current?.clientWidth ?? 600) - 230), top: tip.y + 18 }}>
                <strong>{hover}</strong>
                {phase === "country" ? (fig ? (<>
                  <span className="mk-tip-big">{kyat(fig[measure])}{isMoney && <small> MMK</small>}</span>
                  <span>{total ? ((fig[measure] / total) * 100).toFixed(1) : "0"}% of the total · #{ranked.findIndex(([n]) => n === hover) + 1}</span>
                  <span>{fig.sales ? ((fig.gp / fig.sales) * 100).toFixed(1) : "0"}% margin · {fig.invoices} invoice{fig.invoices === 1 ? "" : "s"}</span>
                </>) : <span>No sales yet</span>) : (townFig
                  ? <><span className="mk-tip-big">{kyat(townFig)}<small> MMK</small></span><span>{((townFig / (R[zoom!]?.sales || 1)) * 100).toFixed(1)}% of {zoom}</span></>
                  : <span>No sales yet</span>)}
              </div>
            )}
            <div className="mk-legend" aria-hidden="true"><span>Less</span>{["var(--xh-0)", ...STEPS].map((c) => <i key={c} style={{ background: c }} />)}<span>More</span></div>
          </div>

          <ol className="mk-rank">
            {(zoom ? Object.entries(tv).map(([n, v]) => [n.replace(/^city:/, ""), v, n.startsWith("city:")] as const).sort((a, b) => b[1] - a[1])
                   : ranked.map(([n, f]) => [n, f[measure], false] as const)).map(([n, v, city], i, all) => (
              <li key={n} className={hover === n ? "on" : undefined} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(null)} onClick={() => !zoom && open(n)}>
                <span className="mk-rank-n">{i + 1}</span>
                <span className="mk-rank-name">{n}{city && <em> city</em>}</span>
                <span className="mk-rank-v">{isMoney || zoom ? short(v) : kyat(v)}</span>
                <span className="mk-rank-bar"><i style={{ width: `${Math.max(0, (v / (all[0]?.[1] || 1)) * 100)}%` }} /></span>
              </li>
            ))}
            {zoom && data.noTownship[zoom] ? (
              <li className="mk-rank-none"><span className="mk-rank-n">·</span><span className="mk-rank-name">No township on the customer</span><span className="mk-rank-v">{short(data.noTownship[zoom])}</span></li>
            ) : null}
            {!zoom && R["No region"]?.sales ? (
              <li className="mk-rank-none"><span className="mk-rank-n">·</span><span className="mk-rank-name">No region on the customer</span><span className="mk-rank-v">{short(R["No region"][measure])}</span></li>
            ) : null}
          </ol>
        </div>
        <p className="xd-note">Net sales by where each customer is, from posted invoices less returns. Shaded on a square-root scale. Boundaries: Natural Earth; townships: MIMU.</p>
      </section>
    </>
  );
}

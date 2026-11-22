"use client";

import { useState } from "react";

/* Executive dashboard charts. Two series only — revenue (blue) and gross profit
   (amber) — validated for colour-blind separation and contrast in light and
   dark (dataviz validate_palette.js; tokens --exec-rev / --exec-gp). Text stays
   in ink colours; every chart has a legend, hover values and a table nearby. */

const short = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${Math.round(n / 1e3)}K`;
  return `${Math.round(n)}`;
};
const full = (n: number) => Math.round(n).toLocaleString("en-US");
const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });

/** Nice round top for the axis: 1, 2, 2.5 or 5 × a power of ten. */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

/** Revenue and gross profit by month: grouped columns on one MMK axis. */
export function ProfitColumns({ months, wide = false }: { months: { month: string; rev: number; gp: number }[]; wide?: boolean }) {
  const [hi, setHi] = useState<number | null>(null);
  // A wider drawing for a full-width chart, so its text stays the size of the narrow one's.
  const W = wide ? 1160 : 720, H = 240, L = 48, B = 26, T = 12;
  const top = niceMax(Math.max(...months.map((m) => Math.max(m.rev, m.gp)), 0));
  const bottom = Math.min(0, ...months.map((m) => m.gp));
  const span = top - bottom || 1;
  const y = (v: number) => T + ((top - v) / span) * (H - T - B);
  const slot = (W - L) / months.length, bw = Math.max(4, Math.min(18, (slot - 10) / 2));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => bottom + f * span);
  const last = months[months.length - 1];
  const h = hi == null ? null : months[hi];
  return (
    <figure className="xc">
      <div className="xc-legend">
        <span><i className="sw rev" />Revenue{last ? <b>{short(last.rev)}</b> : null}</span>
        <span><i className="sw gp" />Gross profit{last ? <b>{short(last.gp)}</b> : null}</span>
        <span className="xc-hint">{last ? `${monthLabel(last.month)}, latest` : ""}</span>
      </div>
      <div className="xc-plot" onMouseLeave={() => setHi(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Revenue and gross profit by month, last 12 months">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W} y1={y(t)} y2={y(t)} className="xc-grid" />
              <text x={L - 6} y={y(t) + 4} className="xc-axis" textAnchor="end">{short(t)}</text>
            </g>
          ))}
          {months.map((m, i) => {
            const x = L + i * slot + (slot - (bw * 2 + 2)) / 2;
            const bar = (v: number, dx: number, cls: string) => {
              const y0 = y(Math.max(v, 0)), y1 = y(Math.min(v, 0));
              return <rect x={x + dx} y={y0} width={bw} height={Math.max(0, y1 - y0)} rx={Math.min(4, bw / 2)} className={cls} />;
            };
            return (
              <g key={m.month} className={hi != null && hi !== i ? "xc-dim" : undefined}
                 onMouseEnter={() => setHi(i)} onFocus={() => setHi(i)} tabIndex={0}
                 aria-label={`${monthLabel(m.month)}: revenue ${full(m.rev)}, gross profit ${full(m.gp)}`}>
                <rect x={L + i * slot} y={T} width={slot} height={H - T - B} className="xc-hit" />
                {bar(m.rev, 0, "xc-rev")}
                {bar(m.gp, bw + 2, "xc-gp")}
                <text x={L + i * slot + slot / 2} y={H - 8} className="xc-axis" textAnchor="middle">{monthLabel(m.month)}</text>
              </g>
            );
          })}
          <line x1={L} x2={W} y1={y(0)} y2={y(0)} className="xc-base" />
        </svg>
        {h && (
          <div className="xc-tip" style={{ left: `${((L + (hi! + 0.5) * slot) / W) * 100}%` }}>
            <strong>{new Date(`${h.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</strong>
            <span><i className="sw rev" />Revenue <b>{full(h.rev)}</b></span>
            <span><i className="sw gp" />Gross profit <b>{full(h.gp)}</b></span>
            <span>Margin <b>{h.rev ? `${((h.gp / h.rev) * 100).toFixed(1)}%` : "—"}</b></span>
          </div>
        )}
      </div>
    </figure>
  );
}

/**
 * A half-circle gauge: one ratio against a scale. The track and the fill are
 * one hue (light and full), the reading is ink, and the scale's ends are
 * written under it, so the arc is never the only carrier of the number.
 */
export function Gauge({ label, value, max, display, note, suffix = "%" }: {
  label: string; value: number | null; max: number; display?: string; note?: string; suffix?: string;
}) {
  const r = 70, cx = 90, cy = 86, sw = 12;
  const f = value == null ? 0 : Math.max(0, Math.min(1, value / max));
  const arc = (to: number) => {
    const a = Math.PI * (1 - to);
    return `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r * Math.cos(a)} ${cy - r * Math.sin(a)}`;
  };
  return (
    <figure className="xg" aria-label={`${label}: ${display ?? (value == null ? "no data" : `${value.toFixed(1)}${suffix}`)}`}>
      <svg viewBox="0 0 180 104" aria-hidden="true">
        <path d={arc(1)} className="xg-track" strokeWidth={sw} />
        {f > 0 && <path d={arc(f)} className="xg-fill" strokeWidth={sw} />}
        <text x={cx} y={cy - 14} textAnchor="middle" className="xg-value">
          {display ?? (value == null ? "—" : `${value.toFixed(1)}${suffix}`)}
        </text>
        <text x={cx - r} y={cy + 16} textAnchor="middle" className="xg-end">0</text>
        <text x={cx + r} y={cy + 16} textAnchor="middle" className="xg-end">{`${max}${suffix}`}</text>
      </svg>
      <figcaption><strong>{label}</strong>{note && <span>{note}</span>}</figcaption>
    </figure>
  );
}

export type RadarAxis = { label: string; score: number; reading: string; how: string };

/**
 * Business health on six axes, each scored 0–100 by a stated rule (the table
 * under it says how). One series, the score; the dashed ring at 70 is what a
 * healthy business reaches, so a dent shows where to look.
 */
export function HealthRadar({ axes }: { axes: RadarAxis[] }) {
  const [hi, setHi] = useState<number | null>(null);
  const S = 300, c = S / 2, R = 104, n = axes.length;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n, d = (R * Math.max(0, Math.min(100, v))) / 100;
    return [c + d * Math.cos(a), c + d * Math.sin(a)] as const;
  };
  const ring = (v: number) => axes.map((_, i) => pt(i, v).join(",")).join(" ");
  const h = hi == null ? null : axes[hi];
  return (
    <figure className="xr">
      <div className="xc-legend">
        <span><i className="sw rev" />Score</span>
        <span><i className="sw ring" />Healthy (70)</span>
      </div>
      <div className="xr-plot" onMouseLeave={() => setHi(null)}>
        <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label="Business health scores, 0 to 100">
          {[25, 50, 75, 100].map((v) => <polygon key={v} points={ring(v)} className="xr-grid" />)}
          {axes.map((_, i) => { const [x, y] = pt(i, 100); return <line key={i} x1={c} y1={c} x2={x} y2={y} className="xr-grid" />; })}
          <polygon points={ring(70)} className="xr-target" />
          <polygon points={axes.map((a, i) => pt(i, a.score).join(",")).join(" ")} className="xr-area" />
          {axes.map((a, i) => {
            const [x, y] = pt(i, a.score), [lx, ly] = pt(i, 124);
            return (
              <g key={a.label} onMouseEnter={() => setHi(i)} onFocus={() => setHi(i)} tabIndex={0}
                 aria-label={`${a.label}: ${Math.round(a.score)} of 100, ${a.reading}`}>
                <circle cx={x} cy={y} r={12} className="xc-hit" />
                <circle cx={x} cy={y} r={4.5} className="xr-dot" />
                <text x={lx} y={ly + 4} textAnchor={Math.abs(lx - c) < 8 ? "middle" : lx < c ? "end" : "start"} className="xr-label">
                  {a.label} <tspan className="xr-score">{Math.round(a.score)}</tspan>
                </text>
              </g>
            );
          })}
        </svg>
        {h && (
          <div className="xc-tip xr-tip">
            <strong>{h.label} · {Math.round(h.score)}/100</strong>
            <span>{h.reading}</span>
            <span className="xc-how">{h.how}</span>
          </div>
        )}
      </div>
    </figure>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const hourName = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;

/**
 * When the shop is busy: sales by weekday and hour, drawn the way GitHub
 * draws commits — a square per hour, darker for more sales. One hue, five
 * steps (none, then four quarters of the busiest hour); the legend reads
 * less to more, hover gives the count and takings, and a table follows.
 */
export function BusyHours({ cells }: { cells: { dow: number; hour: number; sales: number; amount: number }[] }) {
  const [hi, setHi] = useState<{ d: number; h: number } | null>(null);
  const at = new Map(cells.map((c) => [`${c.dow}-${c.hour}`, c]));
  const max = Math.max(1, ...cells.map((c) => c.sales));
  const step = (n: number) => (n <= 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
  const cur = hi ? at.get(`${hi.d}-${hi.h}`) : null;
  return (
    <figure className="xh">
      <div className="xh-grid" role="grid" aria-label="Sales by weekday and hour" onMouseLeave={() => setHi(null)}>
        <span className="xh-corner" aria-hidden="true" />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={`h${h}`} className="xh-hour" aria-hidden="true">{h % 3 === 0 ? hourName(h).replace(" ", "") : ""}</span>
        ))}
        {DAYS.map((day, i) => (
          <div key={day} role="row" className="xh-row">
            <span className="xh-day" role="rowheader">{day}</span>
            {Array.from({ length: 24 }, (_, h) => {
              const c = at.get(`${i + 1}-${h}`);
              const n = c?.sales ?? 0;
              return (
                <span key={h} role="gridcell" tabIndex={n ? 0 : -1}
                  className={`xh-cell s${step(n)}${hi && hi.d === i + 1 && hi.h === h ? " on" : ""}`}
                  aria-label={`${DAY_NAMES[i]} ${hourName(h)}: ${n} sale${n === 1 ? "" : "s"}`}
                  onMouseEnter={() => setHi({ d: i + 1, h })} onFocus={() => setHi({ d: i + 1, h })} />
              );
            })}
          </div>
        ))}
      </div>
      <div className="xh-foot">
        <span className="xh-read" aria-live="polite">
          {hi ? <><strong>{DAY_NAMES[hi.d - 1]}, {hourName(hi.h)}–{hourName((hi.h + 1) % 24)}</strong>
            {" "}{cur ? `${cur.sales} sale${cur.sales === 1 ? "" : "s"}, ${full(cur.amount)} MMK` : "no sales"}</>
            : "Point at an hour to see its sales."}
        </span>
        <span className="xh-legend" aria-hidden="true">Less <i className="xh-cell s0" /><i className="xh-cell s1" /><i className="xh-cell s2" /><i className="xh-cell s3" /><i className="xh-cell s4" /> More</span>
      </div>
    </figure>
  );
}

export type FlowNode = { id: string; label: string; value: number; col: number; tone: "keep" | "cost" | "neutral"; note?: string };
export type FlowLink = { from: string; to: string; value: number; tone: "keep" | "cost" | "neutral" };

/**
 * Where the money went: an income flow (Sankey). Each column is a stage —
 * revenue sources, revenue, cost of sales and gross profit, expenses and net
 * profit, expenses by account — and each band's width is its kyat. Money the
 * business keeps flows cobalt; what it pays out flows red. Every node carries
 * its amount and share of revenue in ink, so colour is never the only reading.
 */
export function IncomeFlow({ nodes, links, base }: { nodes: FlowNode[]; links: FlowLink[]; base: number }) {
  const [hi, setHi] = useState<string | null>(null);
  const cols = Math.max(...nodes.map((n) => n.col)) + 1;
  const W = 1160, pad = 26, nodeW = 10, gap = 14, labelRoom = 190, minSlot = 38, plotH = 380;
  const usableW = W - labelRoom - 10;
  const colX = (c: number) => 10 + (cols === 1 ? 0 : (c * (usableW - nodeW)) / (cols - 1));
  const byCol = Array.from({ length: cols }, (_, c) => nodes.filter((n) => n.col === c));
  const scale = Math.min(...byCol.filter((ns) => ns.length).map((ns) =>
    (plotH - gap * Math.max(0, ns.length - 1)) / Math.max(1, ns.reduce((t, n) => t + n.value, 0))));
  /* Every node gets at least room for its two lines of label; a small node
     sits at the top of its slot. The drawing grows taller rather than letting
     labels collide. */
  const slotOf = (n: FlowNode) => Math.max(minSlot, Math.max(2, n.value * scale));
  const colH = byCol.map((ns) => ns.reduce((t, n) => t + slotOf(n), 0) + gap * Math.max(0, ns.length - 1));
  const H = Math.max(plotH, ...colH) + pad * 2;
  const pos = new Map<string, { x: number; y: number; h: number; slot: number }>();
  byCol.forEach((ns, c) => {
    let y = (H - colH[c]) / 2;
    for (const n of ns) { const h = Math.max(2, n.value * scale), slot = slotOf(n); pos.set(n.id, { x: colX(c), y, h, slot }); y += slot + gap; }
  });
  const outAt = new Map<string, number>(), inAt = new Map<string, number>();
  const bands = links.filter((l) => l.value > 0 && pos.has(l.from) && pos.has(l.to)).map((l) => {
    const a = pos.get(l.from)!, b = pos.get(l.to)!, w = l.value * scale;
    const y0 = a.y + (outAt.get(l.from) ?? 0), y1 = b.y + (inAt.get(l.to) ?? 0);
    outAt.set(l.from, (outAt.get(l.from) ?? 0) + w); inAt.set(l.to, (inAt.get(l.to) ?? 0) + w);
    const x0 = a.x + nodeW, x1 = b.x, mx = (x0 + x1) / 2;
    const d = `M ${x0} ${y0} C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1} L ${x1} ${y1 + w} C ${mx} ${y1 + w}, ${mx} ${y0 + w}, ${x0} ${y0 + w} Z`;
    return { l, d };
  });
  const share = (v: number) => (base ? `${((v / base) * 100).toFixed(1)}%` : "");
  return (
    <figure className="xf">
      <div className="xc-legend">
        <span><i className="sw keep" />Kept by the business</span>
        <span><i className="sw cost" />Paid out</span>
        {nodes.some((n) => n.tone === "neutral") && <span><i className="sw neutral" />Sources of revenue</span>}
        <span className="xc-hint">Band width is the amount; percentages are of revenue</span>
      </div>
      <div className="xf-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Income flow from revenue to net profit">
          {bands.map(({ l, d }) => (
            <path key={`${l.from}-${l.to}`} d={d}
              className={`xf-band ${l.tone}${hi && hi !== l.from && hi !== l.to ? " dim" : ""}`} />
          ))}
          {nodes.map((n) => {
            const p = pos.get(n.id)!;
            const tx = p.x + nodeW + 8, ty = p.y + Math.max(p.h, minSlot) / 2;
            return (
              <g key={n.id} onMouseEnter={() => setHi(n.id)} onMouseLeave={() => setHi(null)} onFocus={() => setHi(n.id)} onBlur={() => setHi(null)}
                 tabIndex={0} aria-label={`${n.label}: ${full(n.value)} MMK, ${share(n.value)} of revenue`}>
                <rect x={p.x} y={p.y} width={nodeW} height={p.h} rx={2} className={`xf-node ${n.tone}`} />
                <text x={tx} y={ty - 7} className="xf-label">{n.label}</text>
                <text x={tx} y={ty + 10} className="xf-amount">{short(n.value)}<tspan className="xf-share">{n.note ?? `  ${share(n.value)}`}</tspan></text>
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}

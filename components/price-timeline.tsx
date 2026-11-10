"use client";

import {
  ResponsiveContainer, ComposedChart, Scatter, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

export type TimelinePoint = { t: number; price: number; qty: number; doc: string; partner: string };
export type TimelineBucket = { t: number; avg: number; band: [number, number]; lines: number };

const day = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
const kyat = (v: number) => Math.round(v).toLocaleString("en-US");


/**
 * One product's prices over time: every posted line as a dot, the
 * quantity-weighted average per period as the line through them, and the
 * period's low–high as a faint band. The dots keep the truth visible — an
 * average alone would hide one sale at half price.
 */
export function PriceTimeline({ points, buckets, label }: {
  points: TimelinePoint[]; buckets: TimelineBucket[]; label: string;
}) {
  // One array, sorted by time: dots carry `price`, period rows carry `avg`
  // and `band`. Separate per-series arrays drop points on a numeric axis.
  const data = [...points, ...buckets].sort((a, b) => a.t - b.t) as (Partial<TimelinePoint & TimelineBucket> & { t: number })[];
  return (
    <div role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 8, right: 28, left: 4, bottom: 0 }}>
          <CartesianGrid stroke="var(--line-soft)" vertical={false} />
          <XAxis
            dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} ticks={buckets.map((b) => b.t)} tickFormatter={day}
            axisLine={false} tickLine={false} minTickGap={28}
            tick={{ fill: "var(--muted)", fontSize: 11, fontFamily: "var(--mono)" }}
          />
          <YAxis
            type="number" domain={["auto", "auto"]} tickFormatter={kyat} width={78}
            axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }}
          />
          <Tooltip content={<Tip />} cursor={{ stroke: "var(--line)" }} />
          <Area dataKey="band" connectNulls stroke="none" fill="var(--chart-1)" fillOpacity={0.1} isAnimationActive={false} activeDot={false} />
          <Line dataKey="avg" connectNulls name="Average" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Scatter dataKey="price" name="Line" fill="var(--chart-1)" fillOpacity={0.5} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function Tip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as Partial<TimelinePoint & TimelineBucket>;
  return (
    <div className="card" style={{ padding: "0.45rem 0.65rem", fontSize: "0.78rem", boxShadow: "0 2px 8px rgba(0,0,0,0.12)" }}>
      <div style={{ color: "var(--muted)" }}>{day(p.t!)}</div>
      {p.doc ? (
        <>
          <div className="m"><strong>{kyat(p.price!)} MMK</strong> × {p.qty!.toLocaleString("en-US")}</div>
          <div style={{ color: "var(--muted)" }}>{p.doc} · {p.partner}</div>
        </>
      ) : (
        <>
          <div className="m"><strong>{kyat(p.avg!)} MMK</strong> average</div>
          <div style={{ color: "var(--muted)" }}>{kyat(p.band![0])} – {kyat(p.band![1])} · {p.lines} line{p.lines === 1 ? "" : "s"}</div>
        </>
      )}
    </div>
  );
}

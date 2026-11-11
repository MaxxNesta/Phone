"use client";

import {
  ResponsiveContainer, ComposedChart, Scatter, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

export type TimelinePoint = { t: number; price: number; qty: number; doc: string; partner: string };
export type TimelineBucket = { t: number; avg: number; band: [number, number]; lines: number; avgTax?: number };

const day = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
const kyat = (v: number) => Math.round(v).toLocaleString("en-US");


/**
 * One product's prices over time: every posted line as a dot, and the
 * price (quantity-weighted per day, week or month) as a step that holds
 * until it changes. The dots keep the truth visible: an average alone would
 * hide one sale at half price.
 */
export function PriceTimeline({ points, buckets, label }: {
  points: TimelinePoint[]; buckets: TimelineBucket[]; label: string;
}) {
  // Including tax only when some period carries tax; otherwise it is the same line twice.
  const taxed = buckets.some((b) => b.avgTax !== undefined && Math.abs(b.avgTax - b.avg) >= 0.5);
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
          {/* A step, not a slope: a price holds until the next purchase or
              sale changes it. A sloped line would invent prices in between. */}
          <Line dataKey="avg" type="stepAfter" connectNulls name="Average price" stroke="var(--pbi-main)" strokeWidth={2.25} dot={{ r: 3.5, fill: "var(--surface)", stroke: "var(--pbi-main)", strokeWidth: 2 }} isAnimationActive={false} />
          {taxed && <Line dataKey="avgTax" type="stepAfter" connectNulls name="Average price incl tax" stroke="var(--pbi-alt)" strokeWidth={2} dot={false} isAnimationActive={false} />}
          <Scatter dataKey="price" name="Line" fill="var(--pbi-alt)" fillOpacity={0.45} isAnimationActive={false} />
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
          <div className="m"><strong>{kyat(p.avg!)} MMK</strong> average price</div>
          {p.avgTax !== undefined && Math.abs(p.avgTax - p.avg!) >= 0.5 && <div className="m">{kyat(p.avgTax)} MMK incl tax</div>}
          <div style={{ color: "var(--muted)" }}>{p.lines} line{p.lines === 1 ? "" : "s"}{p.band![0] !== p.band![1] && <> · from {kyat(p.band![0])} to {kyat(p.band![1])}</>}</div>
        </>
      )}
    </div>
  );
}

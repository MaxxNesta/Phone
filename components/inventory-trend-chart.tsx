"use client";

import {
  ResponsiveContainer, ComposedChart, Area, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
} from "recharts";
import { money } from "@/lib/format";

export type InvPoint = { month: string; value: number; received: number; cogs: number };

const IN = "color-mix(in srgb, var(--chart-3) 75%, transparent)";
const OUT = "color-mix(in srgb, var(--chart-4) 75%, transparent)";

const short = (n: number) => {
  const a = Math.abs(n);
  return a >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(n / 1e6).toFixed(0)}M` : a >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${n}`;
};
const monthOf = (ym: string, long = false) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: long ? "long" : "short", year: long ? "numeric" : undefined, timeZone: "UTC" });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Tip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as InvPoint;
  return (
    <div className="combo-tip">
      <div className="combo-tip-day">End of {monthOf(p.month, true)}</div>
      <div><i style={{ background: "var(--chart-1)" }} />Stock value <b>{money(p.value)}</b></div>
      <div><i style={{ background: IN }} />Stock in <b>{money(p.received)}</b></div>
      <div><i style={{ background: OUT }} />Cost of sales <b>{money(p.cogs)}</b></div>
    </div>
  );
}

/**
 * What the shelves were worth at each month's end, and why it moved: stock
 * brought in and stock sold at cost, as a pair of thin bars along the floor.
 * A month where the green bar is taller built stock; where the rose one is,
 * it ran stock down.
 */
export function InventoryTrendChart({ data, height = 260 }: { data: InvPoint[]; height?: number }) {
  const flows = Math.max(1, ...data.flatMap((d) => [d.received, d.cogs]));
  const last = data.length - 1;
  return (
    <>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 24, right: 16, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid stroke="var(--line-soft)" vertical={false} />
          <XAxis dataKey="month" axisLine={false} tickLine={false} tickFormatter={(v) => monthOf(v)}
            tick={{ fill: "var(--muted)", fontSize: 11 }} dy={6} />
          <YAxis yAxisId="v" axisLine={false} tickLine={false} width={44} tickFormatter={short}
            tick={{ fill: "var(--muted)", fontSize: 11 }} />
          {/* Flows on their own scale, kept to the lower third. */}
          <YAxis yAxisId="f" orientation="right" hide domain={[0, flows * 3]} />
          <Tooltip content={<Tip />} cursor={{ stroke: "var(--line)" }} />
          <Bar yAxisId="f" dataKey="received" fill={IN} radius={[4, 4, 4, 4]} maxBarSize={8} />
          <Bar yAxisId="f" dataKey="cogs" fill={OUT} radius={[4, 4, 4, 4]} maxBarSize={8} />
          <Area yAxisId="v" type="monotone" dataKey="value" stroke="var(--chart-1)" strokeWidth={2}
            fill="color-mix(in srgb, var(--chart-1) 8%, transparent)"
            dot={(p: { cx?: number; cy?: number; index?: number }) => p.index === last && p.cx != null && p.cy != null
              ? <circle key="last" cx={p.cx} cy={p.cy} r={4.5} fill="var(--chart-1)" stroke="var(--surface)" strokeWidth={2} />
              : <g key={`d${p.index}`} />}
            activeDot={{ r: 4, fill: "var(--chart-1)", stroke: "var(--surface)", strokeWidth: 2 }}>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <LabelList dataKey="value" content={(p: any) =>
              p.index === last ? (
                <text x={Number(p.x)} y={Number(p.y) - 12} textAnchor="end" fontSize={11} fontWeight={600} fill="var(--ink)">
                  {short(Number(p.value))}
                </text>
              ) : null} />
          </Area>
        </ComposedChart>
      </ResponsiveContainer>
      <div className="combo-key" aria-hidden="true">
        <span><i style={{ background: "var(--chart-1)" }} />Stock value at month end</span>
        <span><i style={{ background: IN }} />Stock in</span>
        <span><i style={{ background: OUT }} />Cost of sales</span>
      </div>
    </>
  );
}

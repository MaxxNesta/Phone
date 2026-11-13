"use client";

import {
  ResponsiveContainer, ComposedChart, Area, Line, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { money } from "@/lib/format";

export type ComboPoint = { day: string; revenue: number; profit: number; customers: number };

/* Soft traffic light for the customer bars: against the average of the
   buckets before it, busier is green, about the same is yellow, quieter is
   red. Like a MACD histogram — the colour is the movement, the height the count. */
export const BUSY = "color-mix(in srgb, #34C759 55%, transparent)";
export const SAME = "color-mix(in srgb, #FFCC00 65%, transparent)";
export const QUIET = "color-mix(in srgb, #FF3B30 45%, transparent)";
function tone(rows: ComboPoint[], i: number) {
  const prev = rows.slice(Math.max(0, i - 7), i).map((r) => r.customers);
  if (prev.length === 0) return SAME;
  const avg = prev.reduce((a, b) => a + b, 0) / prev.length;
  const v = rows[i].customers;
  if (avg === 0) return v > 0 ? BUSY : SAME;
  return v >= avg * 1.1 ? BUSY : v <= avg * 0.9 ? QUIET : SAME;
}

const short = (n: number) => {
  const a = Math.abs(n);
  return a >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(n / 1e6).toFixed(0)}M`
    : a >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${n}`;
};
const label = (s: string, week: boolean) => {
  const d = new Date(`${s}T00:00:00Z`);
  return (week ? "w/c " : "") + d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Tip({ active, payload, week, showProfit }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as ComboPoint;
  return (
    <div className="combo-tip">
      <div className="combo-tip-day">{label(p.day, week)}</div>
      <div><i style={{ background: "var(--blue)" }} />Net sales <b>{money(p.revenue)}</b></div>
      {showProfit && <div><i style={{ background: "#AEAEB2" }} />Gross profit <b>{money(p.profit)}</b></div>}
      <div><i style={{ background: "#34C759" }} />Customers <b>{p.customers}</b></div>
    </div>
  );
}

/**
 * Net sales as a line over a light wash, gross profit as a grey line, and
 * customers as soft bars along the floor: three measures on one time axis.
 * Flat on purpose. No glow, no gradient stroke; the data is the decoration.
 */
export function SalesComboChart({ data, week = false, height = 280, showProfit = true }: {
  data: ComboPoint[]; week?: boolean; height?: number; showProfit?: boolean;
}) {
  const maxC = Math.max(1, ...data.map((d) => d.customers));
  const every = Math.max(0, Math.ceil(data.length / 8) - 1);
  return (
    <>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--line-soft)" vertical={false} />
          <XAxis dataKey="day" axisLine={false} tickLine={false} interval={every}
            tickFormatter={(v) => label(v, week)} tick={{ fill: "var(--muted)", fontSize: 11 }} dy={6} />
          <YAxis yAxisId="m" axisLine={false} tickLine={false} width={44}
            tickFormatter={short} tick={{ fill: "var(--muted)", fontSize: 11 }} />
          {/* Customers on their own scale, kept to the bottom quarter. */}
          <YAxis yAxisId="c" orientation="right" hide domain={[0, maxC * 4]} />
          <Tooltip content={<Tip week={week} showProfit={showProfit} />} cursor={{ stroke: "var(--line)" }} />
          <Bar yAxisId="c" dataKey="customers" radius={[2, 2, 0, 0]} maxBarSize={14}>
            {data.map((_, i) => <Cell key={i} fill={tone(data, i)} />)}
          </Bar>
          <Area yAxisId="m" type="monotone" dataKey="revenue" stroke="var(--blue)" strokeWidth={2}
            fill="color-mix(in srgb, var(--blue) 7%, transparent)" dot={false}
            activeDot={{ r: 4, fill: "var(--blue)", stroke: "#fff", strokeWidth: 2 }} />
          {showProfit && (
            <Line yAxisId="m" type="monotone" dataKey="profit" stroke="#AEAEB2" strokeWidth={1.5} dot={false}
              activeDot={{ r: 3, fill: "#AEAEB2", stroke: "#fff", strokeWidth: 2 }} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      <div className="combo-key" aria-hidden="true">
        <span><i style={{ background: BUSY }} />Busier than the week before</span>
        <span><i style={{ background: SAME }} />About the same</span>
        <span><i style={{ background: QUIET }} />Quieter</span>
      </div>
    </>
  );
}

/** The legend over the chart: each measure, its total, and its change. */
export function ComboLegend({ items }: {
  items: { color: string; label: string; value: string; delta?: { text: string; good: boolean } | null; note?: string }[];
}) {
  return (
    <div className="combo-legend">
      {items.map((it) => (
        <div key={it.label} className="combo-legend-item">
          <span className="combo-legend-label"><i style={{ background: it.color }} />{it.label}</span>
          <span className="combo-legend-value">
            {it.value}
            {it.delta && <span className={`combo-delta ${it.delta.good ? "up" : "down"}`}>{it.delta.text}</span>}
            {it.note && <span className="combo-note">{it.note}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

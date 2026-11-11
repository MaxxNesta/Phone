"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList } from "recharts";

export type GroupBar = { label: string; avg: number; avgTax: number | null; qty: number };

const kyat = (v: number) => Math.round(v).toLocaleString("en-US");
const short = (v: number) => (v >= 1e6 ? `${+(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(0)}K` : `${Math.round(v)}`);

/**
 * Average price per group as horizontal bars, the report's way: the price
 * including tax in teal over the price before tax in slate, when there is
 * tax; one bar when there is not. Each bar carries its figure, because bars
 * of a few percent apart look the same from zero.
 */
export function GroupBars({ data, empty }: { data: GroupBar[]; empty: string }) {
  if (data.length === 0) return <p className="pbi-empty">{empty}</p>;
  const taxed = data.some((d) => d.avgTax !== null && Math.abs(d.avgTax - d.avg) >= 0.5);
  const h = Math.max(120, data.length * (taxed ? 46 : 32) + 40);
  return (
    <>
      {taxed && (
        <p className="pbi-legend"><i style={{ background: "var(--pbi-teal)" }} /> Average price incl tax <i style={{ background: "var(--pbi-slate)" }} /> Average price</p>
      )}
      <ResponsiveContainer width="100%" height={h}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, left: 0, bottom: 0 }} barGap={2} barCategoryGap={taxed ? "28%" : "36%"}>
          <CartesianGrid stroke="var(--line-soft)" horizontal={false} />
          <XAxis type="number" tickFormatter={short} axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 10 }} />
          <YAxis type="category" dataKey="label" width={112} axisLine={false} tickLine={false}
            tick={{ fill: "var(--ink)", fontSize: 11 }} />
          <Tooltip cursor={{ fill: "var(--line-soft)" }} content={<Tip />} />
          {taxed && (
            <Bar dataKey="avgTax" name="Average price incl tax" fill="var(--pbi-teal)" isAnimationActive={false}>
              <LabelList dataKey="avgTax" position="right" formatter={(v: unknown) => short(Number(v))} style={{ fill: "var(--muted)", fontSize: 10 }} />
            </Bar>
          )}
          <Bar dataKey="avg" name="Average price" fill={taxed ? "var(--pbi-slate)" : "var(--pbi-teal)"} isAnimationActive={false}>
            <LabelList dataKey="avg" position="right" formatter={(v: unknown) => short(Number(v))} style={{ fill: "var(--muted)", fontSize: 10 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

function Tip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as GroupBar;
  return (
    <div className="card" style={{ padding: "0.45rem 0.65rem", fontSize: "0.78rem", boxShadow: "0 2px 8px rgba(0,0,0,0.12)" }}>
      <div><strong>{d.label}</strong></div>
      <div className="m">{kyat(d.avg)} MMK average</div>
      {d.avgTax !== null && Math.abs(d.avgTax - d.avg) >= 0.5 && <div className="m">{kyat(d.avgTax)} MMK incl tax</div>}
      <div style={{ color: "var(--muted)" }}>{d.qty.toLocaleString("en-US")} units</div>
    </div>
  );
}

"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, Cell } from "recharts";
import { money } from "@/lib/format";

/** Seven days of sales; today in full brand colour, the rest tinted. */
export function WeekBars({ data }: { data: { label: string; revenue: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <XAxis dataKey="label" axisLine={false} tickLine={false}
          tick={{ fill: "var(--muted)", fontSize: 12 }} />
        <Tooltip cursor={{ fill: "var(--brand-weak)" }}
          formatter={(v) => [`${money(Number(v))} MMK`, "Sales"]} />
        <Bar dataKey="revenue" radius={[8, 8, 8, 8]} maxBarSize={56}>
          {data.map((d, i) => (
            <Cell key={d.label + i}
              fill={i === data.length - 1 ? "var(--chart-1)" : "color-mix(in srgb, var(--chart-1) 22%, transparent)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, Cell } from "recharts";
import { money } from "@/lib/format";
import { useTranslations } from "next-intl";

/**
 * Seven days of sales: today in full blue, earlier days in a tint of it.
 * Today is also named — its day in bold blue under the bars and in the
 * legend — so telling it apart never rests on colour alone, which in dark
 * mode is exactly what failed.
 */
export function WeekBars({ data }: { data: { label: string; revenue: number }[] }) {
  const t = useTranslations("dashboard");
  const last = data.length - 1;
  return (
    <>
      <div className="wk-legend" aria-hidden="true">
        <span><i style={{ background: "var(--chart-1)" }} />{t("today")}</span>
        <span><i style={{ background: "var(--bar-past)" }} />{t("earlierDays")}</span>
      </div>
      <ResponsiveContainer width="100%" height={244}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <XAxis dataKey="label" axisLine={false} tickLine={false} interval={0}
            tick={(p: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
              <text x={p.x} y={p.y + 12} textAnchor="middle" fontSize={12}
                fill={p.index === last ? "var(--chart-1)" : "var(--muted)"} fontWeight={p.index === last ? 700 : 400}>
                {p.payload.value}{p.index === last ? ` · ${t("today")}` : ""}
              </text>
            )} />
          <Tooltip cursor={{ fill: "var(--brand-weak)" }}
            formatter={(v) => [`${money(Number(v))} MMK`, t("sales")]} />
          <Bar dataKey="revenue" radius={[8, 8, 8, 8]} maxBarSize={18}>
            {data.map((d, i) => (
              <Cell key={d.label + i} fill={i === last ? "var(--chart-1)" : "var(--bar-past)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

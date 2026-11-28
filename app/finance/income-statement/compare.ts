import { getAccountTree, getIncomeStatementByPeriod } from "@/lib/queries";
import type { ChartRow } from "@/lib/report-tree";
import { periodsOf, sectionRows, type Grain } from "@/lib/statement-compare";
import { shapeIncome } from "./data";

export { GRAINS, type Grain, type CompareRow } from "@/lib/statement-compare";

/**
 * The income statement side by side by month, quarter or year (2026-11-28).
 *
 * Each column is shapeIncome over that period's amounts — the statement for
 * that period, not a second calculation — and the rows are laid out once,
 * from the whole range, so an account busy in March and quiet in June keeps
 * its row in June with a nought. Two reads whatever the number of columns:
 * the lines by period and the chart.
 */
export async function getIncomeCompare(companyId: string, range: { from: string; to: string }, grain: Grain, branchId: string | null) {
  const [lines, chartRaw] = await Promise.all([
    getIncomeStatementByPeriod(companyId, range.from, range.to, grain, branchId),
    getAccountTree(companyId),
  ]);
  const chart = chartRaw as unknown as ChartRow[];
  const periods = periodsOf(range.from, range.to, grain);
  const byPeriod = new Map(periods.map((p) => [p.key, new Map<string, number>()]));
  const all = new Map<string, number>();
  for (const l of lines) {
    const v = Number(l.amount);
    const m = byPeriod.get(l.period);
    if (m) m.set(l.id, (m.get(l.id) ?? 0) + v);
    all.set(l.id, (all.get(l.id) ?? 0) + v);
  }
  const whole = shapeIncome(chart, all);
  const shapes = periods.map((p) => shapeIncome(chart, byPeriod.get(p.key)!));
  const rows = sectionRows(whole, shapes, (k) => (k === "REVENUE" || k === "OTHER" ? 1 : -1));

  return {
    periods, rows,
    chart: periods.map((p, i) => ({ label: p.label, revenue: shapes[i].revenue, gross: shapes[i].grossProfit, net: shapes[i].netIncome })),
    totals: { revenue: whole.revenue, gross: whole.grossProfit, net: whole.netIncome },
  };
}

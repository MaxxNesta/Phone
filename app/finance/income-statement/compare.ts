import { getAccountTree, getIncomeStatementByPeriod } from "@/lib/queries";
import type { ChartRow, StatementNode } from "@/lib/report-tree";
import { shapeIncome } from "./data";

/**
 * The income statement side by side by month, quarter or year (2026-11-28).
 *
 * Each column is shapeIncome over that period's amounts — the statement for
 * that period, not a second calculation — and the rows are laid out once,
 * from the whole range, so an account busy in March and quiet in June keeps
 * its row in June with a nought. Two reads whatever the number of columns:
 * the lines by period and the chart.
 */
export type Grain = "month" | "quarter" | "year";
export const GRAINS: Record<Grain, string> = { month: "Monthly", quarter: "Quarterly", year: "Yearly" };

export type CompareRow = {
  key: string;
  kind: "section" | "group" | "account" | "total" | "subtotal";
  label: string;
  code?: string;
  depth: number;
  /** The groups above it, so folding one hides everything under it. */
  under: string[];
  /** +1 when a rise is good for profit (revenue, profits), −1 when it is bad (costs). */
  better: 1 | -1;
  strong?: boolean;
  values: number[];
  total: number;
};

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Every period from the one holding `from` to the one holding `to`, empty ones included. */
function periodsOf(from: string, to: string, grain: Grain) {
  const out: { key: string; label: string }[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  if (grain === "quarter") m = Math.floor((m - 1) / 3) * 3 + 1;
  if (grain === "year") m = 1;
  while (y < ty || (y === ty && m <= tm)) {
    out.push({
      key: `${y}-${String(m).padStart(2, "0")}-01`,
      label: grain === "month" ? `${MONTH[m - 1]} ${y}` : grain === "quarter" ? `Q${(m + 2) / 3} ${y}` : String(y),
    });
    const step = grain === "month" ? 1 : grain === "quarter" ? 3 : 12;
    m += step; while (m > 12) { m -= 12; y += 1; }
  }
  return out;
}

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

  // Each column's figures by row: a node by its id, a section total by its key, a subtotal by its label.
  const index = (sh: ReturnType<typeof shapeIncome>) => {
    const m = new Map<string, number>();
    const walk = (ns: StatementNode[]) => { for (const n of ns) { m.set(`n:${n.id}`, n.amount); walk(n.children); } };
    for (const s of sh.sections) { walk(s.nodes); m.set(`t:${s.key}`, s.total); }
    for (const t of sh.subtotals) m.set(`s:${t.label}`, t.value);
    return m;
  };
  const cols = shapes.map(index);
  const wholeIdx = index(whole);
  const row = (key: string, r: Omit<CompareRow, "values" | "total" | "key">): CompareRow =>
    ({ key, ...r, values: cols.map((c) => c.get(key) ?? 0), total: wholeIdx.get(key) ?? 0 });

  const rows: CompareRow[] = [];
  for (const s of whole.sections) {
    const better = s.key === "REVENUE" || s.key === "OTHER" ? 1 : -1;
    rows.push({ key: `h:${s.key}`, kind: "section", label: s.label, depth: 0, under: [], better, values: [], total: 0 });
    const walk = (ns: StatementNode[], depth: number, under: string[]) => {
      for (const n of ns) {
        const k = `n:${n.id}`;
        rows.push(row(k, { kind: n.children.length ? "group" : "account", label: n.name, code: n.code, depth, under, better }));
        if (n.children.length) walk(n.children, depth + 1, [...under, k]);
      }
    };
    walk(s.nodes, 1, []);
    rows.push(row(`t:${s.key}`, { kind: "total", label: s.totalLabel, depth: 0, under: [], better }));
    for (const t of whole.subtotals.filter((x) => x.after === s.key))
      rows.push(row(`s:${t.label}`, { kind: "subtotal", label: t.label, depth: 0, under: [], better: 1, strong: t.strong }));
  }

  return {
    periods, rows,
    chart: periods.map((p, i) => ({ label: p.label, revenue: shapes[i].revenue, gross: shapes[i].grossProfit, net: shapes[i].netIncome })),
    totals: { revenue: whole.revenue, gross: whole.grossProfit, net: whole.netIncome },
  };
}

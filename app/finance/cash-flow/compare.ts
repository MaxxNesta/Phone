import { getCashFlowByPeriod } from "@/lib/queries";
import { getIndirectCashFlow, type IndirectLine } from "@/lib/indirect-cash-flow";
import { periodsOf, type CompareRow, type Grain, type Period } from "@/lib/statement-compare";
import { SECTIONS } from "./data";

/**
 * The cash flow statement by month, quarter or year (2026-11-28), both
 * methods. Cash flow figures carry their own sign — money in positive, out
 * negative — so a rise is good on every line and the Change arrows read
 * "better" as "more cash".
 */
type Out = { periods: Period[]; rows: CompareRow[]; chart: { label: string; operating: number; investing: number; financing: number }[];
  totals: { netChange: number; beginning: number; ending: number } };

const line = (key: string, kind: CompareRow["kind"], label: string, values: number[], total: number, strong?: boolean): CompareRow =>
  ({ key, kind, label, depth: kind === "account" ? 1 : 0, under: [], better: 1, values, total, strong });
const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0);

/** Direct method: the statement's own categories, two reads for every column. */
export async function getDirectCompare(companyId: string, range: { from: string; to: string }, grain: Grain, branchId: string | null): Promise<Out> {
  const periods = periodsOf(range.from, range.to, grain);
  const { rows, cash } = await getCashFlowByPeriod(companyId, range.from, range.to, grain, branchId);
  const at = new Map(periods.map((p, i) => [p.key, i]));
  const out: CompareRow[] = [];
  const net: Record<string, number[]> = {};
  for (const sec of SECTIONS) {
    const mine = rows.filter((r) => r.section === sec.key);
    const cats = [...new Set(mine.map((r) => r.category))].sort();
    const totals = periods.map(() => 0);
    if (cats.length) out.push(line(`h:${sec.key}`, "section", sec.label, [], 0));
    for (const c of cats) {
      const vals = periods.map(() => 0);
      for (const r of mine.filter((x) => x.category === c)) { const i = at.get(r.period); if (i !== undefined) vals[i] += Number(r.amount); }
      vals.forEach((v, i) => { totals[i] += v; });
      out.push({ ...line(`c:${sec.key}:${c}`, "account", c, vals, sum(vals)), drill: c });
    }
    net[sec.key] = totals;
    if (cats.length) out.push(line(`t:${sec.key}`, "total", `Net ${sec.label.toLowerCase()}`, totals, sum(totals)));
  }
  const change = periods.map((_, i) => SECTIONS.reduce((t, s) => t + net[s.key][i], 0));
  // Cash and bank as the ledger holds it: before the range, then period by period.
  let bal = Number(cash.find((c) => c.period === "open")?.balance ?? 0);
  const begin: number[] = [], end: number[] = [];
  for (const p of periods) { begin.push(bal); bal += Number(cash.find((c) => c.period === p.key)?.balance ?? 0); end.push(bal); }
  out.push(line("s:change", "subtotal", "Net change in cash", change, sum(change), true));
  out.push(line("s:begin", "total", "Cash at beginning of period", begin, begin[0] ?? 0));
  out.push(line("s:end", "subtotal", "Cash at end of period", end, end[end.length - 1] ?? 0));
  return {
    periods, rows: out,
    chart: periods.map((p, i) => ({ label: p.label, operating: net.operating[i], investing: net.investing[i], financing: net.financing[i] })),
    totals: { netChange: sum(change), beginning: begin[0] ?? 0, ending: end[end.length - 1] ?? 0 },
  };
}

/**
 * Indirect method: the indirect statement itself, once a period, side by side.
 * ponytail: one call a period (five reads each, run together) — fine for a
 * year of months; a multi-year monthly range is the ceiling, and the upgrade
 * is grouping its reads by period the way the direct method does.
 */
export async function getIndirectCompare(companyId: string, range: { from: string; to: string }, grain: Grain, branchId: string | null): Promise<Out> {
  const periods = periodsOf(range.from, range.to, grain);
  const [whole, ...cols] = await Promise.all([
    getIndirectCashFlow(companyId, range.from, range.to, branchId),
    ...periods.map((p) => getIndirectCashFlow(companyId, p.from, p.to, branchId)),
  ]);
  const out: CompareRow[] = [];
  const parts = [["operating", "Operating activities", "netOperating", "Net cash from operating activities"],
                 ["investing", "Investing activities", "netInvesting", "Net cash from investing activities"],
                 ["financing", "Financing activities", "netFinancing", "Net cash from financing activities"]] as const;
  for (const [k, label, netKey, netLabel] of parts) {
    // Lines in the whole range's order; one only some periods have is added where it falls.
    const order: IndirectLine[] = [...whole[k]];
    for (const c of cols) for (const l of c[k]) if (!order.some((o) => o.key === l.key)) order.push(l);
    out.push(line(`h:${k}`, "section", label, [], 0));
    for (const l of order) {
      const vals = cols.map((c) => c[k].find((x) => x.key === l.key)?.amount ?? 0);
      const r = line(`l:${k}:${l.key}`, l.bold ? "total" : "account", l.label, vals, whole[k].find((x) => x.key === l.key)?.amount ?? 0);
      if (!l.bold) r.depth = l.indent ? 2 : 1;
      if (l.drill) r.drill = l.key;
      out.push(r);
    }
    out.push(line(`t:${k}`, "total", netLabel, cols.map((c) => c[netKey]), whole[netKey]));
  }
  out.push(line("s:change", "subtotal", "Net change in cash", cols.map((c) => c.netChange), whole.netChange, true));
  out.push(line("s:begin", "total", "Cash at beginning of period", cols.map((c) => c.beginningCash), whole.beginningCash));
  out.push(line("s:end", "subtotal", "Cash at end of period", cols.map((c) => c.endingCash), whole.endingCash));
  return {
    periods, rows: out,
    chart: periods.map((p, i) => ({ label: p.label, operating: cols[i].netOperating, investing: cols[i].netInvesting, financing: cols[i].netFinancing })),
    totals: { netChange: whole.netChange, beginning: whole.beginningCash, ending: whole.endingCash },
  };
}

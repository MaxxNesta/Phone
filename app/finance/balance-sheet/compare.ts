import { sql } from "@/lib/db";
import { getAccountTree, getBalanceSheetByPeriod } from "@/lib/queries";
import type { ChartRow } from "@/lib/report-tree";
import { periodsOf, sectionRows, type Grain } from "@/lib/statement-compare";
import { shapeBalance } from "./data";

/**
 * The balance sheet at the end of each month, quarter or year (2026-11-28).
 * A balance sheet is a date, not a period, so each column is the statement as
 * at its period's last day (or the range's end, for the last): the opening
 * balance plus every movement up to it, run through shapeBalance — the same
 * presentation as the dated statement, clearing accounts and unclosed
 * earnings included. Three reads whatever the number of columns.
 */
const DEBIT = new Set(["ASSET", "COGS", "EXPENSE"]);
const POSITION = new Set(["ASSET", "LIABILITY", "EQUITY"]);

export async function getBalanceCompare(companyId: string, range: { from: string; to: string }, grain: Grain, branchId: string | null) {
  const [lines, chartRaw, clearing] = await Promise.all([
    getBalanceSheetByPeriod(companyId, range.from, range.to, grain, branchId),
    getAccountTree(companyId),
    sql`select account_id from system_account
         where company_id = ${companyId} and role in ('GRIR_CLEARING', 'LANDED_COST_CLEARING', 'SHIPPED_NOT_INVOICED')`,
  ]);
  const chart = chartRaw as unknown as ChartRow[];
  const clearingIds = new Set(clearing.map((r) => r.account_id as string));
  const periods = periodsOf(range.from, range.to, grain);
  const accounts = new Map<string, { id: string; code: string; name: string; account_type: string }>();
  for (const l of lines) accounts.set(l.id, l);

  // Running balances, raw (debit positive), carried from one column to the next.
  const run = new Map<string, number>();
  const add = (period: string) => { for (const l of lines) if (l.period === period) run.set(l.id, (run.get(l.id) ?? 0) + Number(l.raw)); };
  add("open");
  const seen = new Set<string>();   // every balance-sheet account any column carried
  let last: { typed: { id: string; code: string; name: string; account_type: string; amount: number }[]; netIncome: number } = { typed: [], netIncome: 0 };
  const shapes = periods.map((p) => {
    add(p.key);
    const typed = [...run].filter(([id, v]) => POSITION.has(accounts.get(id)!.account_type) && Math.abs(v) >= 0.00005)
      .map(([id, v]) => { const a = accounts.get(id)!; return { ...a, amount: DEBIT.has(a.account_type) ? v : -v }; });
    for (const t of typed) seen.add(t.id);
    // Earnings not yet closed to equity: the running net of revenue less costs.
    const netIncome = -[...run].filter(([id]) => !POSITION.has(accounts.get(id)!.account_type)).reduce((t, [, v]) => t + v, 0);
    last = { typed, netIncome };
    return shapeBalance(chart, typed, netIncome, clearingIds);
  });
  // Rows laid out over every account any column carried — one emptied by the
  // end still keeps its row — with the latest date's figures.
  const latest = new Map(last.typed.map((t) => [t.id, t]));
  const whole = shapeBalance(chart, [...seen].map((id) => latest.get(id) ?? { ...accounts.get(id)!, amount: 0 }), last.netIncome, clearingIds);
  const rows = sectionRows(whole, shapes, (k) => (k === "LIABILITY" ? -1 : 1));
  return {
    periods: periods.map((p) => ({ key: p.key, label: p.label, asOf: p.to })), rows,
    chart: periods.map((p, i) => ({ label: p.label, assets: shapes[i].assets, liabilities: shapes[i].liabilities, equity: shapes[i].equity })),
    latest: { assets: whole.assets, liabilities: whole.liabilities, equity: whole.equity, balanced: whole.balanced },
  };
}

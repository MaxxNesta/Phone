import Link from "next/link";
import { compact } from "@/components/stat";
import { SalesComboChart, ComboLegend, type ComboPoint } from "@/components/sales-combo-chart";

type Totals = { revenue: number; profit: number; customers: number };

/** "▲ 12.5%" against the period before; nothing when there is nothing to compare. */
export function change(now: number, before: number) {
  if (before === 0) return null;
  const pct = ((now - before) / Math.abs(before)) * 100;
  return { text: `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%`, good: pct >= 0 };
}

/**
 * The sales card the dashboards share: thirty days of net sales, gross profit
 * and customers on one chart, each total against the thirty days before, and
 * the way into the full sales report for the same days.
 */
export function SalesComboCard({ title, rows, now, before, from, to, showProfit, withReport = true }: {
  title: string; rows: ComboPoint[]; now: Totals; before: Totals; from: string; to: string; showProfit: boolean;
  /** The detailed sales report is not in every package. */
  withReport?: boolean;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <span><h2>{title}</h2><span className="page-sub combo-sub">Last 30 days · MMK</span></span>
        {withReport && <Link href={{ pathname: "/sales/reports", query: { from, to } }} className="subline">Sales report →</Link>}
      </div>
      <div className="card-body">
        <ComboLegend items={[
          { color: "var(--blue)", label: "Net sales", value: compact(now.revenue), delta: change(now.revenue, before.revenue), note: "vs prior 30 days" },
          ...(showProfit ? [{ color: "#AEAEB2", label: "Gross profit", value: compact(now.profit), delta: change(now.profit, before.profit) }] : []),
          { color: "#34C759", label: "Customers", value: String(now.customers), delta: change(now.customers, before.customers) },
        ]} />
        <SalesComboChart data={rows} height={240} showProfit={showProfit} />
      </div>
    </div>
  );
}

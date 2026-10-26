import Link from "next/link";
import { Clock, Layers, CalendarDays, Settings, Search, Smartphone, AlertTriangle, TrendingUp } from "lucide-react";
import { BranchScope } from "@/components/branch-scope";
import { seenLocations } from "@/lib/branch-scope";
import { requirePermission, can } from "@/lib/auth";
import { sql } from "@/lib/db";
import { agingReport, bucketRanges, type Pace } from "@/lib/aging";
import { money } from "@/lib/format";
import { paginate } from "@/lib/paging";
import { Pager } from "@/components/pager";
import { HelpHint } from "@/components/help-hint";
import { AutoApply } from "@/components/auto-apply";

export const metadata = { title: "Inventory Aging" };

const PACE: Record<Pace, string> = { FAST: "Fast", MODERATE: "Moderate", SLOW: "Slow", NONE: "No sales" };
const n0 = (v: number) => Math.round(v).toLocaleString("en-US");

/**
 * How long the stock on hand has waited, and, separately, how fast it sells.
 *
 * Age is when each unit was received, sorted into the shop's own four groups
 * (Settings). Pace is days of stock at the 90-day selling rate. They are two
 * answers: a phone received last week that has not sold is fresh and slow.
 */
export default async function InventoryAging({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await requirePermission("reports.view");
  const seeCost = can(user, "cost.view");
  const co = user.companyId;
  const locs = await seenLocations();

  const [report, groups, branches] = await Promise.all([
    agingReport(co, locs, { q: sp.q || undefined, groupId: sp.category || undefined, branchId: sp.branch || undefined }),
    sql`select id, name from item_group where company_id = ${co} and parent_id is null order by name`,
    sql`select distinct coalesce(br.id, l.id) as id, coalesce(br.name, l.name) as name
          from location l left join location br on br.id = l.parent_id
         where l.company_id = ${co} and l.is_stock_location and l.is_active
           ${locs ? sql`and l.id = any(${locs})` : sql``} order by 2`,
  ]);
  const { rows, rules, pace } = report;
  const labels = rules.labels;
  const ranges = bucketRanges(rules.thresholds);

  // By value where cost may be seen; by units otherwise.
  const measure = (r: (typeof rows)[number]) => (seeCost ? r.value4 : r.units4);
  const total4 = [0, 1, 2, 3].map((b) => rows.reduce((s, r) => s + measure(r)[b], 0));
  const total = total4.reduce((s, v) => s + v, 0);
  const units = rows.reduce((s, r) => s + r.units, 0);
  const oldUnits = rows.reduce((s, r) => s + r.units4[3], 0);
  const oldValue = rows.reduce((s, r) => s + r.value4[3], 0);
  const agedValue = rows.reduce((s, r) => s + r.value4[2] + r.value4[3], 0);
  const avgAge = units ? Math.round(rows.reduce((s, r) => s + r.ageSum, 0) / units) : 0;
  const multiBranch = branches.length > 1;

  // Three plain sentences the table would take a minute to say.
  const slowest = [...rows].filter((r) => r.units > 0).sort((a, b) => b.avgAge - a.avgAge)[0];
  const healthy = [...rows].filter((r) => r.pace === "FAST").sort((a, b) => b.sold30 - a.sold30)[0];
  const insights = [
    slowest && slowest.avgAge > rules.thresholds[1] && {
      icon: <Smartphone size={18} aria-hidden="true" />,
      text: <><strong>{n0(slowest.units)} units of {slowest.model}</strong>{slowest.variant ? ` (${slowest.variant})` : ""} have been held for an average of <strong>{slowest.avgAge} days</strong>, with {n0(slowest.sold30)} sold in the past 30 days.</>,
      href: `/items/${slowest.id}`,
    },
    healthy && {
      icon: <TrendingUp size={18} aria-hidden="true" />,
      text: <><strong>{healthy.model}</strong> shows healthy turnover: average age <strong>{healthy.avgAge} days</strong>, {n0(healthy.sold30)} sold in the last 30 days.</>,
      href: `/items/${healthy.id}`,
    },
    oldUnits > 0 && {
      icon: <AlertTriangle size={18} aria-hidden="true" />,
      text: <><strong>{n0(oldUnits)} units{seeCost ? ` (${money(oldValue)} MMK)` : ""}</strong> are {labels[3].toLowerCase()}, over {rules.thresholds[2]} days. Consider a promotion or a price change.</>,
      href: `/reports/phone-stock?sort=age`,
    },
  ].filter(Boolean) as { icon: React.ReactNode; text: React.ReactNode; href: string }[];

  const sorted = sp.sort === "age" ? [...rows].sort((a, b) => b.avgAge - a.avgAge) : rows;
  const pg = paginate(sorted, sp.page);
  const kpi = (icon: React.ReactNode, label: string, value: React.ReactNode, unit: string, hint: string) => (
    <div className="kpi">
      <span className="kpi-icon" style={{ color: "var(--ink)", background: "var(--line-soft)" }}>{icon}</span>
      <span className="kpi-body">
        <span className="kpi-label">{label} <HelpHint label={label}>{hint}</HelpHint></span>
        <span className="kpi-value">{value} <small className="ag-unit">{unit}</small></span>
      </span>
    </div>
  );
  const Bar = ({ parts }: { parts: number[] }) => {
    const sum = parts.reduce((s, v) => s + v, 0);
    return (
      <span className="ag-bar" role="img"
        aria-label={parts.map((v, b) => `${labels[b]} ${sum ? Math.round((v / sum) * 100) : 0}%`).join(", ")}>
        {parts.map((v, b) => v > 0 && <span key={b} className={`ag-b${b}`} style={{ flexGrow: v }} title={`${labels[b]} · ${ranges[b]}`} />)}
      </span>
    );
  };

  return (
    <>
      <div className="page-head hero">
        <h1>Inventory Aging</h1>
        <BranchScope />
        <p className="page-sub">How long your current stock has been held, and how quickly it sells.</p>
        {can(user, "inventory.manage") && (
          <div className="head-actions">
            <Link className="btn ghost" href="/reports/phone-stock/settings"><Settings size={15} aria-hidden="true" /> Settings</Link>
          </div>
        )}
      </div>

      <div className="ag-top">
        <div className="kpis kpis-tiled kpis-compact ag-kpis">
          {kpi(<Clock size={16} aria-hidden="true" />, `Stock over ${rules.thresholds[2]} days`, n0(oldUnits), "units",
            `Units in ${labels[3]}: received more than ${rules.thresholds[2]} days ago.`)}
          {seeCost && kpi(<Layers size={16} aria-hidden="true" />, "Aged stock value", money(agedValue), "MMK",
            `${labels[2]} and ${labels[3]} together, at cost.`)}
          {kpi(<CalendarDays size={16} aria-hidden="true" />, "Average stock age", n0(avgAge), "days",
            "Days since each unit on hand was received, averaged over units.")}
        </div>
        <section className="card ag-dist">
          <div className="ag-dist-head"><h2>Aging distribution</h2><span className="page-sub">By {seeCost ? "stock value" : "units"}</span></div>
          <Bar parts={total4} />
          <ul className="ag-legend">
            {total4.map((v, b) => (
              <li key={b}>
                <span className="ag-key"><i className={`ag-dot ag-b${b}`} /> {labels[b]}</span>
                <span className="ag-range">{ranges[b]}</span>
                <strong>{total ? Math.round((v / total) * 100) : 0}%</strong>
                <small>{seeCost ? `${money(v)} MMK` : `${n0(v)} units`}</small>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card ag-card">
        <div className="ag-card-head">
          <h2>Stock aging by model</h2>
          <form method="get" className="ag-filters">
            {sp.sort && <input type="hidden" name="sort" value={sp.sort} />}
            <select name="category" defaultValue={sp.category ?? ""} aria-label="Category" className={`dt-filter${sp.category ? " dt-filter-on" : ""}`}>
              <option value="">All categories</option>
              {(groups as any[]).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            {multiBranch && (
              <select name="branch" defaultValue={sp.branch ?? ""} aria-label="Branch" className={`dt-filter${sp.branch ? " dt-filter-on" : ""}`}>
                <option value="">All branches</option>
                {(branches as any[]).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            <label className="dt-search">
              <Search size={15} aria-hidden="true" />
              <input name="q" type="search" defaultValue={sp.q ?? ""} data-live placeholder="Search model…" aria-label="Search model" />
            </label>
            <AutoApply />
          </form>
        </div>
        <div className="tablewrap">
          <table className="ag-table">
            <thead>
              <tr>
                <th>Model</th><th>Brand</th>{multiBranch && <th>Branch</th>}<th className="num">Units</th>
                {seeCost && <th className="num">Value (MMK)</th>}
                <th>Aging distribution <small>by {seeCost ? "value" : "units"}</small></th>
                <th className="num">Avg. age</th><th className="num">Sold 30d</th><th className="num">Sold 90d</th>
                <th>Pace <HelpHint label="Sales pace">Days of stock at the 90-day selling rate. Fast: up to {pace.fastDays} days. Moderate: up to {pace.slowDays}. Slow: more. Not the same as age.</HelpHint></th>
              </tr>
            </thead>
            <tbody>
              {pg.rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    <Link href={`/items/${r.id}`} className="ag-prod">
                      {/* A real photo when there is one; nothing in its place when not. */}
                      {r.photo && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <span className="ag-thumb"><img src={r.photo} alt="" /></span>
                      )}
                      <span><strong>{r.model}</strong><small>{r.variant ?? r.code}</small></span>
                    </Link>
                  </td>
                  <td>{r.brand ?? r.category}</td>
                  {multiBranch && <td>{r.branch}</td>}
                  <td className="num">{n0(r.units)}</td>
                  {seeCost && <td className="num">{money(r.value)}</td>}
                  <td><Bar parts={measure(r)} /></td>
                  <td className="num">{r.avgAge} days</td>
                  <td className="num">{n0(r.sold30)}</td>
                  <td className="num">{n0(r.sold90)}</td>
                  <td><span className={`ag-pace ${r.pace.toLowerCase()}`} title={r.cover === null ? "Nothing sold in 90 days" : `${r.cover} days of stock`}>{PACE[r.pace]}</span></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={10} className="page-sub">Nothing on hand matches.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager p={pg} params={sp} />
      </section>

      {insights.length > 0 && (
        <section className="card ag-insights">
          <h2>Key insights</h2>
          <div>
            {insights.map((i, k) => (
              <Link key={k} href={i.href} className="ag-insight">
                <span className="ag-insight-ico">{i.icon}</span><span>{i.text}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

import { seenLocations, seenRows } from "@/lib/branch-scope";
import Link from "next/link";
import { Box, Layers, Wallet, AlertTriangle, Search, Download, ChevronRight, CalendarClock, Repeat, Hourglass, ArrowRight } from "lucide-react";
import { agingReport, bucketRanges } from "@/lib/aging";
import { sql } from "@/lib/db";
import { requirePermission, can } from "@/lib/auth";
import { inventorySummary, catalogFacets, stripCost, foldToModels } from "@/lib/phone";
import { HelpHint } from "@/components/help-hint";
import { CatalogFilterFields, catalogSelection } from "@/components/catalog-filters";
import { AutoApply } from "@/components/auto-apply";
import { ShareDonut, MeasureBars, RevenueTrendChart } from "@/components/charts";
import { money } from "@/lib/format";
import { compact } from "@/components/stat";
import { paginate } from "@/lib/paging";
import { Pager } from "@/components/pager";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("inventory") };
}

const TYPE: Record<string, [string, string]> = {
  GOODS_RECEIPT: ["GR", "ok"], SALES_INVOICE: ["Sale", "posted"], DELIVERY: ["Sale", "posted"],
  STOCK_TRANSFER: ["Transfer", "draft"], STOCK_ADJUSTMENT: ["Adjustment", "warn"],
  SALES_RETURN: ["Return", "warn"], PURCHASE_RETURN: ["To supplier", "warn"],
};

type Search = Record<string, string | undefined>;
/** The query string a link or form carries, minus the keys it replaces. */
const qsWithout = (sp: Search, drop: string[], add: Record<string, string> = {}) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v && !drop.includes(k)) q.set(k, v);
  for (const [k, v] of Object.entries(add)) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
};
/** The other form's choices, carried as hidden fields so each form keeps both. */
const Carry = ({ sp, keys }: { sp: Search; keys: string[] }) => (
  <>{keys.filter((k) => sp[k]).map((k) => <input key={k} type="hidden" name={k} value={sp[k]} />)}</>
);

/**
 * Inventory summary: what is on the shelves, what it is worth, and where it
 * is running out — for the branch and warehouse chosen at the top.
 *
 * The cards and charts answer for the whole of that branch; the search and
 * filters in Stock by product narrow only the table, so looking for one model
 * never makes the overview look as though the rest of the stock vanished.
 */
export default async function InventorySummary({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("inventory.view");
  const t = await getTranslations("inventory");
  const c = await getTranslations("common");
  const sp = await searchParams;
  const co = user.companyId;
  const seeCost = can(user, "cost.view");

  // The warehouses this person may see, each with the branch it belongs to.
  const seen = await seenLocations();
  const allLocs = (await seenRows((await sql`
    select w.id, w.name, b.id as branch_id, b.name as branch_name
      from location w left join location b on b.id = w.parent_id
     where w.company_id = ${co} and w.is_stock_location and w.is_active
     order by b.code nulls first, w.code`) as unknown as Record<string, unknown>[], "id")) as any[];
  const branchOpts = [...new Map(allLocs.filter((l) => l.branch_id)
    .map((l) => [l.branch_id, { id: l.branch_id as string, name: l.branch_name as string }])).values()];
  const branch = branchOpts.some((b) => b.id === sp.branch) ? sp.branch! : "";
  const whOpts = branch ? allLocs.filter((l) => l.branch_id === branch) : allLocs;
  const warehouse = whOpts.some((l) => l.id === sp.wh) ? sp.wh! : "";
  // Where the figures come from: one warehouse, a branch's warehouses, or all seen.
  const scope = { locationId: warehouse || undefined,
    locs: warehouse ? seen : branch ? whOpts.map((l) => l.id as string) : seen };

  const facetsP = catalogFacets(co, sp.category || undefined, sp.brand || undefined);
  // The cards and the table read the same catalogue; only a filter on the
  // table makes it a second question. Unfiltered, it is answered once.
  const overviewP = inventorySummary(co, { ...scope, combine: true });
  const tableFiltered = Boolean(sp.q || sp.category || sp.status || sp.model || sp.brand
    || Object.keys(sp).some((k) => k.startsWith("a_") && sp[k]));
  const at = scope.locationId ? sql`and jl.location_id = ${scope.locationId}` : scope.locs ? sql`and jl.location_id = any(${scope.locs})` : sql``;
  const [overview, table, facets, aging, groups, trend, flow] = await Promise.all([
    overviewP,
    tableFiltered ? facetsP.then((f) => inventorySummary(co, {
      ...scope, combine: true, q: sp.q || undefined, groupId: sp.category || undefined, ...catalogSelection(sp, f),
    })) : overviewP,
    facetsP,
    // The shop's own age groups (Inventory Aging settings), for the bar.
    agingReport(co, seen, { branchId: branch || undefined }),
    sql`select id, name from item_group where company_id = ${co} and parent_id is null order by name`,
    // What the shelves were worth at each month's end: the inventory accounts' balance.
    seeCost ? sql`
      with months as (
        select generate_series(date_trunc('month', current_date) - interval '6 months',
                               date_trunc('month', current_date), interval '1 month')::date as m)
      select to_char(m, 'YYYY-MM') as month,
             coalesce((select sum(jl.base_amount) from journal_line jl
                        join account a on a.id = jl.account_id
                        join journal_entry je on je.id = jl.journal_entry_id
                       where jl.company_id = ${co} and a.subledger = 'INVENTORY'
                         and je.entry_date < (m + interval '1 month')
                         ${scope.locationId ? sql`and jl.location_id = ${scope.locationId}`
                           : scope.locs ? sql`and jl.location_id = any(${scope.locs})` : sql``}), 0)::float as revenue
        from months order by m` : Promise.resolve([]),
    // Turnover over the last 90 days: cost of goods sold against the average
    // of what the shelves were worth at the start and now.
    seeCost ? sql`
      select coalesce((select sum(jl.base_amount) from journal_line jl join account a on a.id = jl.account_id
                         join journal_entry je on je.id = jl.journal_entry_id
                        where jl.company_id = ${co} and a.account_type = 'COGS' ${at}
                          and je.entry_date > current_date - 90 and je.entry_date <= current_date), 0)::float as cogs,
             coalesce((select sum(jl.base_amount) from journal_line jl join account a on a.id = jl.account_id
                         join journal_entry je on je.id = jl.journal_entry_id
                        where jl.company_id = ${co} and a.subledger = 'INVENTORY' ${at}
                          and je.entry_date <= current_date - 90), 0)::float as opening,
             coalesce((select sum(jl.base_amount) from journal_line jl join account a on a.id = jl.account_id
                         join journal_entry je on je.id = jl.journal_entry_id
                        where jl.company_id = ${co} and a.subledger = 'INVENTORY' ${at}
                          and je.entry_date <= current_date), 0)::float as closing` : Promise.resolve([]),
  ]);
  const f0 = (flow as any[])[0];
  const avgInv = f0 ? (Number(f0.opening) + Number(f0.closing)) / 2 : 0;
  const turnover = f0 && avgInv > 0 ? Number(f0.cogs) / avgInv : null;
  const dio = turnover && turnover > 0 ? 90 / turnover : null;
  // The aging bar, by value where cost may be seen, by units otherwise.
  const age4 = [0, 1, 2, 3].map((b) => aging.rows.reduce((s, r) => s + Number((seeCost ? r.value4 : r.units4)[b]), 0));
  const ageTotal = age4.reduce((s, v) => s + v, 0);
  const ranges = bucketRanges(aging.rules.thresholds);

  // Cost is rendered only for cost.view, and not sent to anyone else either.
  // The summary is by product model; each variant has its own page (Stock).
  const all = stripCost(foldToModels(overview.rows as any[]), seeCost) as any[];
  const rows = (stripCost(foldToModels(table.rows as any[]), seeCost) as any[])
    .filter((r) => !sp.status || r.status === sp.status);
  const onHand = all.filter((r) => Number(r.qty) > 0);
  const named = onHand.filter((r) => r.tracks_serial).reduce((s, r) => s + Number(r.qty), 0);
  const counted = onHand.filter((r) => !r.tracks_serial).reduce((s, r) => s + Number(r.qty), 0);
  const totalValue = all.reduce((s, r) => s + Number(r.value ?? 0), 0);
  const low = all.filter((r) => r.status === "LOW");
  const out = all.filter((r) => r.status === "OUT");
  const healthy = all.filter((r) => r.status === "HEALTHY");

  // By top category, biggest first: value for the donut, units for the bars,
  // in the same order so a category keeps its colour across both.
  const cats = [...onHand.reduce((m, r) => {
    const k = r.top_category ?? r.category ?? "Other";
    const e = m.get(k) ?? { value: 0, qty: 0 };
    e.value += Number(r.value ?? 0); e.qty += Number(r.qty);
    return m.set(k, e);
  }, new Map<string, { value: number; qty: number }>())]
    .map(([name, e]) => ({ name, ...e }))
    .sort((a, b) => (seeCost ? b.value - a.value : b.qty - a.qty));
  const top = cats.slice(0, 7);
  const rest = cats.slice(7);
  const donut = [...top.map((x) => ({ id: x.name, name: x.name, revenue: x.value })),
    ...(rest.length ? [{ id: "rest", name: "Others", revenue: rest.reduce((s, x) => s + x.value, 0), rest: true }] : [])];
  const bars = [...top.map((x) => ({ label: x.name, value: x.qty })),
    ...(rest.length ? [{ label: "Others", value: rest.reduce((s, x) => s + x.qty, 0) }] : [])];

  // The table: what is on the shelf, unless asked for the whole catalogue.
  const allItems = sp.all === "1" || sp.status === "OUT";
  const shown = allItems ? [...rows] : rows.filter((r) => Number(r.qty) > 0 || Number(r.reserved) > 0);
  const SORTS: Record<string, { num: boolean; v: (r: any) => number | string }> = {
    product: { num: false, v: (r) => String(r.model).toLowerCase() },
    onhand: { num: true, v: (r) => Number(r.qty) },
    category: { num: false, v: (r) => String(r.category ?? "").toLowerCase() },
    reserved: { num: true, v: (r) => Number(r.reserved) },
    available: { num: true, v: (r) => Number(r.available) },
    cost: { num: true, v: (r) => Number(r.avg_cost ?? -1) },
    value: { num: true, v: (r) => Number(r.value) },
    status: { num: false, v: (r) => ({ OUT: 0, LOW: 1, HEALTHY: 2 } as Record<string, number>)[r.status] ?? 3 },
  };
  if (!seeCost) { delete SORTS.cost; delete SORTS.value; }
  const sortKey = sp.sort && SORTS[sp.sort] ? sp.sort : null;
  const sortDir = sp.dir === "asc" || sp.dir === "desc" ? sp.dir : sortKey && SORTS[sortKey].num ? "desc" : "asc";
  if (sortKey) {
    const { v } = SORTS[sortKey];
    shown.sort((a, b) => { const x = v(a), y = v(b); const k = x < y ? -1 : x > y ? 1 : 0; return sortDir === "asc" ? k : -k; });
  }
  const Th = ({ k, label, num }: { k: string; label: string; num?: boolean }) => (
    <th className={num ? "num" : undefined} aria-sort={sortKey === k ? (sortDir === "asc" ? "ascending" : "descending") : undefined}>
      <Link href={`/inventory${qsWithout(sp, ["sort", "dir", "page"], {
        sort: k, dir: sortKey === k ? (sortDir === "asc" ? "desc" : "asc") : SORTS[k].num ? "desc" : "asc" })}`}
        className="sortbtn" scroll={false}>
        {label}
        {sortKey === k
          ? <span className="sortmark on" aria-hidden="true">{sortDir === "asc" ? "↑" : "↓"}</span>
          : <span className="sortmark" aria-hidden="true">↕</span>}
      </Link>
    </th>
  );
  const pg = paginate(shown, sp.page);
  const asOf = new Date().toLocaleString("en-GB", { timeZone: "Asia/Yangon", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const statusPill = (s: string) => (
    <span className={`inv-status ${s === "HEALTHY" ? "ok" : s === "LOW" ? "low" : "out"}`}>
      {s === "HEALTHY" ? "In stock" : s === "LOW" ? "Low stock" : "Out of stock"}
    </span>
  );
  /** The Stock page's card: a quiet icon, the figure, and a "?" for the detail. */
  const kpi = (icon: React.ReactNode, label: string, value: React.ReactNode, hint: string, bad = false, href?: string) => {
    const body = (
      <>
        <span className="kpi-icon" style={{ color: "var(--ink)", background: "var(--line-soft)" }}>{icon}</span>
        <span className="kpi-body">
          <span className="kpi-label">{label} <HelpHint label={label}>{hint}</HelpHint></span>
          <span className="kpi-value" style={{ color: bad ? "var(--bad)" : undefined }}>{value}</span>
        </span>
      </>
    );
    return href ? <Link href={href} className="kpi">{body}</Link> : <div className="kpi">{body}</div>;
  };
  const TABLE_KEYS = ["q", "category", "brand", "model", "status", "all", "sort", "dir"];

  return (
    <div className="inv">
      <div className="inv-head">
        <div>
          <h1>{t("sum.title")} <HelpHint label="About Inventory Summary">Stock quantity and value by category and product model, for the branch and warehouse chosen. Each variant&apos;s own position is on the Stock page.</HelpHint></h1>
        </div>
        {/* Where: branch and warehouse, for everything on the page. */}
        <form method="get" className="inv-scope">
          <Carry sp={sp} keys={TABLE_KEYS} />
          {branchOpts.length > 1 && (
            <select name="branch" defaultValue={branch} aria-label="Branch">
              <option value="">All branches</option>
              {branchOpts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          {whOpts.length > 1 && (
            <select name="wh" defaultValue={warehouse} aria-label="Warehouse">
              <option value="">All warehouses</option>
              {whOpts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          <span className="inv-asof"><CalendarClock size={15} aria-hidden="true" /> As of {asOf}</span>
          <AutoApply />
          <button className="btn ghost" data-apply>{c("filterBtn")}</button>
        </form>
      </div>

      <div className="kpis kpis-tiled kpis-compact">
        {seeCost && kpi(<Wallet size={16} aria-hidden="true" />, "Inventory value", `${money(totalValue)} MMK`,
          "At cost, landed costs included.")}
        {kpi(<Layers size={16} aria-hidden="true" />, "Total on hand", `${(named + counted).toLocaleString("en-US")} units`,
          `IMEI / serial: ${named.toLocaleString("en-US")} · Quantity: ${counted.toLocaleString("en-US")}`)}
        {seeCost ? <>
          {kpi(<Repeat size={16} aria-hidden="true" />, "Inventory turnover", turnover === null ? "—" : `${turnover.toFixed(1)}×`,
            "Cost of goods sold in the last 90 days over the average stock value (start and now).")}
          {kpi(<Hourglass size={16} aria-hidden="true" />, "Days inventory outstanding", dio === null ? "—" : `${dio.toFixed(1)} days`,
            "How many days the stock lasts at the last 90 days' rate of sale: 90 ÷ turnover.")}
        </> : <>
          {kpi(<Box size={16} aria-hidden="true" />, "Total products", all.length.toLocaleString("en-US"),
            `${onHand.length.toLocaleString("en-US")} product models in stock.`)}
          {kpi(<AlertTriangle size={16} aria-hidden="true" />, "Low stock items", low.length,
            "Models with a variant at or below its reorder level.", low.length > 0, "/inventory/replenishment")}
        </>}
      </div>

      {/* Three charts, one frame, one height. */}
      <section className="inv-charts">
        {seeCost && (
          <div className="card inv-chart">
            <div className="card-head"><h2>Stock value by category</h2><span className="page-sub">MMK, at cost</span></div>
            <div className="card-body"><ShareDonut data={donut} currency="MMK" emptyLabel="Nothing in stock yet." /></div>
          </div>
        )}
        <div className="card inv-chart">
          <div className="card-head"><h2>Stock quantity by category</h2><span className="page-sub">units on hand</span></div>
          <div className="card-body">
            {bars.length ? <MeasureBars data={bars} format="plain" height={250} /> : <div className="empty">Nothing in stock yet.</div>}
          </div>
        </div>
        {seeCost && (
          <div className="card inv-chart">
            <div className="card-head"><h2>Inventory value trend</h2><span className="page-sub">month end · {compact(totalValue)} MMK now</span></div>
            <div className="card-body"><RevenueTrendChart data={trend as never} height={250} /></div>
          </div>
        )}
      </section>

      <section className="inv-row2">
        <Link href="/reports/phone-stock" className="card inv-aging" aria-label="Inventory aging: open the aging page">
          <div className="card-head"><h2>Inventory aging <span className="inv-head-note">by {seeCost ? "stock value" : "units"}</span></h2>
            <span className="inv-go-link">View aging <ArrowRight size={14} aria-hidden="true" /></span></div>
          <div className="card-body">
            <span className="ag-bar inv-aging-bar" role="img"
              aria-label={age4.map((v, i) => `${aging.rules.labels[i]} ${ageTotal ? Math.round((v / ageTotal) * 100) : 0}%`).join(", ")}>
              {age4.map((v, i) => v > 0 && <span key={i} className={`ag-b${i}`} style={{ flexGrow: v }} />)}
            </span>
            <ul className="ag-legend">
              {age4.map((v, i) => (
                <li key={i}>
                  <span className="ag-key"><i className={`ag-dot ag-b${i}`} /> {aging.rules.labels[i]}</span>
                  <span className="ag-range">{ranges[i]}</span>
                  <strong>{ageTotal ? Math.round((v / ageTotal) * 100) : 0}%</strong>
                  <small>{seeCost ? `${money(v)} MMK` : `${v.toLocaleString("en-US")} units`}</small>
                </li>
              ))}
            </ul>
          </div>
        </Link>
        <div className="card inv-status-card">
          <div className="card-head"><h2>Stock status</h2><span className="page-sub">{all.length} products</span></div>
          <div className="card-body">
            <ShareDonut count emptyLabel="No products yet." currency=""
              centre={{ value: String(all.length), label: "Products" }}
              colours={["var(--ok)", "#FF9F0A", "var(--bad)"]}
              data={[{ id: "in", name: "In stock", revenue: healthy.length }, { id: "low", name: "Low stock", revenue: low.length },
                     { id: "out", name: "Out of stock", revenue: out.length }]} />
          </div>
        </div>
      </section>

      <div className="inv-row3">
      <section className="card inv-panel">
        <div className="inv-panel-head">
          <h2>Product summary</h2>
          <span className="page-sub">{shown.length.toLocaleString("en-US")} {shown.length === 1 ? "item" : "items"}</span>
        </div>
        {/* What: search and filters for the table alone. */}
        <form method="get" className="inv-tools">
          <Carry sp={sp} keys={["branch", "wh", "sort", "dir"]} />
          <label className="inv-search">
            <Search size={15} aria-hidden="true" />
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Search product, SKU, IMEI…" aria-label={c("search")} />
          </label>
          <CatalogFilterFields groups={groups as never} facets={facets} sp={sp} prefix="i" />
          <div className="field">
            <label htmlFor="is">{t("sum.stockStatus")}</label>
            <select id="is" name="status" defaultValue={sp.status ?? ""}>
              <option value="">{c("all")}</option>
              <option value="HEALTHY">In stock</option>
              <option value="LOW">Low stock</option>
              <option value="OUT">Out of stock</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="ia">Show</label>
            <select id="ia" name="all" defaultValue={sp.all ?? ""}>
              <option value="">On the shelf</option>
              <option value="1">Whole catalogue</option>
            </select>
          </div>
          <AutoApply />
          <button className="btn ghost" data-apply>{c("filterBtn")}</button>
          <span className="sp" />
          <a className="btn ghost inv-export" href={`/inventory/export${qsWithout(sp, ["page"])}`}>
            <Download size={15} aria-hidden="true" /> Export
          </a>
        </form>
        <div className="tablewrap">
          <table className="inv-table">
            <thead>
              <tr>
                <Th k="product" label="Product" /><Th k="category" label="Category" />
                <Th k="onhand" label="On hand" num />
                {seeCost && <Th k="value" label="Stock value (MMK)" num />}
                <Th k="status" label="Status" /><th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {pg.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="prod">
                      {r.photo && <span className="thumb"><img src={r.photo} alt="" /></span>}
                      <span className="prod-text">
                        <div className="prod-name clamp2" title={r.model}>{r.model}</div>
                        {/* Only a product that varies says how many it has; each one's detail is on the Stock page. */}
                        {r.variants > 1 && <Link className="subline inv-variants" href={`/items/stock?q=${encodeURIComponent(r.model)}`}>{r.variants} variants</Link>}
                      </span>
                    </span>
                  </td>
                  <td>{r.category}</td>
                  <td className="num">{r.qty}</td>
                  {seeCost && <td className="num">{money(r.value)}</td>}
                  <td>{statusPill(r.status)}</td>
                  <td className="inv-go"><Link href={`/items/${r.id}`} aria-label={`Open ${r.model}`}><ChevronRight size={16} aria-hidden="true" /></Link></td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={seeCost ? 6 : 5} className="page-sub">
                  {allItems ? t("sum.noMatch") : <>{t("sum.nothingInStock")} <Link href={`/inventory${qsWithout(sp, ["all", "page"], { all: "1" })}`}>{t("sum.showAllItems")}</Link></>}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager p={pg} params={sp} />
      </section>

        <section className="card inv-panel inv-repl">
          <div className="inv-panel-head">
            <h2>Replenishment alerts</h2>
            <Link href="/inventory/replenishment">{c("viewAll")}</Link>
          </div>
          <div className="inv-repl-tabs">
            <Link href="/inventory/replenishment"><span>Low stock</span><b className={low.length ? "warn" : undefined}>{low.length}</b></Link>
            <Link href="/inventory/replenishment"><span>Out of stock</span><b className={out.length ? "bad" : undefined}>{out.length}</b></Link>
          </div>
          <table className="inv-mini">
            <colgroup><col style={{ width: "64%" }} /><col style={{ width: "18%" }} /><col style={{ width: "18%" }} /></colgroup>
            <thead><tr><th>Product</th><th className="num">On hand</th><th className="num">Reorder</th></tr></thead>
            <tbody>
              {[...low, ...out].slice(0, 6).map((r) => (
                <tr key={r.id}>
                  <td className="clip" title={r.model}><Link href="/inventory/replenishment">{r.model}</Link></td>
                  <td className="num bad">{r.qty}</td>
                  <td className="num">{r.min_qty ?? (r.tracks_serial ? 2 : 0)}</td>
                </tr>
              ))}
              {low.length + out.length === 0 && <tr><td colSpan={3} className="page-sub">{t("sum.nothingLow")}</td></tr>}
            </tbody>
          </table>
          {low.length + out.length > 0 && (
            <Link href="/inventory/replenishment" className="inv-repl-note">
              <AlertTriangle size={15} aria-hidden="true" />
              <span><strong>{low.length + out.length} product{low.length + out.length === 1 ? " is" : "s are"} at or below the reorder level.</strong> Review and order before they run out.</span>
              <ChevronRight size={15} aria-hidden="true" />
            </Link>
          )}
        </section>
      </div>
    </div>
  );
}

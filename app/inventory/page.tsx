import { seenLocations, seenRows } from "@/lib/branch-scope";
import Link from "next/link";
import { Box, Layers, Wallet, AlertTriangle, Search, Download, ChevronRight, CalendarClock } from "lucide-react";
import { sql } from "@/lib/db";
import { requirePermission, can } from "@/lib/auth";
import { inventorySummary, recentMovements, catalogFacets, stripCost } from "@/lib/phone";
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
  const [overview, table, facets, moves, groups, trend] = await Promise.all([
    inventorySummary(co, scope),
    facetsP.then((f) => inventorySummary(co, {
      ...scope, q: sp.q || undefined, groupId: sp.category || undefined, ...catalogSelection(sp, f),
      status: sp.status || undefined,
    })),
    facetsP,
    recentMovements(co, 6, scope.locationId ? [scope.locationId] : scope.locs),
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
  ]);

  // Cost is rendered only for cost.view, and not sent to anyone else either.
  const all = stripCost(overview.rows as Record<string, any>[], seeCost) as any[];
  const rows = stripCost(table.rows as Record<string, any>[], seeCost) as any[];
  const onHand = all.filter((r) => Number(r.qty) > 0);
  const named = onHand.filter((r) => r.tracks_serial).reduce((s, r) => s + Number(r.qty), 0);
  const counted = onHand.filter((r) => !r.tracks_serial).reduce((s, r) => s + Number(r.qty), 0);
  const totalValue = all.reduce((s, r) => s + Number(r.value ?? 0), 0);
  const low = all.filter((r) => r.status === "LOW");

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
    product: { num: false, v: (r) => `${r.model} ${r.variant ?? ""}`.toLowerCase() },
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
  const TABLE_KEYS = ["q", "category", "brand", "model", "status", "all", "sort", "dir"];

  return (
    <div className="inv">
      <div className="inv-head">
        <div>
          <h1>{t("sum.title")}</h1>
          <p className="page-sub">Stock quantity and value by category and product.</p>
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

      <div className="inv-cards">
        <div className="inv-card">
          <span className="inv-ico tone-blue"><Box size={22} aria-hidden="true" /></span>
          <div><span className="lbl">Total products</span><strong>{all.length.toLocaleString("en-US")}</strong>
            <span className="sub">{onHand.length.toLocaleString("en-US")} in stock</span></div>
        </div>
        <div className="inv-card">
          <span className="inv-ico tone-orange"><Layers size={22} aria-hidden="true" /></span>
          <div><span className="lbl">Total on hand</span><strong>{(named + counted).toLocaleString("en-US")} <small>units</small></strong>
            <span className="sub">IMEI / serial: {named.toLocaleString("en-US")} · Quantity: {counted.toLocaleString("en-US")}</span></div>
        </div>
        {seeCost && (
          <div className="inv-card">
            <span className="inv-ico tone-green"><Wallet size={22} aria-hidden="true" /></span>
            <div><span className="lbl">Inventory value</span><strong>{money(totalValue)} <small>MMK</small></strong>
              <span className="sub">At cost, landed costs included</span></div>
          </div>
        )}
        <Link href={`/inventory${qsWithout(sp, ["status", "page"], { status: "LOW" })}`} className="inv-card">
          <span className="inv-ico tone-red"><AlertTriangle size={22} aria-hidden="true" /></span>
          <div><span className="lbl">Low stock items</span><strong className={low.length ? "bad" : undefined}>{low.length}</strong>
            <span className="sub">At or below reorder level</span></div>
        </Link>
      </div>

      <div className="inv-charts">
        {seeCost && (
          <section className="card inv-panel">
            <div className="inv-panel-head"><h2>Stock value by category</h2></div>
            <ShareDonut data={donut} currency="MMK" emptyLabel="Nothing in stock yet." />
          </section>
        )}
        <section className="card inv-panel">
          <div className="inv-panel-head"><h2>Stock quantity by category</h2></div>
          {bars.length ? <MeasureBars data={bars} format="plain" height={230} /> : <div className="empty">Nothing in stock yet.</div>}
        </section>
      </div>

      <section className="card inv-panel">
        <div className="inv-panel-head">
          <h2>Stock by product</h2>
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
                <Th k="reserved" label="Reserved" num /><Th k="available" label="Available" num />
                {seeCost && <><Th k="cost" label="Avg FIFO cost (MMK)" num /><Th k="value" label="Stock value (MMK)" num /></>}
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
                        <div className="prod-name clamp2" title={r.model}>{r.model}{r.variant ? ` ${r.variant}` : ""}</div>
                      </span>
                    </span>
                  </td>
                  <td>{r.category}</td>
                  <td className="num">{r.reserved}</td>
                  <td className="num">{r.available}</td>
                  {seeCost && <>
                    <td className="num">{r.avg_cost != null ? money(r.avg_cost) : "—"}</td>
                    <td className="num">{money(r.value)}</td>
                  </>}
                  <td>{statusPill(r.status)}</td>
                  <td className="inv-go"><Link href={`/items/${r.id}`} aria-label={`Open ${r.model}`}><ChevronRight size={16} aria-hidden="true" /></Link></td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={seeCost ? 8 : 6} className="page-sub">
                  {allItems ? t("sum.noMatch") : <>{t("sum.nothingInStock")} <Link href={`/inventory${qsWithout(sp, ["all", "page"], { all: "1" })}`}>{t("sum.showAllItems")}</Link></>}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager p={pg} params={sp} />
      </section>

      <div className="inv-bottom">
        <section className="card inv-panel">
          <div className="inv-panel-head"><h2>Low stock items</h2><Link href={`/inventory${qsWithout(sp, ["status", "page"], { status: "LOW" })}`}>{c("viewAll")}</Link></div>
          <table className="inv-mini">
            <thead><tr><th>Product</th><th>Category</th><th className="num">Available</th><th className="num">Reorder level</th></tr></thead>
            <tbody>
              {low.slice(0, 5).map((r) => (
                <tr key={r.id}>
                  <td className="clip" title={`${r.model} ${r.variant ?? ""}`}>{r.model}{r.variant ? ` ${r.variant}` : ""}</td>
                  <td>{r.top_category ?? r.category}</td>
                  <td className="num bad">{r.available}</td>
                  <td className="num">{r.min_qty ?? (r.tracks_serial ? 2 : 0)}</td>
                </tr>
              ))}
              {low.length === 0 && <tr><td colSpan={4} className="page-sub">{t("sum.nothingLow")}</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="card inv-panel">
          <div className="inv-panel-head"><h2>Recent stock movements</h2><Link href="/inventory/movements">{c("viewAll")}</Link></div>
          <table className="inv-mini">
            <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Product</th><th className="num">Qty</th></tr></thead>
            <tbody>
              {moves.map((m: any) => {
                const [label, tone] = TYPE[m.doc_type] ?? [m.doc_type ?? "Movement", "draft"];
                return (
                  <tr key={m.id}>
                    <td>{new Date(m.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</td>
                    <td><span className={`pill ${tone}`}>{label}</span></td>
                    <td>{m.document_id ? <Link href={`/documents/${m.document_id}`}>{m.doc_no ?? "—"}</Link> : "—"}</td>
                    <td className="clip" title={m.item}>{m.item}</td>
                    <td className={`num ${m.qty > 0 ? "ok-qty" : "bad"}`}>{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
                  </tr>
                );
              })}
              {moves.length === 0 && <tr><td colSpan={5} className="page-sub">No movements yet.</td></tr>}
            </tbody>
          </table>
        </section>
        {seeCost && (
          <section className="card inv-panel">
            <div className="inv-panel-head"><h2>Inventory value trend</h2><span className="page-sub">Monthly · {compact(totalValue)} MMK now</span></div>
            <RevenueTrendChart data={trend as never} />
          </section>
        )}
      </div>
    </div>
  );
}

import Link from "next/link";
import { Boxes, Package, Lock, AlertTriangle, Smartphone } from "lucide-react";
import { sql } from "@/lib/db";
import { requirePermission, can } from "@/lib/auth";
import { inventorySummary, recentMovements, catalogFacets } from "@/lib/phone";
import { CatalogFilterFields, catalogSelection } from "@/components/catalog-filters";
import { AutoApply } from "@/components/auto-apply";
import { money, dateTime } from "@/lib/format";
import { Stat, compact } from "@/components/stat";
import { paginate } from "@/lib/paging";
import { Pager } from "@/components/pager";

export const metadata = { title: "Inventory" };

const TYPE: Record<string, [string, string]> = {
  GOODS_RECEIPT: ["Purchase", "ok"], SALES_INVOICE: ["Sale", "posted"], DELIVERY: ["Sale", "posted"],
  STOCK_TRANSFER: ["Transfer", "draft"], STOCK_ADJUSTMENT: ["Adjustment", "warn"],
  SALES_RETURN: ["Return", "warn"], PURCHASE_RETURN: ["To supplier", "warn"],
};

type Search = Record<string, string | undefined>;

export default async function InventorySummary({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("inventory.view");
  const sp = await searchParams;
  const co = user.companyId;
  const seeCost = can(user, "cost.view");

  const facetsP = catalogFacets(co, sp.category || undefined);
  const [{ locations, rows }, facets, moves, groups, allLocs] = await Promise.all([
    facetsP.then((f) => inventorySummary(co, {
      q: sp.q || undefined, groupId: sp.category || undefined, ...catalogSelection(sp, f),
      locationId: sp.location || undefined, status: sp.status || undefined,
    })),
    facetsP,
    recentMovements(co),
    sql`select id, name from item_group where company_id = ${co} and parent_id is null order by name`,
    sql`select id, name from location where company_id = ${co} and is_stock_location and is_active order by code`,
  ]);

  const total = rows.reduce((s, r: any) => s + Number(r.value), 0);
  const units = rows.reduce((s, r: any) => s + Math.max(0, r.available), 0);
  const reserved = rows.reduce((s, r: any) => s + Number(r.reserved), 0);
  // Running low: some left, at or under the reorder point. A variant that was
  // never stocked is not running low, and counting every one buried the few
  // that are.
  const low = rows.filter((r: any) => r.status === "LOW");
  // A column per warehouse only on request, and only where there is more than
  // one: a single-shop company would see the same figure twice.
  const manyWarehouses = allLocs.length > 1;
  const byWarehouse = manyWarehouses && sp.by === "warehouse";
  const shownLocs = byWarehouse ? locations : [];
  const toggleHref = (() => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "by" && k !== "page") q.set(k, v);
    if (!byWarehouse) q.set("by", "warehouse");
    const t = q.toString();
    return t ? `/inventory?${t}` : "/inventory";
  })();

  // What is on the shelf, unless asked for the whole catalogue. Looking for
  // "out of stock" is asking for the whole catalogue.
  const allItems = sp.all === "1" || sp.status === "OUT";
  const shown = allItems ? [...rows] : rows.filter((r: any) => Number(r.qty) > 0 || Number(r.reserved) > 0);
  const scopeHref = (all: boolean) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "all" && k !== "page") q.set(k, v);
    if (all) q.set("all", "1");
    const t = q.toString();
    return t ? `/inventory?${t}` : "/inventory";
  };
  // Sorted on the server, across every page rather than the 25 on screen.
  // Figures biggest first on the first click, words A to Z.
  const SORTS: Record<string, { num: boolean; v: (r: any) => number | string }> = {
    product: { num: false, v: (r) => `${r.model} ${r.variant ?? ""}`.toLowerCase() },
    category: { num: false, v: (r) => String(r.category ?? "").toLowerCase() },
    reserved: { num: true, v: (r) => Number(r.reserved) },
    available: { num: true, v: (r) => Number(r.available) },
    cost: { num: true, v: (r) => Number(r.avg_cost ?? -1) },
    value: { num: true, v: (r) => Number(r.value) },
    status: { num: false, v: (r) => ({ OUT: 0, LOW: 1, HEALTHY: 2 } as Record<string, number>)[r.status] ?? 3 },
  };
  const sortKey = sp.sort && SORTS[sp.sort] ? sp.sort : null;
  const sortDir = sp.dir === "asc" || sp.dir === "desc" ? sp.dir : sortKey && SORTS[sortKey].num ? "desc" : "asc";
  if (sortKey) {
    const { v } = SORTS[sortKey];
    shown.sort((a: any, b: any) => {
      const x = v(a), y = v(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return sortDir === "asc" ? c : -c;
    });
  }
  const sortHref = (key: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "sort" && k !== "dir" && k !== "page") q.set(k, v);
    const first = SORTS[key].num ? "desc" : "asc";
    q.set("sort", key);
    q.set("dir", sortKey === key ? (sortDir === "asc" ? "desc" : "asc") : first);
    return `/inventory?${q.toString()}`;
  };
  const Th = ({ k, label, num }: { k: string; label: string; num?: boolean }) => (
    <th className={num ? "num" : undefined} aria-sort={sortKey === k ? (sortDir === "asc" ? "ascending" : "descending") : undefined}>
      <Link href={sortHref(k)} className="sortbtn" scroll={false}>
        {label}
        {sortKey === k
          ? <span className="sortmark on" aria-hidden="true">{sortDir === "asc" ? "↑" : "↓"}</span>
          : <span className="sortmark" aria-hidden="true">↕</span>}
      </Link>
    </th>
  );
  const pg = paginate(shown, sp.page);
  return (
    <>
      <div className="page-head hero">
        <h1>Inventory</h1>
        <p className="page-sub">Stock summary across all stores and warehouses</p>
        {can(user, "inventory.manage") && (
          <div className="head-actions"><Link className="btn" href="/inventory/adjustments">+ Stock Adjustment</Link></div>
        )}
      </div>

      <div className="stats">
        {seeCost && <Stat icon={<Boxes size={20} />} label="Total Stock Value" value={`${compact(total)} MMK`} note="At FIFO cost" />}
        <Stat icon={<Package size={20} />} tone="slate" label="Available Units" value={`${units.toLocaleString()} units`} />
        <Stat icon={<Lock size={20} />} tone="violet" label="Reserved Units" value={`${reserved} units`} note="Reserved or in repair" />
        <Stat icon={<AlertTriangle size={20} />} tone="amber" label="Low Stock Items" value={`${low.length} items`}
          note={low.length ? "Requires attention" : "All healthy"} noteTone={low.length ? "warn" : "up"} />
      </div>

      <form className="card filters" method="get">
        <div className="card-body filter-row">
          <div className="field">
            <label htmlFor="iq">Search</label>
            <input id="iq" name="q" defaultValue={sp.q ?? ""} placeholder="Search product, SKU, model…" />
          </div>
          <CatalogFilterFields groups={groups as never} facets={facets} sp={sp} prefix="i" />
          {manyWarehouses && (
            <div className="field">
              <label htmlFor="il">Location</label>
              <select id="il" name="location" defaultValue={sp.location ?? ""}>
                <option value="">All</option>
                {allLocs.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          )}
          {byWarehouse && <input type="hidden" name="by" value="warehouse" />}
          {sp.all === "1" && <input type="hidden" name="all" value="1" />}
          <div className="field">
            <label htmlFor="is">Stock status</label>
            <select id="is" name="status" defaultValue={sp.status ?? ""}>
              <option value="">All</option>
              <option value="HEALTHY">Healthy</option>
              <option value="LOW">Low stock</option>
              <option value="OUT">Out of stock</option>
            </select>
          </div>
          <AutoApply />
          <button className="btn ghost" data-apply>Filter</button>
        </div>
      </form>

      <div className="card" style={{ overflowX: "auto", marginBottom: "var(--s3)" }}>
        <div className="card-head">
          <h2>Inventory Summary</h2>
          <span className="actions">
            <span className="scopetabs" style={{ margin: 0 }}>
              <Link className="scopetab" data-active={!allItems} href={scopeHref(false)}>In stock</Link>
              <Link className="scopetab" data-active={allItems} href={scopeHref(true)}>All items</Link>
            </span>
            {manyWarehouses && (
              <Link href={toggleHref} className="dt-tool">{byWarehouse ? "Hide warehouses" : "Show by warehouse"}</Link>
            )}
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <Th k="product" label="Product" /><Th k="category" label="Category" />
              {shownLocs.map((l: any) => <th key={l.id} className="num">{l.name}</th>)}
              <Th k="reserved" label="Reserved" num /><Th k="available" label="Available" num />
              {seeCost && <><Th k="cost" label="Avg / FIFO cost" num /><Th k="value" label="Stock value" num /></>}
              <Th k="status" label="Status" />
            </tr>
          </thead>
          <tbody>
            {pg.rows.map((r: any) => (
              <tr key={r.id}>
                <td>
                  <span className="prod">
                    <span className="thumb">{r.photo ? <img src={r.photo} alt="" /> : <Smartphone size={18} aria-hidden="true" />}</span>
                    <span className="prod-text">
                      <div className="prod-name clamp2" title={r.model}>{r.model}</div>
                      <div className="prod-sub ellip" title={r.variant ?? r.brand ?? ""}>{r.variant ?? r.brand ?? ""}</div>
                    </span>
                  </span>
                </td>
                <td>{r.category}</td>
                {shownLocs.map((l: any) => <td key={l.id} className="num">{Number(r.by_loc?.[l.id] ?? 0)}</td>)}
                <td className="num">{r.reserved}</td>
                <td className="num">{r.available}</td>
                {seeCost && <>
                  <td className="num">{r.avg_cost != null ? money(r.avg_cost) : "—"}</td>
                  <td className="num">{money(r.value)}</td>
                </>}
                <td>
                  <span className={`pill ${r.status === "HEALTHY" ? "ok" : "warn"}`}>
                    {r.status === "HEALTHY" ? "Healthy" : r.status === "LOW" ? "Low stock" : "Out of stock"}
                  </span>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={9} className="page-sub">
                {allItems ? "No products match." : <>Nothing in stock matches. <Link href={scopeHref(true)}>Show all items</Link></>}
              </td></tr>
            )}
          </tbody>
        </table>
        <Pager p={pg} params={sp} />
      </div>

      <div className="section-grid">
        <div className="card" style={{ overflowX: "auto" }}>
          <div className="card-head"><h2>Recent Stock Movements</h2><Link href="/inventory/movements">View all</Link></div>
          <table>
            <thead><tr><th>Date &amp; time</th><th>Type</th><th>Product</th><th className="num">Qty</th><th>From → To</th><th>User</th></tr></thead>
            <tbody>
              {moves.map((m: any) => {
                const [label, tone] = TYPE[m.doc_type] ?? [m.doc_type ?? "Movement", "draft"];
                const route = m.doc_type === "STOCK_TRANSFER" ? `${m.location} → ${m.other_location ?? ""}`
                  : m.qty > 0 ? `→ ${m.location}` : m.location;
                return (
                  <tr key={m.id}>
                    <td>{dateTime(m.created_at)}</td>
                    <td><span className={`pill ${tone}`}>{label}</span></td>
                    <td>{m.document_id ? <Link href={`/documents/${m.document_id}`}>{m.item}</Link> : m.item}</td>
                    <td className={`num ${m.qty > 0 ? "ok-qty" : "low"}`}>{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
                    <td>{route}</td>
                    <td>{m.user_name ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="card-head"><h2>Low Stock Alerts</h2><Link href="/inventory?status=LOW">View all</Link></div>
          <table>
            <thead><tr><th>Product</th><th className="num">Current</th><th className="num">Min.</th></tr></thead>
            <tbody>
              {low.slice(0, 8).map((r: any) => (
                <tr key={r.id}>
                  <td><div className="prod-name">{r.model}</div><div className="prod-sub">{r.variant ?? ""}</div></td>
                  <td className="num low">{r.qty}</td>
                  <td className="num">{r.min_qty ?? (r.tracks_serial ? 2 : 0)}</td>
                </tr>
              ))}
              {low.length === 0 && <tr><td colSpan={3} className="page-sub">Nothing low.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

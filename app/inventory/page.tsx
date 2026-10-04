import Link from "next/link";
import { Boxes, Package, Lock, AlertTriangle, Smartphone } from "lucide-react";
import { sql } from "@/lib/db";
import { requirePermission, can } from "@/lib/auth";
import { inventorySummary, recentMovements } from "@/lib/phone";
import { money, dateTime } from "@/lib/format";
import { Stat, compact } from "@/components/stat";

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

  const [{ locations, rows }, moves, groups, brands, allLocs] = await Promise.all([
    inventorySummary(co, {
      q: sp.q || undefined, groupId: sp.category || undefined, brand: sp.brand || undefined,
      locationId: sp.location || undefined, status: sp.status || undefined,
    }),
    recentMovements(co),
    sql`select id, name from item_group where company_id = ${co} and parent_id is null order by name`,
    sql`select name from brand where company_id = ${co} and is_active order by name`,
    sql`select id, name from location where company_id = ${co} and is_stock_location and is_active order by code`,
  ]);

  const total = rows.reduce((s, r: any) => s + Number(r.value), 0);
  const units = rows.reduce((s, r: any) => s + Math.max(0, r.available), 0);
  const reserved = rows.reduce((s, r: any) => s + Number(r.reserved), 0);
  const low = rows.filter((r: any) => r.status !== "HEALTHY");

  return (
    <>
      <div className="page-head hero">
        <h1>Inventory</h1>
        <p className="page-sub">Stock summary across all stores and warehouses</p>
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
          <div className="field">
            <label htmlFor="ic">Category</label>
            <select id="ic" name="category" defaultValue={sp.category ?? ""}>
              <option value="">All</option>
              {groups.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ib">Brand</label>
            <select id="ib" name="brand" defaultValue={sp.brand ?? ""}>
              <option value="">All</option>
              {brands.map((b: any) => <option key={b.name} value={b.name}>{b.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="il">Location</label>
            <select id="il" name="location" defaultValue={sp.location ?? ""}>
              <option value="">All</option>
              {allLocs.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="is">Stock status</label>
            <select id="is" name="status" defaultValue={sp.status ?? ""}>
              <option value="">All</option>
              <option value="HEALTHY">Healthy</option>
              <option value="LOW">Low stock</option>
              <option value="OUT">Out of stock</option>
            </select>
          </div>
          <button className="btn ghost">Filter</button>
          {can(user, "inventory.manage") && <Link className="btn" href="/inventory/adjustments">+ Stock Adjustment</Link>}
        </div>
      </form>

      <div className="card" style={{ overflowX: "auto", marginBottom: "var(--s3)" }}>
        <div className="card-head"><h2>Inventory Summary</h2><span className="page-sub">Current stock levels across all locations</span></div>
        <table>
          <thead>
            <tr>
              <th>Product</th><th>Category</th>
              {locations.map((l: any) => <th key={l.id} className="num">{l.name}</th>)}
              <th className="num">Reserved</th><th className="num">Available</th>
              {seeCost && <><th className="num">Avg / FIFO cost</th><th className="num">Stock value</th></>}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.id}>
                <td>
                  <span className="prod">
                    <span className="thumb">{r.photo ? <img src={r.photo} alt="" /> : <Smartphone size={18} aria-hidden="true" />}</span>
                    <span>
                      <div className="prod-name">{r.model}</div>
                      <div className="prod-sub">{r.variant ?? r.brand ?? ""}</div>
                    </span>
                  </span>
                </td>
                <td>{r.category}</td>
                {locations.map((l: any) => <td key={l.id} className="num">{Number(r.by_loc?.[l.id] ?? 0)}</td>)}
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
            {rows.length === 0 && <tr><td colSpan={9} className="page-sub">No products match.</td></tr>}
          </tbody>
        </table>
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

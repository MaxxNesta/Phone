import Link from "next/link";
import { requirePermission, can } from "@/lib/auth";
import { phoneStock, phoneStockFacets, stripCost, serialKpis } from "@/lib/phone";
import { Stat, compact } from "@/components/stat";
import { Smartphone, Lock, TrendingUp, Wallet } from "lucide-react";
import { money, shortDate } from "@/lib/format";

export const metadata = { title: "Phone stock" };

const STATUSES = ["IN_STOCK", "RESERVED", "REPAIR", "SOLD", "RETURNED_TO_SUPPLIER", "WRITTEN_OFF"];
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

type Search = Record<string, string | undefined>;

export default async function PhoneStock({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("inventory.view");
  const sp = await searchParams;
  const f = {
    q: sp.q || undefined, locationId: sp.location || undefined, brand: sp.brand || undefined,
    model: sp.model || undefined, storage: sp.storage || undefined, colour: sp.colour || undefined,
    // In stock unless asked otherwise: what is on the shelf is the usual question.
    status: sp.status === "ALL" ? undefined : (sp.status || "IN_STOCK"),
    supplierId: sp.supplier || undefined,
  };
  const showCost = can(user, "cost.view");
  const [rows, facets, k] = await Promise.all([
    phoneStock(user.companyId, f), phoneStockFacets(user.companyId), serialKpis(user.companyId)]);
  const units = stripCost(rows as Record<string, any>[], showCost);
  const value = showCost ? rows.reduce((s, r: any) => s + Number(r.unit_cost ?? 0), 0) : 0;

  const select = (name: string, options: { v: string; l: string }[], current?: string, all = "All") => (
    <div className="field">
      <label htmlFor={`f-${name}`}>{name.charAt(0).toUpperCase() + name.slice(1)}</label>
      <select id={`f-${name}`} name={name} defaultValue={current ?? ""}>
        <option value="">{all}</option>
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );

  return (
    <>
      <div className="page-head hero">
        <h1>IMEI / Serial Inventory</h1>
        <p className="page-sub">Track every handset as an individual physical unit</p>
        {can(user, "inventory.manage") && (
          <div className="head-actions"><Link className="btn" href="/purchases/receive/new">+ Receive Stock</Link></div>
        )}
      </div>

      <div className="stats">
        <Stat icon={<Smartphone size={20} />} label="Available Phones" value={k.available}
          note={`+${k.received_week} received this week`} noteTone="up" />
        <Stat icon={<Lock size={20} />} tone="violet" label="Reserved" value={k.reserved}
          note={k.repair ? `${k.repair} in repair` : "Held for customers"} />
        <Stat icon={<TrendingUp size={20} />} tone="slate" label="Sold This Month" value={k.sold_month}
          note={k.sold_last_month ? `${k.sold_last_month} last month` : undefined} />
        {showCost && (
          <Stat icon={<Wallet size={20} />} tone="amber" label="Stock Value" value={`${compact(k.value)} MMK`}
            note="FIFO acquisition cost" noteTone="warn" />
        )}
      </div>

      <form className="card filters" method="get">
        <div className="card-body filter-row">
          <div className="field">
            <label htmlFor="f-q">IMEI, serial or model</label>
            <input id="f-q" name="q" defaultValue={sp.q ?? ""} placeholder="Scan or type" autoFocus />
          </div>
          {select("location", facets.locations.map((l: any) => ({ v: l.id, l: l.name })), sp.location)}
          {select("brand", facets.brands.map((v) => ({ v, l: v })), sp.brand)}
          {select("model", facets.models.map((v) => ({ v, l: v })), sp.model)}
          {select("storage", facets.storages.map((v) => ({ v, l: v })), sp.storage)}
          {select("colour", facets.colours.map((v) => ({ v, l: v })), sp.colour)}
          <div className="field">
            <label htmlFor="f-status">Status</label>
            <select id="f-status" name="status" defaultValue={sp.status ?? "IN_STOCK"}>
              <option value="ALL">All</option>
              {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </div>
          {select("supplier", facets.suppliers.map((s: any) => ({ v: s.id, l: s.name })), sp.supplier)}
          <div className="field filter-go"><button className="btn">Filter</button></div>
        </div>
      </form>

      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Model</th><th>Variant</th><th>IMEI / Serial</th><th>Location</th>
              {showCost && <th className="num">Cost</th>}<th className="num">Price</th>
              <th>Status</th><th className="num">Age</th><th>Warranty</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u: any) => (
              <tr key={u.serial_id} className="link">
                <td>
                  <span className="prod">
                    <span className="thumb"><Smartphone size={18} aria-hidden="true" /></span>
                    <span className="prod-name">{u.model_name}</span>
                  </span>
                </td>
                <td className="prod-sub">{[u.storage, u.colour].filter(Boolean).join(" · ") || u.item_name}</td>
                <td className="m"><Link href={`/inventory/phones/${u.serial_id}`}>{u.imei}</Link></td>
                <td>{u.location_name}</td>
                {showCost && <td className="num">{money(u.unit_cost)}</td>}
                <td className="num">{u.price != null ? money(u.price) : "—"}</td>
                <td>
                  <span className={`pill ${u.status === "IN_STOCK" ? "ok" : u.status === "SOLD" ? "posted" : "warn"}`}>
                    {label(u.status)}
                  </span>
                  {u.was_returned && <span className="pill warn">returned</span>}
                </td>
                <td className="num">{u.status === "IN_STOCK" ? `${u.age_days} d` : "—"}</td>
                <td>{u.warranty_expiry ? `to ${shortDate(u.warranty_expiry)}` : "—"}</td>
              </tr>
            ))}
            {units.length === 0 && (
              <tr><td colSpan={9} className="page-sub">No handsets match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

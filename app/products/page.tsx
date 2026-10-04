import Link from "next/link";
import { Package, Smartphone, Headphones, AlertTriangle, Plus } from "lucide-react";
import { sql } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { inventorySummary } from "@/lib/phone";
import { money, shortDate } from "@/lib/format";
import { Stat } from "@/components/stat";

export const metadata = { title: "Products" };

type Search = Record<string, string | undefined>;

export default async function Products({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("items.manage");
  const sp = await searchParams;
  const co = user.companyId;

  const [{ rows }, groups, brands, lastBuy, counts] = await Promise.all([
    inventorySummary(co, { q: sp.q || undefined, groupId: sp.category || undefined, brand: sp.brand || undefined }),
    sql`select g.id, g.name,
               (select count(*)::int from item i join item_group gg on gg.id = i.item_group_id
                 where i.company_id = ${co} and i.is_active
                   and not exists (select 1 from item c where c.parent_item_id = i.id)
                   and (gg.id = g.id or gg.parent_id = g.id)) as n
          from item_group g where g.company_id = ${co} and g.parent_id is null order by g.name`,
    sql`select name from brand where company_id = ${co} and is_active order by name`,
    sql`select dl.item_id, max(d.posting_date) as d from document_line dl
          join document d on d.id = dl.document_id
         where d.company_id = ${co} and d.doc_type = 'GOODS_RECEIPT' and d.status = 'POSTED'
         group by dl.item_id`,
    sql`select count(*) filter (where is_active)::int as active,
               count(*) filter (where not is_active)::int as inactive
          from item i where company_id = ${co}
           and not exists (select 1 from item c where c.parent_item_id = i.id)`,
  ]);
  const bought = new Map(lastBuy.map((r: any) => [r.item_id, r.d]));
  const tracking = sp.tracking;
  const list = rows.filter((r: any) => !tracking || (tracking === "SERIAL") === r.tracks_serial);
  const serialized = rows.filter((r: any) => r.tracks_serial).length;
  const low = rows.filter((r: any) => r.status !== "HEALTHY").length;

  return (
    <>
      <div className="page-head hero">
        <h1>Products</h1>
        <p className="page-sub">Manage models, accessories, prices, and stock settings</p>
        <div className="head-actions"><Link className="btn" href="/items/new"><Plus size={14} /> New Product</Link></div>
      </div>

      <div className="stats">
        <Stat icon={<Package size={20} />} label="Total Products" value={rows.length} />
        <Stat icon={<Smartphone size={20} />} tone="slate" label="Serialized Models" value={serialized} note="Tracked by IMEI / serial" />
        <Stat icon={<Headphones size={20} />} tone="violet" label="Accessories" value={rows.length - serialized} note="Cases, chargers, cables…" />
        <Stat icon={<AlertTriangle size={20} />} tone="amber" label="Low Stock Items" value={low} note="Need to reorder" noteTone="warn" />
      </div>

      <div className="section-grid">
        <div>
          <form className="card filters" method="get">
            <div className="card-body filter-row">
              <div className="field">
                <label htmlFor="pq">Search</label>
                <input id="pq" name="q" defaultValue={sp.q ?? ""} placeholder="Search product name, model, SKU…" />
              </div>
              <div className="field">
                <label htmlFor="pc">Category</label>
                <select id="pc" name="category" defaultValue={sp.category ?? ""}>
                  <option value="">All</option>
                  {groups.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pb">Brand</label>
                <select id="pb" name="brand" defaultValue={sp.brand ?? ""}>
                  <option value="">All</option>
                  {brands.map((b: any) => <option key={b.name} value={b.name}>{b.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pt">Tracking</label>
                <select id="pt" name="tracking" defaultValue={sp.tracking ?? ""}>
                  <option value="">All</option>
                  <option value="SERIAL">Serialized</option>
                  <option value="QTY">Quantity</option>
                </select>
              </div>
              <button className="btn ghost">Filter</button>
            </div>
          </form>

          <div className="card" style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Product</th><th>Brand / Model</th><th>Category</th><th>Tracking</th>
                  <th className="num">Selling price</th><th className="num">Available</th><th>Status</th>
                  <th>Last purchase</th><th />
                </tr>
              </thead>
              <tbody>
                {list.map((r: any) => (
                  <tr key={r.id}>
                    <td>
                      <span className="prod">
                        <span className="thumb">{r.photo ? <img src={r.photo} alt="" /> : <Smartphone size={18} aria-hidden="true" />}</span>
                        <span><div className="prod-name">{r.model}</div><div className="prod-sub">{r.variant ?? ""}</div></span>
                      </span>
                    </td>
                    <td><div>{r.brand ?? "—"}</div><div className="prod-sub">{r.model}</div></td>
                    <td>{r.category}</td>
                    <td><span className={`tag${r.tracks_serial ? "" : " qty"}`}>{r.tracks_serial ? "Serialized" : "Quantity"}</span></td>
                    <td className="num">{r.price != null ? money(r.price) : "—"}</td>
                    <td className={`num ${r.status === "HEALTHY" ? "ok-qty" : "low"}`}>{r.available} units</td>
                    <td>
                      <span className={`pill ${r.status === "HEALTHY" ? "ok" : "warn"}`}>
                        {r.status === "HEALTHY" ? "Active" : r.status === "LOW" ? "Low stock" : "Out of stock"}
                      </span>
                    </td>
                    <td>{bought.get(r.id) ? shortDate(bought.get(r.id)) : "—"}</td>
                    <td><Link href={`/items/${r.id}`} aria-label={`Edit ${r.name}`}>Edit</Link></td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan={9} className="page-sub">No products match.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: "var(--s3)" }}>
            <div className="card-head"><h2>Product Categories</h2><Link href="/items/categories">View all</Link></div>
            <div className="card-body">
              {groups.map((g: any) => (
                <Link key={g.id} href={`/products?category=${g.id}`} className="listrow" style={{ color: "inherit", textDecoration: "none" }}>
                  <span className="thumb"><Package size={18} aria-hidden="true" /></span>
                  <span className="grow"><div className="prod-name">{g.name}</div><div className="prod-sub">{g.n} products</div></span>
                </Link>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Quick Stats</h2></div>
            <div className="card-body">
              <div className="listrow"><span className="grow">Active products</span><strong>{counts[0].active}</strong></div>
              <div className="listrow"><span className="grow">Low stock items</span><strong>{low}</strong></div>
              <div className="listrow"><span className="grow">Inactive products</span><strong>{counts[0].inactive}</strong></div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

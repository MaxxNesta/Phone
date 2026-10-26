import Link from "next/link";
import { Package, Smartphone, Headphones, AlertTriangle, Plus } from "lucide-react";
import { sql } from "@/lib/db";
import { requirePermission, can } from "@/lib/auth";
import { productList, EXPORT_COLUMNS } from "@/lib/products";
import { CatalogFilterFields } from "@/components/catalog-filters";
import { ProductColumns, ProductExport } from "@/components/product-tools";
import { HelpHint } from "@/components/help-hint";
import { AutoApply } from "@/components/auto-apply";
import { BulkDelete, PickPage } from "@/components/bulk-delete";
import { money, shortDate } from "@/lib/format";
import { paginate } from "@/lib/paging";
import { Pager } from "@/components/pager";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  return { title: (await getTranslations("products"))("title") };
}

type Search = Record<string, string | undefined>;

export default async function Products({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("items.manage");
  const t = await getTranslations("products");
  const c = await getTranslations("common");
  const sp = await searchParams;
  const co = user.companyId;

  const [{ all: rows, list, facets, levels }, groups] = await Promise.all([
    productList(co, sp),
    sql`select g.id, g.name,
               (select count(*)::int from item i join item_group gg on gg.id = i.item_group_id
                 where i.company_id = ${co} and i.is_active
                   and not exists (select 1 from item c where c.parent_item_id = i.id)
                   and (gg.id = g.id or gg.parent_id = g.id)) as n
          from item_group g where g.company_id = ${co} and g.parent_id is null order by g.name`,
  ]);
  const multiBrand = facets.brands.length > 1;
  const seeCost = can(user, "cost.view");
  const serialized = rows.filter((r: any) => r.tracks_serial).length;
  const low = rows.filter((r: any) => r.status !== "HEALTHY").length;

  const pg = paginate(list, sp.page);
  // Columns as the Columns menu and Export name them; price levels after Selling price.
  const levelCols = levels.map((l) => ({ key: `level:${l.id}`, label: l.name }));
  const base = EXPORT_COLUMNS.filter((c) => (multiBrand || c.key !== "brand") && (seeCost || c.key !== "last_price")).map((c) => ({ key: c.key as string, label: c.label as string }));
  const at = base.findIndex((c) => c.key === "price") + 1;
  const exportCols = [...base.slice(0, at), ...levelCols, ...base.slice(at)];
  const toggleCols = exportCols.filter((c) => !["variant", "on_hand"].includes(c.key));
  const kpi = (icon: React.ReactNode, label: string, value: React.ReactNode, hint: string, bad = false) => (
    <div className="kpi">
      <span className="kpi-icon" style={{ color: "var(--ink)", background: "var(--line-soft)" }}>{icon}</span>
      <span className="kpi-body">
        <span className="kpi-label">{label} <HelpHint label={label}>{hint}</HelpHint></span>
        <span className="kpi-value" style={{ color: bad ? "var(--bad)" : undefined }}>{value}</span>
      </span>
    </div>
  );
  const filtered = Object.entries(sp).some(([k, v]) => v && (["q", "category", "model", "tracking", "status"].includes(k) || k.startsWith("a_")));
  return (
    <>
      <div className="page-head hero">
        <h1>{t("title")}</h1>
        <p className="page-sub">{t("sub")}</p>
        <div className="head-actions"><Link className="btn" href="/items/new"><Plus size={14} /> {t("new")}</Link></div>
      </div>

      <div className="kpis kpis-tiled kpis-compact">
        {kpi(<Package size={16} aria-hidden="true" />, t("statTotal"), rows.length, "Every sellable product and variant.")}
        {kpi(<Smartphone size={16} aria-hidden="true" />, t("statSerialized"), serialized, t("statSerializedNote"))}
        {kpi(<Headphones size={16} aria-hidden="true" />, t("statAccessories"), rows.length - serialized, t("statAccessoriesNote"))}
        {kpi(<AlertTriangle size={16} aria-hidden="true" />, t("statLow"), low, t("statLowNote"), low > 0)}
      </div>

      <div>
          <form className="card filters" method="get" style={{ marginBottom: "var(--s3)" }}>
            <div className="card-body filter-row">
              <div className="field">
                <label htmlFor="pq">{c("search")}</label>
                <input id="pq" name="q" defaultValue={sp.q ?? ""} placeholder={t("searchPlaceholder")} />
              </div>
              <CatalogFilterFields groups={groups as never} facets={facets} sp={sp} prefix="p" />
              <div className="field">
                <label htmlFor="pt">{c("tracking")}</label>
                <select id="pt" name="tracking" defaultValue={sp.tracking ?? ""}>
                  <option value="">{c("all")}</option>
                  <option value="IMEI">IMEI</option>
                  <option value="SERIAL">{c("serialNumber")}</option>
                  <option value="NONE">{c("quantity")}</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="ps">{c("status")}</label>
                <select id="ps" name="status" defaultValue={sp.status ?? ""}>
                  <option value="">{c("all")}</option>
                  <option value="HEALTHY">In stock</option>
                  <option value="LOW">Low stock</option>
                  <option value="OUT">Out of stock</option>
                </select>
              </div>
              <AutoApply />
              <button className="btn ghost" data-apply>{c("filter")}</button>
            </div>
          </form>


          <div className="card" style={{ overflowX: "auto" }}>
            <div className="card-head">
              <h2>{t("title")}</h2>
              <span className="dt-spacer" />
              <ProductExport total={list.length} columns={exportCols} />
              <ProductColumns columns={toggleCols} defaultHidden={[...levels.map((l) => `level:${l.id}`), "last_price"]} />
              <BulkDelete filtered={filtered}
                shown={list.map((r: any) => ({ id: r.id, name: [r.model, r.variant].filter(Boolean).join(" · ") }))} />
            </div>
            <table className="prodtable">
              <thead>
                <tr>
                  <th className="tight"><PickPage /></th>
                  <th data-col="code">SKU</th>
                  <th data-col="product">{c("product")}</th>{multiBrand && <th data-col="brand">{c("brand")}</th>}
                  <th data-col="category">{c("category")}</th><th data-col="tracking">{c("tracking")}</th>
                  <th className="num" data-col="price">{t("sellingPrice")}</th>
                  {levels.map((l) => <th key={l.id} className="num" data-col={`level:${l.id}`}>{l.name}</th>)}
                  <th className="num" data-col="available">{t("available")}</th><th data-col="status">{c("status")}</th>
                  <th data-col="last_purchase">{t("lastPurchase")}</th>
                  {seeCost && <th className="num" data-col="last_price">Latest purchase price</th>}<th />
                </tr>
              </thead>
              <tbody>
                {pg.rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="tight">
                      <input type="checkbox" className="bulk-pick" value={r.id} aria-label={c("selectItem", { name: r.model })} />
                    </td>
                    <td className="code" data-col="code">{r.code}</td>
                    <td data-col="product">
                      <span className="prod">
                        {/* A photo when there is one; no empty box when there is not. */}
                        {r.photo && <span className="thumb"><img src={r.photo} alt="" /></span>}
                        <span className="prod-text">
                          <div className="prod-name clamp2" title={r.model}>{r.model}</div>
                          <div className="prod-sub ellip" title={r.variant ?? ""}>{r.variant ?? ""}</div>
                        </span>
                      </span>
                    </td>
                    {multiBrand && <td data-col="brand">{r.brand ?? "—"}</td>}
                    <td data-col="category">{r.category}</td>
                    <td data-col="tracking"><span className={`tag${r.tracks_serial ? "" : " qty"}`}>{r.identity === "SERIAL" ? c("serial") : r.tracks_serial ? "IMEI" : c("quantity")}</span></td>
                    <td className="num" data-col="price">{r.price != null ? money(r.price) : "—"}</td>
                    {levels.map((l) => <td key={l.id} className="num" data-col={`level:${l.id}`}>
                      {r.levels[l.id] != null ? money(r.levels[l.id]) : "—"}</td>)}
                    <td data-col="available" className={`num ${r.status === "HEALTHY" ? "ok-qty" : "low"}`}>{c("units", { n: r.available })}</td>
                    <td data-col="status">
                      <span className={`pill ${r.status === "HEALTHY" ? "ok" : "warn"}`}>
                        {r.status === "HEALTHY" ? c("active") : r.status === "LOW" ? c("lowStock") : c("outOfStock")}
                      </span>
                    </td>
                    <td data-col="last_purchase">{r.last_bought ? shortDate(r.last_bought) : "—"}</td>
                    {seeCost && <td className="num" data-col="last_price">{r.last_price != null ? money(r.last_price) : "—"}</td>}
                    <td><Link href={`/items/${r.id}`} aria-label={c("editItem", { name: r.name })}>{c("edit")}</Link></td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan={(multiBrand ? 11 : 10) + levels.length + (seeCost ? 1 : 0)} className="page-sub">{t("noMatch")}</td></tr>}
              </tbody>
            </table>
            <Pager p={pg} params={sp} />
          </div>
        </div>
    </>
  );
}

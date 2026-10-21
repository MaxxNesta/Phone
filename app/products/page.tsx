import Link from "next/link";
import { Package, Smartphone, Headphones, AlertTriangle, Plus } from "lucide-react";
import { sql } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { inventorySummary, catalogFacets } from "@/lib/phone";
import { CatalogFilterFields, catalogSelection } from "@/components/catalog-filters";
import { AutoApply } from "@/components/auto-apply";
import { BulkDelete, PickPage } from "@/components/bulk-delete";
import { money, shortDate } from "@/lib/format";
import { Stat } from "@/components/stat";
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

  const facetsP = catalogFacets(co, sp.category || undefined, sp.brand || undefined);
  const [{ rows }, facets, groups, lastBuy] = await Promise.all([
    facetsP.then((f) => inventorySummary(co, { q: sp.q || undefined, groupId: sp.category || undefined, ...catalogSelection(sp, f) })),
    facetsP,
    sql`select g.id, g.name,
               (select count(*)::int from item i join item_group gg on gg.id = i.item_group_id
                 where i.company_id = ${co} and i.is_active
                   and not exists (select 1 from item c where c.parent_item_id = i.id)
                   and (gg.id = g.id or gg.parent_id = g.id)) as n
          from item_group g where g.company_id = ${co} and g.parent_id is null order by g.name`,
    sql`select dl.item_id, max(d.posting_date) as d from document_line dl
          join document d on d.id = dl.document_id
         where d.company_id = ${co} and d.doc_type = 'GOODS_RECEIPT' and d.status = 'POSTED'
         group by dl.item_id`,
  ]);
  const bought = new Map(lastBuy.map((r: any) => [r.item_id, r.d]));
  const multiBrand = facets.brands.length > 1;
  const tracking = sp.tracking;
  const list = rows.filter((r: any) => !tracking || (r.identity ?? (r.tracks_serial ? "IMEI" : "NONE")) === tracking);
  const serialized = rows.filter((r: any) => r.tracks_serial).length;
  const low = rows.filter((r: any) => r.status !== "HEALTHY").length;

  const pg = paginate(list, sp.page);
  const filtered = Object.entries(sp).some(([k, v]) => v && (["q", "category", "model", "tracking"].includes(k) || k.startsWith("a_")));
  return (
    <>
      <div className="page-head hero">
        <h1>{t("title")}</h1>
        <p className="page-sub">{t("sub")}</p>
        <div className="head-actions"><Link className="btn" href="/items/new"><Plus size={14} /> {t("new")}</Link></div>
      </div>

      <div className="stats">
        <Stat icon={<Package size={20} />} label={t("statTotal")} value={rows.length} />
        <Stat icon={<Smartphone size={20} />} tone="slate" label={t("statSerialized")} value={serialized} note={t("statSerializedNote")} />
        <Stat icon={<Headphones size={20} />} tone="violet" label={t("statAccessories")} value={rows.length - serialized} note={t("statAccessoriesNote")} />
        <Stat icon={<AlertTriangle size={20} />} tone="amber" label={t("statLow")} value={low} note={t("statLowNote")} noteTone="warn" />
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
              <AutoApply />
              <button className="btn ghost" data-apply>{c("filter")}</button>
            </div>
          </form>


          <div className="card" style={{ overflowX: "auto" }}>
            <div className="card-head">
              <h2>{t("title")}</h2>
              <BulkDelete filtered={filtered}
                shown={list.map((r: any) => ({ id: r.id, name: [r.model, r.variant].filter(Boolean).join(" · ") }))} />
            </div>
            <table>
              <thead>
                <tr>
                  <th className="tight"><PickPage /></th>
                  <th>{c("product")}</th>{multiBrand && <th>{c("brand")}</th>}<th>{c("category")}</th><th>{c("tracking")}</th>
                  <th className="num">{t("sellingPrice")}</th><th className="num">{t("available")}</th><th>{c("status")}</th>
                  <th>{t("lastPurchase")}</th><th />
                </tr>
              </thead>
              <tbody>
                {pg.rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="tight">
                      <input type="checkbox" className="bulk-pick" value={r.id} aria-label={c("selectItem", { name: r.model })} />
                    </td>
                    <td>
                      <span className="prod">
                        {/* A photo when there is one; no empty box when there is not. */}
                        {r.photo && <span className="thumb"><img src={r.photo} alt="" /></span>}
                        <span className="prod-text">
                          <div className="prod-name clamp2" title={r.model}>{r.model}</div>
                          <div className="prod-sub ellip" title={r.variant ?? ""}>{r.variant ?? ""}</div>
                        </span>
                      </span>
                    </td>
                    {multiBrand && <td>{r.brand ?? "—"}</td>}
                    <td>{r.category}</td>
                    <td><span className={`tag${r.tracks_serial ? "" : " qty"}`}>{r.identity === "SERIAL" ? c("serial") : r.tracks_serial ? "IMEI" : c("quantity")}</span></td>
                    <td className="num">{r.price != null ? money(r.price) : "—"}</td>
                    <td className={`num ${r.status === "HEALTHY" ? "ok-qty" : "low"}`}>{c("units", { n: r.available })}</td>
                    <td>
                      <span className={`pill ${r.status === "HEALTHY" ? "ok" : "warn"}`}>
                        {r.status === "HEALTHY" ? c("active") : r.status === "LOW" ? c("lowStock") : c("outOfStock")}
                      </span>
                    </td>
                    <td>{bought.get(r.id) ? shortDate(bought.get(r.id)) : "—"}</td>
                    <td><Link href={`/items/${r.id}`} aria-label={c("editItem", { name: r.name })}>{c("edit")}</Link></td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan={multiBrand ? 10 : 9} className="page-sub">{t("noMatch")}</td></tr>}
              </tbody>
            </table>
            <Pager p={pg} params={sp} />
          </div>
        </div>
    </>
  );
}

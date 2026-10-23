import { BranchScope } from "@/components/branch-scope";
import { seenLocations } from "@/lib/branch-scope";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { phoneStock, phoneStockFacets, stripCost, serialKpis } from "@/lib/phone";
import { Stat, compact } from "@/components/stat";
import { Smartphone, Lock, TrendingUp, Wallet } from "lucide-react";
import { money, shortDate } from "@/lib/format";
import { paginate } from "@/lib/paging";
import { Pager } from "@/components/pager";
import { AutoApply } from "@/components/auto-apply";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  return { title: (await getTranslations("inventory"))("ph.metaTitle") };
}

const STATUSES = ["IN_STOCK", "RESERVED", "REPAIR", "SOLD", "RETURNED_TO_SUPPLIER", "WRITTEN_OFF"];

type Search = Record<string, string | undefined>;

export default async function PhoneStock({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("inventory.view");
  const t = await getTranslations("inventory");
  const c = await getTranslations("common");
  const label = (s: string) => (t.has(`status.${s}`) ? t(`status.${s}`) : s);
  const sp = await searchParams;
  const f = {
    q: sp.q || undefined, locationId: sp.location || undefined, brand: sp.brand || undefined,
    model: sp.model || undefined, storage: sp.storage || undefined, colour: sp.colour || undefined,
    // In stock unless asked otherwise: what is on the shelf is the usual question.
    // A search is about one phone, wherever it is now; browsing is about the shelf.
    status: sp.status === "ALL" ? undefined : (sp.status || (sp.q ? undefined : "IN_STOCK")),
    supplierId: sp.supplier || undefined,
    locs: await seenLocations(),
  };
  const showCost = can(user, "cost.view");
  const [rows, facets, k] = await Promise.all([
    phoneStock(user.companyId, f), phoneStockFacets(user.companyId), serialKpis(user.companyId)]);
  // With one warehouse every unit is in it: no Location column or filter.
  // Brand only when there is more than one to tell apart.
  const multiBrand = facets.brands.length > 1;
  const manyWarehouses = facets.locations.filter((l: any) => l.is_stock_location).length > 1;
  const units = stripCost(rows as Record<string, any>[], showCost);
  // A scanned IMEI that names one phone opens that phone.
  const exact = sp.q ? units.filter((u: any) => u.imei === sp.q!.trim() || u.imei2 === sp.q!.trim()) : [];
  if (exact.length === 1) redirect(`/inventory/phones/${exact[0].serial_id}`);
  const value = showCost ? rows.reduce((s, r: any) => s + Number(r.unit_cost ?? 0), 0) : 0;

  const select = (name: string, options: { v: string; l: string }[], current?: string, all = c("all")) => (
    <div className="field">
      <label htmlFor={`f-${name}`}>{t(`ph.${name}`)}</label>
      <select id={`f-${name}`} name={name} defaultValue={current ?? ""}>
        <option value="">{all}</option>
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );

  const pg = paginate(units, sp.page);
  return (
    <>
      <div className="page-head hero">
        <h1>{t("ph.title")}</h1>
        <BranchScope />
        <p className="page-sub">{t("ph.sub")}</p>
        {can(user, "inventory.manage") && (
          <div className="head-actions"><Link className="btn" href="/purchases/receive/new">{t("ph.receive")}</Link></div>
        )}
      </div>

      <div className="stats">
        <Stat icon={<Smartphone size={20} />} label={t("ph.available")} value={k.available}
          note={t("ph.receivedWeek", { n: k.received_week })} noteTone="up" />
        <Stat icon={<Lock size={20} />} tone="violet" label={t("ph.reserved")} value={k.reserved}
          note={k.repair ? t("ph.inRepair", { n: k.repair }) : t("ph.heldForCustomers")} />
        <Stat icon={<TrendingUp size={20} />} tone="slate" label={t("ph.soldMonth")} value={k.sold_month}
          note={k.sold_last_month ? t("ph.soldLastMonth", { n: k.sold_last_month }) : undefined} />
        {showCost && (
          <Stat icon={<Wallet size={20} />} tone="amber" label={t("ph.stockValue")} value={`${compact(k.value)} MMK`}
            note={t("ph.fifoCost")} noteTone="warn" />
        )}
      </div>

      <form className="card filters" method="get">
        <div className="card-body filter-row">
          <div className="field">
            <label htmlFor="f-q">{t("ph.field")}</label>
            <input id="f-q" name="q" defaultValue={sp.q ?? ""} placeholder={t("ph.scanOrType")} autoFocus />
          </div>
          {manyWarehouses && select("location", facets.locations.map((l: any) => ({ v: l.id, l: l.name })), sp.location)}
          {multiBrand && select("brand", facets.brands.map((v) => ({ v, l: v })), sp.brand)}
          {select("model", facets.models.map((v) => ({ v, l: v })), sp.model)}
          {select("storage", facets.storages.map((v) => ({ v, l: v })), sp.storage)}
          {select("colour", facets.colours.map((v) => ({ v, l: v })), sp.colour)}
          <div className="field">
            <label htmlFor="f-status">{c("status")}</label>
            <select id="f-status" name="status" defaultValue={sp.status ?? (sp.q ? "ALL" : "IN_STOCK")}>
              <option value="ALL">{c("all")}</option>
              {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </div>
          {select("supplier", facets.suppliers.map((s: any) => ({ v: s.id, l: s.name })), sp.supplier)}
          <AutoApply />
          <div className="filter-go"><button className="btn ghost" data-apply>{c("filterBtn")}</button></div>
        </div>
      </form>

      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>{t("ph.model")}</th>{multiBrand && <th>{t("ph.brand")}</th>}<th>{t("ph.variant")}</th><th>{t("ph.imeiSerial")}</th>{manyWarehouses && <th>{t("ph.location")}</th>}
              {showCost && <th className="num">{t("ph.cost")}</th>}<th className="num">{c("price")}</th>
              <th>{c("status")}</th><th className="num">{t("ph.age")}</th><th>{t("ph.warranty")}</th>
            </tr>
          </thead>
          <tbody>
            {pg.rows.map((u: any) => (
              <tr key={u.serial_id} className="link">
                <td>
                  <span className="prod">
                    <span className="prod-text"><span className="prod-name clamp2" title={u.model_name}>{u.model_name}</span></span>
                  </span>
                </td>
                {multiBrand && <td>{u.brand_name ?? "—"}</td>}
                <td className="prod-sub">{[u.storage, u.colour].filter(Boolean).join(" · ") || u.item_name}</td>
                <td className="m"><Link href={`/inventory/phones/${u.serial_id}`}>{u.imei}</Link></td>
                {manyWarehouses && <td>{u.location_name}</td>}
                {showCost && <td className="num">{money(u.unit_cost)}</td>}
                <td className="num">{u.price != null ? money(u.price) : "—"}</td>
                <td>
                  <span className={`pill ${u.status === "IN_STOCK" ? "ok" : u.status === "SOLD" ? "posted" : "warn"}`}>
                    {label(u.status)}
                  </span>
                  {u.was_returned && <span className="pill warn">{t("ph.returned")}</span>}
                </td>
                <td className="num">{u.status === "IN_STOCK" ? t("ph.days", { n: u.age_days }) : "—"}</td>
                <td>{u.warranty_expiry ? t("ph.toDate", { date: shortDate(u.warranty_expiry) }) : "—"}</td>
              </tr>
            ))}
            {units.length === 0 && (
              <tr><td colSpan={multiBrand ? 10 : 9} className="page-sub">{t("ph.noMatch")}</td></tr>
            )}
          </tbody>
        </table>
        <Pager p={pg} params={sp} />
      </div>
    </>
  );
}

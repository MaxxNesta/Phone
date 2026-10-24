import { BranchScope } from "@/components/branch-scope";
import { seenLocations } from "@/lib/branch-scope";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { phoneStock, phoneStockFacets, stripCost, serialKpis } from "@/lib/phone";
import { Boxes, PackageCheck, Lock, ShoppingBag, Search } from "lucide-react";
import { PAGE_SIZE } from "@/lib/paging";
import { Pager } from "@/components/pager";
import { AutoApply } from "@/components/auto-apply";
import { ImeiTable, type ImeiRow } from "@/components/imei-inventory";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  return { title: "IMEI Inventory" };
}

const STATUSES = ["IN_STOCK", "RESERVED", "REPAIR", "SOLD", "RETURNED_TO_SUPPLIER", "WRITTEN_OFF"];

type Search = Record<string, string | undefined>;

/**
 * Every named unit, with what it cost and what it sells at. One page of rows
 * comes from the database at a time; a row opens the drawer, which loads
 * that unit's detail only then.
 */
export default async function PhoneStock({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("inventory.view");
  const t = await getTranslations("inventory");
  const c = await getTranslations("common");
  const label = (s: string) => (t.has(`status.${s}`) ? t(`status.${s}`) : s);
  const sp = await searchParams;
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
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
    phoneStock(user.companyId, { ...f, page, size: PAGE_SIZE }), phoneStockFacets(user.companyId), serialKpis(user.companyId)]);
  const multiBrand = facets.brands.length > 1;
  const manyWarehouses = facets.locations.filter((l: any) => l.is_stock_location).length > 1;
  const units = stripCost(rows as unknown as Record<string, any>[], showCost);
  // A scanned IMEI that names one phone opens that phone.
  const exact = sp.q ? units.filter((u: any) => u.imei === sp.q!.trim() || u.imei2 === sp.q!.trim()) : [];
  if (exact.length === 1 && rows.total === 1) redirect(`/inventory/phones?unit=${exact[0].serial_id}&tab=overview`);

  const total = rows.total;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pg = { page: Math.min(page, pages), pages, total,
    from: total ? (Math.min(page, pages) - 1) * PAGE_SIZE + 1 : 0,
    to: Math.min(Math.min(page, pages) * PAGE_SIZE, total) };

  const select = (name: string, all: string, options: { v: string; l: string }[], current?: string) => (
    <select name={name} defaultValue={current ?? ""} aria-label={all} className={`dt-filter${current ? " dt-filter-on" : ""}`}>
      <option value="">{all}</option>
      {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
  const share = (n: number) => (k.total ? n / k.total : 0);
  const kpi = (icon: React.ReactNode, name: string, value: number, of?: number) => (
    <div className="imei-kpi">
      <span className="imei-kpi-ico">{icon}</span>
      <span className="imei-kpi-body">
        <span className="imei-kpi-label">{name}</span>
        <span className="imei-kpi-value">{value.toLocaleString("en-US")}</span>
      </span>
      {of !== undefined && (
        <span className="imei-kpi-share" title={`${(of * 100).toFixed(1)}% of all units`}>
          {(of * 100).toFixed(1)}%
          <span className="imei-kpi-bar"><span style={{ width: `${Math.min(100, of * 100)}%` }} /></span>
        </span>
      )}
    </div>
  );

  return (
    <>
      <div className="page-head">
        <h1>IMEI Inventory</h1>
        <BranchScope />
        <p className="page-sub">All serialized items with cost and status</p>
        {can(user, "inventory.manage") && (
          <div className="head-actions"><Link className="btn" href="/purchases/receive/new">{t("ph.receive")}</Link></div>
        )}
      </div>

      <div className="imei-kpis">
        {kpi(<Boxes size={17} />, "Total IMEIs", k.total)}
        {kpi(<PackageCheck size={17} />, "In stock", k.available, share(k.available))}
        {kpi(<Lock size={17} />, "Reserved", k.reserved, share(k.reserved))}
        {kpi(<ShoppingBag size={17} />, "Sold", k.sold, share(k.sold))}
      </div>

      <div className="card imei-card">
        <form method="get" className="imei-bar">
          <label className="dt-search imei-search">
            <Search size={15} aria-hidden="true" />
            <input name="q" type="search" defaultValue={sp.q ?? ""} data-live autoComplete="off"
              placeholder="Search by product, item code, IMEI or serial…" aria-label="Search units" />
          </label>
          {multiBrand && select("brand", "All brands", facets.brands.map((v) => ({ v, l: v })), sp.brand)}
          {select("model", "All models", facets.models.map((v) => ({ v, l: v })), sp.model)}
          {facets.storages.length > 0 && select("storage", "All storage", facets.storages.map((v) => ({ v, l: v })), sp.storage)}
          {facets.colours.length > 0 && select("colour", "All colours", facets.colours.map((v) => ({ v, l: v })), sp.colour)}
          <select name="status" defaultValue={sp.status ?? (sp.q ? "ALL" : "IN_STOCK")} aria-label={c("status")}
            className={`dt-filter${(sp.status ?? "IN_STOCK") !== "ALL" ? " dt-filter-on" : ""}`}>
            <option value="ALL">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
          {manyWarehouses && select("location", "All locations", facets.locations.map((l: any) => ({ v: l.id, l: l.name })), sp.location)}
          {facets.suppliers.length > 1 && select("supplier", "All suppliers", facets.suppliers.map((s: any) => ({ v: s.id, l: s.name })), sp.supplier)}
          <AutoApply />
          <button className="btn ghost" data-apply>{c("filterBtn")}</button>
        </form>

        <ImeiTable rows={units as unknown as ImeiRow[]} showCost={showCost} showLocation={manyWarehouses}
          emptyLabel={t("ph.noMatch")} />
        <Pager p={pg} params={sp} />
      </div>
    </>
  );
}

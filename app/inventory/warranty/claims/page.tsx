import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { sql } from "@/lib/db";
import { seenLocations } from "@/lib/branch-scope";
import { shortDate } from "@/lib/format";
import { paginate } from "@/lib/paging";
import { Pager } from "@/components/pager";
import { getTranslations } from "next-intl/server";
import { ErpCrumbs } from "@/components/erp-worklist";

/** Warranty claims (0221), open first, oldest first: what is waiting on someone. */
export default async function Claims({ searchParams }: { searchParams: Promise<{ all?: string; page?: string }> }) {
  const user = await requirePermission("inventory.view");
  const t = await getTranslations("inventory");
  const c = await getTranslations("common");
  const sp = await searchParams;
  const locs = await seenLocations();
  const rows = await sql`
    select c.id, c.claim_no, c.claimed_on, c.fault, c.status, c.outcome, c.in_warranty, c.supplier_in_warranty,
           v.imei, v.item_name, bp.name as customer_name
      from warranty_claim c
      join v_stock_serial v on v.serial_id = c.serial_id
      left join business_partner bp on bp.id = c.partner_id
     where c.company_id = ${user.companyId}
       ${sp.all ? sql`` : sql`and c.status = 'OPEN'`}
       ${locs ? sql`and (c.location_id is null or c.location_id = any(${locs}))` : sql``}
     order by (c.status = 'OPEN') desc, c.claimed_on, c.claim_no`;
  const pg = paginate(rows as any[], sp.page);

  return (
    <>
      <ErpCrumbs steps={[{ label: t("war.lookup"), href: "/inventory/warranty" }, { label: t("claims.title") }]} />
      <div className="page-head hero">
        <h1>{t("claims.title")}</h1>
        <p className="page-sub">{t("claims.sub")}</p>
      </div>
      <div className="actions" style={{ marginBottom: "var(--s3)" }}>
        <Link href="/inventory/warranty/claims" className={`btn tiny${sp.all ? " ghost" : ""}`}>{t("claims.stOpen")}</Link>
        <Link href="/inventory/warranty/claims?all=1" className={`btn tiny${sp.all ? "" : " ghost"}`}>{t("claims.all")}</Link>
      </div>
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr><th>{t("claims.claim")}</th><th>{t("claims.claimed")}</th><th>{c("imei")}</th><th>{t("war.model")}</th>
              <th>{t("war.customer")}</th><th>{t("claims.fault")}</th><th>{t("claims.shopWarranty")}</th>
              <th>{t("claims.supplierWarranty")}</th><th>{c("status")}</th></tr>
          </thead>
          <tbody>
            {pg.rows.map((r: any) => (
              <tr key={r.id}>
                <td><Link href={`/inventory/warranty/claims/${r.id}`}>{r.claim_no}</Link></td>
                <td>{shortDate(r.claimed_on)}</td>
                <td className="m">{r.imei}</td>
                <td>{r.item_name}</td>
                <td>{r.customer_name ?? "—"}</td>
                <td className="wrap">{r.fault}</td>
                <td><span className="sbadge" data-tone={r.in_warranty ? "ok" : "bad"}>{r.in_warranty ? t("claims.yes") : t("claims.no")}</span></td>
                <td><span className="sbadge" data-tone={r.supplier_in_warranty ? "ok" : "bad"}>{r.supplier_in_warranty ? t("claims.yes") : t("claims.no")}</span></td>
                <td><span className="sbadge" data-tone={r.status === "OPEN" ? "warn" : r.outcome === "REJECTED" ? "bad" : "ok"}>{r.status === "OPEN" ? t("claims.stOpen") : t(`claims.out.${r.outcome}`)}</span></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="page-sub">{t("claims.none")}</td></tr>}
          </tbody>
        </table>
        <Pager p={pg} params={sp} />
      </div>
    </>
  );
}

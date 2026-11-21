import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { sql } from "@/lib/db";
import { shortDate } from "@/lib/format";
import { getTranslations } from "next-intl/server";
import { ErpCrumbs } from "@/components/erp-worklist";
import { CloseClaimForm } from "@/components/warranty-claim-forms";
import { StatusBanner, StatusBadge } from "@/components/status-banner";

/**
 * One warranty claim (0221): what is wrong, whether it was covered when it
 * was claimed, the documents it led to, and how it ended. The next step is
 * offered where it applies — take the phone back as faulty, send it to the
 * supplier from quarantine — and each of those posts its own document.
 */
export default async function Claim({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("inventory.view");
  const t = await getTranslations("inventory");
  const { id } = await params;
  const [c] = await sql`
    select c.*, (c.closed_at at time zone 'Asia/Yangon')::date::text as closed_on, v.imei, v.item_name, v.status as unit_status, v.location_id as unit_location_id,
           l.is_quarantine as unit_in_quarantine, l.name as unit_location,
           bp.name as customer_name, sup.name as supplier_name,
           sd.doc_no as sale_no, rd.doc_no as return_no, srd.doc_no as supplier_return_no,
           u1.name as opened_by_name, u2.name as closed_by_name
      from warranty_claim c
      join v_stock_serial v on v.serial_id = c.serial_id
      left join location l on l.id = v.location_id
      left join business_partner bp on bp.id = c.partner_id
      left join business_partner sup on sup.id = c.supplier_id
      left join document sd on sd.id = c.sale_document_id
      left join document rd on rd.id = c.return_document_id
      left join document srd on srd.id = c.supplier_return_document_id
      left join app_user u1 on u1.id = c.created_by
      left join app_user u2 on u2.id = c.closed_by
     where c.id = ${id} and c.company_id = ${user.companyId}`;
  if (!c) notFound();

  const acts = c.status === "OPEN" && (can(user, "sales.return") || can(user, "inventory.manage"));
  const covered = (on: boolean, until: unknown) => until
    ? <StatusBadge tone={on ? "ok" : "bad"}>{on ? t("claims.covered", { d: shortDate(until as string) }) : t("claims.expired", { d: shortDate(until as string) })}</StatusBadge>
    : <StatusBadge>{t("claims.noWarranty")}</StatusBadge>;
  const link = (href: string, text: string) => <Link href={href}>{text}</Link>;

  // What the claim is waiting on, and the one step that answers it.
  const withCustomer = c.unit_status === "SOLD" && !c.return_document_id;
  const inQuarantine = c.unit_in_quarantine && c.unit_status === "IN_STOCK" && !c.supplier_return_document_id;
  const next = c.status !== "OPEN" ? null
    : withCustomer ? {
        title: t("claims.nextWithCustomer"), description: t("claims.nextWithCustomerSub"),
        action: can(user, "sales.return") ? <Link href={`/sales/returns/new?claim=${c.id}`} className="btn tiny">{t("claims.takeBack")}</Link> : null,
      }
    : inQuarantine ? {
        title: t("claims.nextInQuarantine", { where: c.unit_location ?? "" }),
        description: c.supplier_in_warranty
          ? t("claims.nextToSupplierCovered", { who: c.supplier_name ?? "—", d: shortDate(c.supplier_warranty_until) })
          : t("claims.nextToSupplierExpired"),
        action: can(user, "purchase.post") ? <Link href={`/purchases/returns/new?claim=${c.id}`} className={`btn tiny${c.supplier_in_warranty ? "" : " ghost"}`}>{t("claims.toSupplier")}</Link> : null,
      }
    : { title: t("claims.nextClose"), description: t("claims.nextCloseSub"), action: null };

  return (
    <>
      <ErpCrumbs steps={[
        { label: t("war.lookup"), href: "/inventory/warranty" },
        { label: t("claims.title"), href: "/inventory/warranty/claims" },
        { label: c.claim_no },
      ]} />
      <div className="page-head">
        <h1>{t("claims.claim")} {c.claim_no}{" "}
          <StatusBadge tone={c.status === "OPEN" ? "warn" : c.outcome === "REJECTED" ? "bad" : "ok"}>
            {c.status === "OPEN" ? t("claims.stOpen") : t(`claims.out.${c.outcome}`)}
          </StatusBadge>
        </h1>
        <p className="page-sub">{t("claims.claimedOn", { d: shortDate(c.claimed_on), who: c.opened_by_name ?? "—" })}</p>
      </div>

      {c.status === "CLOSED" ? (
        <StatusBanner tone={c.outcome === "REJECTED" ? "bad" : "ok"}
          title={t("claims.closedAs", { outcome: t(`claims.out.${c.outcome}`) })}
          description={[c.outcome_note, `${shortDate(c.closed_on)}${c.closed_by_name ? ` · ${c.closed_by_name}` : ""}`].filter(Boolean).join(" — ")} />
      ) : next && acts ? (
        <StatusBanner tone={next.action ? "warn" : "info"} title={next.title} description={next.description} actions={next.action} />
      ) : null}

      <div className="split-2">
        <div className="card"><div className="card-body">
          <h2 className="card-title">{t("claims.thePhone")}</h2>
          <dl className="facts">
            <dt>{t("claims.phone")}</dt><dd>{link(`/imei/${c.serial_id}`, c.imei)} · {c.item_name}</dd>
            <dt>{t("war.customer")}</dt><dd>{c.customer_name ?? "—"}</dd>
            <dt>{t("war.invoice")}</dt><dd>{c.sale_document_id ? link(`/documents/${c.sale_document_id}`, c.sale_no) : "—"}</dd>
            <dt>{t("claims.fault")}</dt><dd><strong>{c.fault}</strong></dd>
          </dl>
        </div></div>
        <div className="card"><div className="card-body">
          <h2 className="card-title">{t("claims.coverAndTrail")}</h2>
          <dl className="facts">
            <dt>{t("claims.shopWarranty")}</dt><dd>{covered(c.in_warranty, c.warranty_until)}</dd>
            <dt>{t("claims.supplierWarranty")}</dt><dd>{c.supplier_name ?? "—"} {covered(c.supplier_in_warranty, c.supplier_warranty_until)}</dd>
            <dt>{t("claims.phoneNow")}</dt><dd>{String(c.unit_status ?? "").replace(/_/g, " ").toLowerCase()}{c.unit_location && c.unit_status === "IN_STOCK" ? ` · ${c.unit_location}` : ""}</dd>
            <dt>{t("claims.returnDoc")}</dt><dd>{c.return_document_id ? link(`/documents/${c.return_document_id}`, c.return_no) : "—"}</dd>
            <dt>{t("claims.supplierReturnDoc")}</dt><dd>{c.supplier_return_document_id ? link(`/documents/${c.supplier_return_document_id}`, c.supplier_return_no) : "—"}</dd>
          </dl>
        </div></div>
      </div>

      {acts && <CloseClaimForm claimId={c.id} />}
    </>
  );
}

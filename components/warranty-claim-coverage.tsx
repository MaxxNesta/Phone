import Link from "next/link";
import { shortDate } from "@/lib/format";

/** The phone, who bought it, and what covered it — shared by the new and detail pages. */
export function ClaimCoverage({ pos, t }: {
  pos: Record<string, any>;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const pill = (on: boolean, until: unknown) => until
    ? <span className={`pill ${on ? "ok" : "reversed"}`}>{on ? t("claims.covered", { d: shortDate(until as string) }) : t("claims.expired", { d: shortDate(until as string) })}</span>
    : <span className="pill">{t("claims.noWarranty")}</span>;
  return (
    <div className="card">
      <div className="card-body">
        <dl className="kv">
          <dt>{t("claims.phone")}</dt><dd><Link style={{ color: "var(--link)" }} href={`/imei/${pos.serial_id}`} className="m">{pos.imei}</Link> · {pos.item_name}</dd>
          <dt>{t("war.customer")}</dt><dd>{pos.customer_name ?? "—"}</dd>
          <dt>{t("war.invoice")}</dt><dd>{pos.sale_id ? <Link style={{ color: "var(--link)" }} href={`/documents/${pos.sale_id}`}>{pos.sale_no}</Link> : "—"}{pos.sold_on ? ` · ${shortDate(pos.sold_on)}` : ""}</dd>
          <dt>{t("claims.shopWarranty")}</dt><dd>{pill(!!pos.in_warranty, pos.warranty_until)}</dd>
          <dt>{t("claims.supplierWarranty")}</dt><dd>{pos.supplier_name ?? "—"} {pill(!!pos.supplier_in_warranty, pos.supplier_warranty_until)}</dd>
        </dl>
      </div>
    </div>
  );
}

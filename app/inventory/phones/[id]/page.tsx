import { seenLocations } from "@/lib/branch-scope";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { serialDetail } from "@/lib/phone";
import { money, shortDate, dateTime } from "@/lib/format";
import { SerialHoldForm } from "@/components/serial-hold-form";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  return { title: (await getTranslations("inventory"))("dev.metaTitle") };
}

export default async function Handset({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("inventory.view");
  const t = await getTranslations("inventory");
  const c = await getTranslations("common");
  const n = await getTranslations("nav");
  const label = (s: string) => (t.has(`status.${s}`) ? t(`status.${s}`) : s);
  const { id } = await params;
  const d = await serialDetail(user.companyId, id);
  // A phone at another branch is not found by someone who sees only their own.
  const seen = await seenLocations();
  if (!d || (seen && !seen.includes((d.unit as { location_id: string }).location_id))) notFound();
  const { unit: u, events, holds } = d;
  const docLink = (docId: string | null, no: string | null) =>
    docId ? <Link href={`/documents/${docId}`}>{no}</Link> : "—";

  return (
    <>
      <div className="page-head">
        <span className="eyebrow"><Link href="/inventory/phones">{n("imeiTracking")}</Link></span>
        <h1 className="m">
          {u.imei}{" "}
          <span className={`pill ${u.status === "IN_STOCK" ? "ok" : u.status === "SOLD" ? "posted" : "warn"}`}>
            {label(u.status)}
          </span>
          {u.was_returned && <span className="pill warn">{t("dev.returnedBefore")}</span>}
        </h1>
        <p className="page-sub">{u.item_name} · {u.location_name}</p>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="card-head"><h2>{t("dev.theUnit")}</h2></div>
          <div className="card-body">
            <dl className="facts">
              <dt>{t("ph.model")}</dt><dd>{u.model_name}{u.brand_name ? ` (${u.brand_name})` : ""}</dd>
              <dt>{t("ph.variant")}</dt><dd>{[u.storage, u.colour].filter(Boolean).join(" / ") || u.item_name}</dd>
              <dt>{t("dev.imei2")}</dt><dd className="m">{u.imei2 ?? "—"}</dd>
              <dt>{t("dev.makerSerial")}</dt><dd className="m">{u.device_serial ?? "—"}</dd>
              {can(user, "cost.view") && <><dt>{t("ph.cost")}</dt><dd className="num">{money(u.unit_cost)}</dd></>}
              <dt>{t("dev.notes")}</dt><dd>{u.notes ?? "—"}</dd>
            </dl>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>{t("dev.whereFromTo")}</h2></div>
          <div className="card-body">
            <dl className="facts">
              <dt>{t("ph.supplier")}</dt><dd>{u.supplier_id ? <Link href={`/partners/${u.supplier_id}`}>{u.supplier_name}</Link> : "—"}</dd>
              <dt>{t("dev.warehouseBranch")}</dt><dd>{u.location_name}</dd>
              <dt>{t("dev.goodsReceipt")}</dt><dd>{docLink(u.received_document_id, u.received_on)} · {u.received_date ? shortDate(u.received_date) : ""}</dd>
              <dt>{t("dev.supplierWarranty")}</dt>
              <dd>{u.supplier_warranty_months ? t("dev.monthsTo", { months: u.supplier_warranty_months, date: shortDate(u.supplier_warranty_expiry) }) : "—"}</dd>
              <dt>{t("dev.sale")}</dt><dd>{docLink(u.out_document_id, u.out_doc_no)}{u.out_date ? ` · ${shortDate(u.out_date)}` : ""}</dd>
              <dt>{t("dev.customer")}</dt><dd>{u.customer_id ? <Link href={`/partners/${u.customer_id}`}>{u.customer_name}</Link> : "—"}</dd>
              <dt>{t("dev.customerWarranty")}</dt>
              <dd>{u.warranty_expiry ? t("dev.monthsTo", { months: u.warranty_months, date: shortDate(u.warranty_expiry) }) : "—"}</dd>
            </dl>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>{t("dev.timeline")}</h2></div>
        <ol className="unittimeline">
          {events.map((e: any, i: number) => (
            <li key={i} className={`tl-${e.event.toLowerCase()}${e.status === "REVERSED" ? " tl-voided" : ""}`}>
              <div className="tl-what">
                {e.event === "SOLD" && events.slice(0, i).some((x: any) => x.event === "SOLD") ? t("dev.resold") : t.has(`dev.ev.${e.event}`) ? t(`dev.ev.${e.event}`) : e.event}
                {e.status === "REVERSED" && ` ${t("dev.voided")}`}
                {e.document_id && <> · {docLink(e.document_id, e.doc_no)}</>}
              </div>
              <div className="tl-detail">
                {[dateTime(e.created_at),
                  e.partner_name,
                  [e.from_location, e.to_location].filter(Boolean).join(" → "),
                  e.note,
                  e.acted_by && t("dev.by", { name: e.acted_by })].filter(Boolean).join(" · ")}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {can(user, "inventory.manage") && (u.status === "IN_STOCK" || u.hold_kind) && (
        <div id="hold"><SerialHoldForm serialId={u.serial_id} held={u.hold_kind} /></div>
      )}
      {holds.length > 0 && (
        <p className="page-sub">
          {t("dev.holds")} {holds.map((h: any) => `${t.has(`dev.holdKind.${h.kind}`) ? t(`dev.holdKind.${h.kind}`) : h.kind.toLowerCase()} ${shortDate(h.created_at)}${h.released_at ? `–${shortDate(h.released_at)}` : ` ${t("dev.open")}`}`).join(", ")}
        </p>
      )}
    </>
  );
}

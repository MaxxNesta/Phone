import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Factory, FileText, Package, Warehouse, ReceiptText, Store, Smartphone, MapPin, Tag } from "lucide-react";
import { requireUser, can } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { serialJourney } from "@/lib/phone";
import { shortDate } from "@/lib/format";
import { SerialHoldForm } from "@/components/serial-hold-form";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  return { title: (await getTranslations("inventory"))("journey.title") };
}

type Ref = { id: string; no: string } | null;
// Which way each event moves the phone: into stock, out of it, or neither.
const SIGN: Record<string, number> = { RECEIVED: 1, CUSTOMER_RETURN: 1, RESTORED: 1, SOLD: -1, SUPPLIER_RETURN: -1, WRITTEN_OFF: -1 };

/**
 * One phone, from supplier to customer, for anyone who can open the document
 * it was on. Physical facts only: what it is, where it came from, where it
 * went. Its cost lives in the inventory module's panel, behind that module's
 * permission, and is not read here at all.
 */
export default async function ImeiJourney({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const t = await getTranslations("inventory");
  const { id } = await params;
  const d = await serialJourney(user.companyId, id);
  // A phone at another branch is not found by someone who sees only their own.
  const seen = await seenLocations();
  if (!d || (seen && !seen.includes(d.unit.location_id as string))) notFound();
  const { unit: u, events, holds } = d;
  const status = (s: string) => (t.has(`status.${s}`) ? t(`status.${s}`) : s);
  const bill = u.bill as Ref, invoice = u.invoice as Ref;
  const sold = !!u.out_document_id;
  const options = (u.options as string[] | null) ?? [];

  /* Supplier → bill → receipt → where it was kept → invoice → customer. A
     step not reached yet stays in the row, faded, so the path reads the same
     for every phone. */
  const steps: { icon: React.ReactNode; label: string; value: string | null; href: string | null; here?: boolean }[] = [
    { icon: <Factory size={18} />, label: t("journey.supplier"), value: u.supplier_name, href: null },
    { icon: <FileText size={18} />, label: t("journey.purchaseInvoice"), value: bill?.no ?? null, href: bill ? `/documents/${bill.id}` : null },
    { icon: <Package size={18} />, label: t("journey.goodsReceipt"), value: u.received_on, href: u.received_document_id ? `/documents/${u.received_document_id}` : null },
    { icon: <Warehouse size={18} />, label: sold ? t("journey.keptAt") : t("journey.nowAt"), value: u.location_name, href: null, here: !sold },
    { icon: <ReceiptText size={18} />, label: t("journey.salesInvoice"), value: invoice?.no ?? (sold ? u.out_doc_no : null),
      href: invoice ? `/documents/${invoice.id}` : sold ? `/documents/${u.out_document_id}` : null },
    { icon: <Store size={18} />, label: t("journey.customer"), value: u.customer_name, href: null, here: sold },
  ];

  // Every document the phone was on, once, oldest first.
  const docs = new Map<string, { id: string; no: string; type: string; date: string; party: string | null }>();
  for (const e of events as any[]) {
    if (e.document_id && !docs.has(e.document_id)) docs.set(e.document_id, { id: e.document_id, no: e.doc_no, type: e.doc_type, date: e.doc_date, party: e.partner_name });
  }
  if (bill && !docs.has(bill.id)) docs.set(bill.id, { id: bill.id, no: bill.no, type: "PURCHASE_INVOICE", date: u.received_date, party: u.supplier_name });
  if (invoice && !docs.has(invoice.id)) docs.set(invoice.id, { id: invoice.id, no: invoice.no, type: "SALES_INVOICE", date: u.out_date, party: u.customer_name });
  const docType = (k: string) => (t.has(`journey.doc.${k}`) ? t(`journey.doc.${k}`) : k.replace(/_/g, " ").toLowerCase());
  const warranty = (months: number | null, to: string | null) =>
    months && to ? t("dev.monthsTo", { months, date: shortDate(to) }) : "—";

  return (
    <>
      <Breadcrumbs trail={[{ label: t("journey.crumb") }, { label: u.imei as string }]} />
      <div className="page-head">
        <h1>{t("journey.title")}</h1>
        <p className="page-sub">{t("journey.sub")}</p>
      </div>

      <section className="card ij-hero">
        <div className="ij-photo">
          {u.photo ? <img src={u.photo as string} alt="" /> : <Smartphone size={44} aria-hidden="true" />}
        </div>
        <div className="ij-what">
          <h2>{[u.model_name ?? u.item_name, ...options].join(" · ")}</h2>
          <dl className="ij-ids">
            <div><dt>{t("journey.imei")}</dt><dd className="m">{u.imei}</dd></div>
            {u.imei2 && <div><dt>{t("dev.imei2")}</dt><dd className="m">{u.imei2}</dd></div>}
            {u.device_serial && <div><dt>{t("dev.makerSerial")}</dt><dd className="m">{u.device_serial}</dd></div>}
          </dl>
          <div className="ij-chips">
            <span className={`pill ${u.status === "IN_STOCK" ? "ok" : u.status === "SOLD" ? "posted" : "warn"}`}>{status(u.status)}</span>
            {u.was_returned && <span className="pill warn">{t("dev.returnedBefore")}</span>}
            {u.hold_kind && <span className="pill warn">{t.has(`dev.holdKind.${u.hold_kind}`) ? t(`dev.holdKind.${u.hold_kind}`) : u.hold_kind}</span>}
            <span className="ij-chip"><MapPin size={14} aria-hidden="true" />{u.location_name}</span>
            {u.brand_name && <span className="ij-chip"><Tag size={14} aria-hidden="true" />{u.brand_name}</span>}
          </div>
        </div>
        <dl className="ij-facts">
          <div><dt>{t("journey.received")}</dt><dd>{u.received_date ? shortDate(u.received_date) : "—"}</dd></div>
          <div><dt>{t("dev.supplierWarranty")}</dt><dd>{warranty(u.supplier_warranty_months, u.supplier_warranty_expiry)}</dd></div>
          <div><dt>{t("journey.sold")}</dt><dd>{u.out_date ? shortDate(u.out_date) : "—"}</dd></div>
          <div><dt>{t("dev.customerWarranty")}</dt><dd>{warranty(u.warranty_months, u.warranty_expiry)}</dd></div>
        </dl>
      </section>

      <section className="card ij-flow" aria-label={t("journey.flow")}>
        {steps.map((s, i) => (
          <div key={i} className="ij-step-wrap">
            {i > 0 && <ArrowRight size={18} className="ij-arrow" aria-hidden="true" />}
            <div className={`ij-step${s.value ? "" : " ij-pending"}${s.here ? " ij-here" : ""}`}>
              <span className="ij-icon" aria-hidden="true">{s.icon}</span>
              <span className="ij-step-text">
                <small>{s.label}</small>
                {s.value
                  ? s.href ? <Link href={s.href} title={s.value}><strong>{s.value}</strong></Link> : <strong title={s.value}>{s.value}</strong>
                  : <span className="page-sub">{t("journey.notYet")}</span>}
              </span>
            </div>
          </div>
        ))}
      </section>

      <div className="ij-grid">
        <section className="card">
          <div className="card-head"><h2>{t("journey.movements")}</h2></div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>{t("journey.date")}</th><th>{t("journey.document")}</th><th>{t("journey.movement")}</th><th className="r">{t("journey.qty")}</th></tr></thead>
              <tbody>
                {(events as any[]).map((e, i) => {
                  const sign = SIGN[e.event] ?? 0;
                  const what = e.event === "SOLD" && (events as any[]).slice(0, i).some((x) => x.event === "SOLD") ? t("dev.resold")
                    : t.has(`dev.ev.${e.event}`) ? t(`dev.ev.${e.event}`) : e.event;
                  return (
                    <tr key={i} className={e.status === "REVERSED" ? "ij-voided" : undefined}>
                      <td>{shortDate(e.created_at)}</td>
                      <td className="code">{e.document_id ? <Link href={`/documents/${e.document_id}`}>{e.doc_no}</Link> : "—"}</td>
                      <td className="wrap">
                        {what}{e.status === "REVERSED" && ` ${t("dev.voided")}`}
                        <div className="subline">{[e.partner_name, [e.from_location, e.to_location].filter(Boolean).join(" → "), e.acted_by && t("dev.by", { name: e.acted_by })].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td className={`r ij-qty${sign > 0 ? " in" : sign < 0 ? " out" : ""}`}>{sign > 0 ? "+1" : sign < 0 ? "−1" : "·"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>{t("journey.linked")}</h2></div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>{t("journey.document")}</th><th>{t("journey.type")}</th><th>{t("journey.date")}</th><th>{t("journey.party")}</th></tr></thead>
              <tbody>
                {[...docs.values()].map((x) => (
                  <tr key={x.id}>
                    <td className="code"><Link href={`/documents/${x.id}`}>{x.no}</Link></td>
                    <td>{docType(x.type)}</td>
                    <td>{x.date ? shortDate(x.date) : "—"}</td>
                    <td>{x.party ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {can(user, "inventory.manage") && (u.status === "IN_STOCK" || u.hold_kind) && (
        <div id="hold"><SerialHoldForm serialId={u.serial_id as string} held={u.hold_kind as string | null} /></div>
      )}
      {holds.length > 0 && (
        <p className="page-sub">
          {t("dev.holds")} {holds.map((h: any) => `${t.has(`dev.holdKind.${h.kind}`) ? t(`dev.holdKind.${h.kind}`) : h.kind.toLowerCase()} ${shortDate(h.created_at)}${h.released_at ? `–${shortDate(h.released_at)}` : ` ${t("dev.open")}`}`).join(", ")}
        </p>
      )}
    </>
  );
}

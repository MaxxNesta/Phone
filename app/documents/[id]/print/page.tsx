import { hidesPay } from "@/lib/hr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  getCompany, getDocument, getDocumentLines, getJournalForDocument, rejectedOnReceipt,
} from "@/lib/queries";
import { PrintableDocument, type PrintableDoc } from "@/components/printable-document";
import { PrintButton } from "@/components/print-button";
import { requireUser, can, permissionForDocument } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";

/**
 * A document as paper, for every type.
 *
 * One layout rather than twelve, for the reason the screen has one shell:
 * the differences between an invoice and a delivery note are a title, whose
 * name goes at the top and whether money or quantity is the point — not a
 * different piece of paper.
 *
 * A page of its own rather than @media print over the screen. Printing by
 * subtraction leaves the spacing of a web app on A4, and it cannot be looked
 * at before it comes out of the printer.
 */

const TITLE: Record<string, string> = {
  PURCHASE_ORDER: "Purchase order", GOODS_RECEIPT: "Goods received note",
  PURCHASE_INVOICE: "Purchase invoice", PURCHASE_RETURN: "Purchase return",
  SUPPLIER_PAYMENT: "Payment voucher", SALES_ORDER: "Sales order",
  DELIVERY: "Delivery note", SALES_INVOICE: "Invoice",
  SALES_RETURN: "Credit note", CUSTOMER_RECEIPT: "Receipt voucher", CUSTOMER_REFUND: "Refund voucher", SUPPLIER_REFUND: "Supplier refund voucher",
  STOCK_ADJUSTMENT: "Stock adjustment", STOCK_TRANSFER: "Stock transfer note",
  JOURNAL_VOUCHER: "Journal voucher", CASH_VOUCHER: "Cash voucher",
  BANK_VOUCHER: "Bank voucher", CASH_TRANSFER: "Transfer voucher",
  OPENING_BALANCE: "Opening balances", CONSIGNMENT_RECEIPT: "Consignment receipt", LANDED_COST: "Landed cost",
};

const SUPPLIER_SIDE = new Set([
  "PURCHASE_ORDER", "GOODS_RECEIPT", "PURCHASE_INVOICE", "PURCHASE_RETURN",
  "SUPPLIER_PAYMENT", "CONSIGNMENT_RECEIPT",
]);

/** Which pieces of paper are signed for, and by whom. */
const SIGNATURES: Record<string, string[]> = {
  GOODS_RECEIPT: ["Received by", "Checked by", "Approved by"],
  DELIVERY: ["Delivered by", "Received by", "Approved by"],
  STOCK_TRANSFER: ["Sent by", "Received by", "Approved by"],
  STOCK_ADJUSTMENT: ["Counted by", "Approved by"],
  CUSTOMER_RECEIPT: ["Received by", "Approved by"],
  CUSTOMER_REFUND: ["Paid by", "Received by customer"],
  SUPPLIER_REFUND: ["Paid by supplier", "Received by"],
  SUPPLIER_PAYMENT: ["Paid by", "Received by", "Approved by"],
  CASH_VOUCHER: ["Prepared by", "Received by", "Approved by"],
  BANK_VOUCHER: ["Prepared by", "Approved by"],
  JOURNAL_VOUCHER: ["Prepared by", "Approved by"],
  OPENING_BALANCE: ["Prepared by", "Approved by"],
};

const shortDate = (v: unknown) =>
  v ? new Date(String(v)).toLocaleDateString("en-GB",
    { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }) : "";

export default async function DocumentPrint({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ slip?: string }>;
}) {
  const { id } = await params;
  // A goods receipt's refused units on their own paper, to go back to the
  // supplier with them (docs/06 D-P7).
  const rejectionSlip = (await searchParams)?.slip === "rejection";
  const user = await requireUser();
  const [company, doc] = await Promise.all([getCompany(), getDocument(id)]);
  // The same gate as the document itself: paper is no way round it.
  if (!company || !doc || (doc as any).company_id !== user.companyId
      || !can(user, permissionForDocument((doc as any).doc_type))) notFound();
  const seen = await seenLocations();
  if (seen && !seen.includes((doc as any).location_id)) notFound();
  if (await hidesPay(user, id)) notFound();

  const d = doc as any;
  const [lines, journal] = await Promise.all([
    getDocumentLines(id) as Promise<any[]>,
    d.journal_entry_id ? getJournalForDocument(d.journal_entry_id) as Promise<any[]> : [],
  ]);

  const title = TITLE[d.doc_type] ?? String(d.doc_type).replace(/_/g, " ").toLowerCase();
  const isSupplier = SUPPLIER_SIDE.has(d.doc_type);

  // A document with item lines is described by them. One without — a voucher,
  // a payment — is described by what it did to the accounts, which is the
  // only record of it there is.
  const hasLines = lines.length > 0;
  // Deliveries, transfers and adjustments are valued at cost.
  const hideValue = ["DELIVERY", "STOCK_TRANSFER", "STOCK_ADJUSTMENT"].includes(d.doc_type)
    && !can(user, "cost.view");

  if (rejectionSlip && d.doc_type === "GOODS_RECEIPT") {
    const refused = await rejectedOnReceipt(id) as any[];
    if (refused.length === 0) notFound();
    const asks = new Set(refused.map((r) => r.reject_outcome));
    const slip: PrintableDoc = {
      company: { name: company.name, nameMy: company.name_my, currency: company.base_currency },
      title: "Rejection note",
      docNo: d.doc_no,
      date: shortDate(d.doc_date),
      reference: d.reference ?? null,
      partnerLabel: "Supplier",
      partner: d.partner_name ? {
        code: d.partner_code, name: d.partner_name,
        address: d.partner_address ?? null, township: d.partner_township ?? null,
        phone: d.partner_phone ?? null,
      } : null,
      location: d.location_name ?? null,
      memo: `These goods arrived on ${d.doc_no} and were refused. We ask you to `
        + (asks.size > 1 ? "replace or credit them as marked on each line."
          : asks.has("REPLACE") ? "replace them." : "credit them against your invoice."),
      lines: refused.map((r, i) => ({
        no: i + 1,
        code: r.item_code,
        name: r.item_name,
        note: [
          (r.units as any[]).length ? `${r.item_identity === "IMEI" ? "IMEI" : "Serial"} ${(r.units as any[]).map((u) => u.imei).join(", ")}` : null,
          `Fault: ${r.reject_reason}`,
          asks.size > 1 ? (r.reject_outcome === "REPLACE" ? "Please replace" : "Please credit") : null,
        ].filter(Boolean).join(" · "),
        qty: Number(r.entered_qty),
        uom: r.uom_code ?? null,
        unitPrice: can(user, "cost.view") ? Number(r.unit_cost) : null,
        amount: can(user, "cost.view") ? Number(r.unit_cost) * Number(r.entered_qty) : null,
      })),
      totals: [],
      signatures: ["Handed back by", "Received by (supplier)"],
    };
    return (
      <>
        <div className="actions noprint" style={{ marginBottom: "0.5rem" }}>
          <Link href={`/documents/${id}`} className="btn ghost tiny">
            <ArrowLeft size={13} aria-hidden="true" /> Back to the document
          </Link>
          <PrintButton />
        </div>
        <div className="sheetwrap">
          <PrintableDocument doc={slip} />
        </div>
      </>
    );
  }

  const printable: PrintableDoc = {
    company: { name: company.name, nameMy: company.name_my, currency: company.base_currency },
    title,
    docNo: d.doc_no ?? "Draft",
    status: d.status,
    date: shortDate(d.doc_date),
    dueDate: d.due_date ? shortDate(d.due_date) : null,
    reference: d.reference ?? null,
    partnerLabel: isSupplier ? "Supplier" : "Customer",
    partner: d.partner_name ? {
      code: d.partner_code, name: d.partner_name,
      address: d.partner_address ?? null, township: d.partner_township ?? null,
      phone: d.partner_phone ?? null,
    } : null,
    location: d.location_name ?? null,
    memo: d.memo ?? null,
    lines: hasLines ? lines.map((l, i) => ({
      no: i + 1,
      code: l.item_code ?? null,
      name: l.item_name ?? l.description ?? "—",
      qty: l.entered_qty != null ? Number(l.entered_qty) : null,
      uom: l.uom_code ?? null,
      unitPrice: hideValue || l.unit_price == null ? null : Number(l.unit_price),
      amount: hideValue ? null : Number(l.net_amount ?? 0),
    })) : undefined,
    entries: hasLines ? undefined : journal.map((j) => ({
      account: `${j.account_code} · ${j.account_name}`,
      description: j.memo ?? null,
      debit: Number(j.debit),
      credit: Number(j.credit),
    })),
    totals: hideValue ? [] : hasLines
      ? [
          ...(Number(d.net_total) !== Number(d.gross_total)
            ? [{ label: "Subtotal", value: Number(d.net_total) },
               { label: "Tax", value: Number(d.tax_total) }]
            : []),
          { label: "Total", value: Number(d.gross_total), strong: true },
        ]
      : [{ label: "Total", value: journal.reduce((s, j) => s + Number(j.debit), 0), strong: true }],
    signatures: SIGNATURES[d.doc_type],
  };

  return (
    <>
      <div className="actions noprint" style={{ marginBottom: "0.5rem" }}>
        <Link href={`/documents/${id}`} className="btn ghost tiny">
          <ArrowLeft size={13} aria-hidden="true" /> Back to the document
        </Link>
        <PrintButton />
      </div>

      <div className="sheetwrap">
        <PrintableDocument doc={printable} />
      </div>
    </>
  );
}

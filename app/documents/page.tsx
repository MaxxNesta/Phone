import { requireUser, canSeeDocument } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import Link from "next/link";
import { getCompany, getDocuments } from "@/lib/queries";
import { ErpDocumentList, type DocRow } from "@/components/erp-document-list";

const TYPES: [string, string][] = [
  ["", "All"],
  ["PURCHASE_ORDER", "Purchase orders"],
  ["GOODS_RECEIPT", "Goods receipts"],
  ["PURCHASE_INVOICE", "Purchase invoices"],
  ["PURCHASE_RETURN", "Purchase returns"],
  ["SUPPLIER_PAYMENT", "Supplier payments"],
  ["SALES_ORDER", "Sales orders"],
  ["DELIVERY", "Deliveries"],
  ["SALES_INVOICE", "Sales invoices"],
  ["SALES_RETURN", "Sales returns"],
  ["CUSTOMER_RECEIPT", "Customer receipts"],
  ["STOCK_ADJUSTMENT", "Stock adjustments"],
  ["STOCK_TRANSFER", "Stock transfers"],
];

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; open?: string }>;
}) {
  const { type, open } = await searchParams;
  const openOnly = open === "grir";
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;

  // Only the document types this person may open: a cashier lists sales, not purchases or vouchers.
  const user = await requireUser();
  const docs = ((await getDocuments(company.id, type || undefined, openOnly, undefined, await seenLocations())) as any[])
    .filter((d) => canSeeDocument(user, d.doc_type));

  const rows: DocRow[] = docs.map((d) => ({
    id: d.id,
    docNo: d.doc_no ?? null,
    docType: d.doc_type,
    status: d.status,
    partnerName: d.partner_name ?? null,
    postingDate: d.posting_date ? String(d.posting_date) : null,
    dueDate: d.due_date ? String(d.due_date) : null,
    sourceDocNo: d.source_doc_no ?? null,
    grossTotal: Number(d.gross_total),
    composed: !!d.composed,
  }));

  const active = TYPES.find(([v]) => v === (type ?? ""));
  const title = openOnly ? "Awaiting a matching document" : "Documents";

  return (
    <>
      {/* The type filters stay a visible row rather than hiding inside a
          dropdown: there are twelve document types and which one you are
          looking at is the main thing this screen is for. */}
      <div className="erp-typebar" data-density="odoo">
        {TYPES.map(([value, text]) => {
          const href = value
            ? `/documents?type=${value}${openOnly ? "&open=grir" : ""}`
            : openOnly ? "/documents?open=grir" : "/documents";
          return (
            <Link
              key={value}
              href={href}
              className={`erp-type ${(type ?? "") === value ? "here" : ""}`}
            >
              {text}
            </Link>
          );
        })}
      </div>

      <ErpDocumentList
        rows={rows}
        title={title}
        typeFilter={
          type && active
            ? { label: active[1], clearHref: openOnly ? "/documents?open=grir" : "/documents" }
            : null
        }
      />
    </>
  );
}

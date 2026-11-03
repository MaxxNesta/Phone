import { seenLocations } from "@/lib/branch-scope";
import Link from "next/link";
import { money, shortDate } from "@/lib/db";
import {
  invoiceDisplayStatus, INVOICE_STATUS_LABEL, INVOICE_STATUS_PILL,
  type InvoiceDisplayStatus,
} from "@/lib/format";
import { getCompany, getInvoiceList, getDocumentDrafts } from "@/lib/queries";
import { DataTable, type DataRow } from "@/components/data-table";
import { HelpHint } from "@/components/help-hint";
import { getImportedInvoiceRows } from "@/lib/historical-purchases";

const toTime = (v: unknown) => (v ? new Date(v as string).getTime() : 0);

/** Imported from the old system: a record, never a payable, so a status of its own. */
type ListStatus = InvoiceDisplayStatus | "IMPORTED";
const LABEL: Record<ListStatus, string> = { ...INVOICE_STATUS_LABEL, IMPORTED: "Imported" };
const PILL: Record<ListStatus, string> = { ...INVOICE_STATUS_PILL, IMPORTED: "info" };

const TABS: Array<["" | ListStatus, string]> = [
  ["", "All"],
  ["DRAFT", "Draft"],
  ["OPEN", "Posted"],
  ["PARTIALLY_PAID", "Partially Paid"],
  ["PAID", "Paid"],
  ["OVERDUE", "Overdue"],
  ["IMPORTED", "Imported"],
];

export default async function PurchaseInvoices({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; supplier?: string }>;
}) {
  const { status, supplier } = await searchParams;
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;

  const postedRows = (await getInvoiceList(company.id, "PURCHASE_INVOICE", await seenLocations())) as any[];

  // Unfinished bills, in the same shape as the rest of the list. They live in
  // their own table rather than in `document` (migration 0103), so they are
  // joined on here. Nil paid and nil outstanding are the truth: a draft has
  // never been a payable.
  const drafts = (await getDocumentDrafts(company.id, "PURCHASE_INVOICE")) as any[];
  const draftRows = drafts.map((d) => ({
    document_id: d.id, draft_id: d.id as string,
    doc_no: null, posting_date: d.doc_date, due_date: null,
    partner_id: null, partner_code: d.partner_code,
    partner_name: d.partner_name ?? "No supplier yet",
    gross_total: d.total, paid: 0, outstanding: 0,
    doc_status: "DRAFT", payment_status: null, days_overdue: null,
    line_count: Number(d.line_count ?? 0),
  }));

  // Imported from the old system. Nothing paid, nothing owing: they never
  // were payables here, so they stay out of every total above the list.
  const importedRows = ((await getImportedInvoiceRows(company.id, await seenLocations())) as any[]).map((h) => ({
    document_id: h.id, imported: true, old_ref: h.old_ref as string,
    doc_no: h.invoice_no, posting_date: h.doc_date, due_date: null,
    partner_id: h.partner_id, partner_code: h.partner_code, partner_name: h.partner_name,
    gross_total: h.net_total, paid: 0, outstanding: 0,
    doc_status: "IMPORTED", payment_status: null, days_overdue: null, item_qty: h.item_qty,
  }));

  const all: any[] = [...draftRows, ...postedRows, ...importedRows];

  const withStatus = all.map((r) => ({
    ...r,
    display: (r.imported ? "IMPORTED" : invoiceDisplayStatus({
      docStatus: r.doc_status, paymentStatus: r.payment_status,
      outstanding: r.outstanding, daysOverdue: r.days_overdue,
    })) as ListStatus,
  }));

  const forSupplier = supplier ? withStatus.filter((r) => r.partner_id === supplier) : withStatus;
  const invoices = status ? forSupplier.filter((r) => r.display === status) : forSupplier;

  const posted = forSupplier.filter((r) => r.doc_status === "POSTED");
  const totalBilled = posted.reduce((s, r) => s + Number(r.gross_total), 0);
  const totalOutstanding = posted.reduce((s, r) => s + Number(r.outstanding), 0);
  const totalOverdue = posted
    .filter((r) => r.display === "OVERDUE")
    .reduce((s, r) => s + Number(r.outstanding), 0);
  const totalPaid = posted.reduce((s, r) => s + Number(r.paid), 0);

  const supplierName = supplier ? forSupplier[0]?.partner_name : null;

  const rows: DataRow[] = invoices.map((i) => ({
    key: i.document_id,
    searchText: [i.doc_no, i.old_ref, i.partner_name].filter(Boolean).join(" "),
    sort: {
      doc_no: i.doc_no ?? "",
      kind: i.imported ? "Imported" : "Normal",
      old_ref: i.old_ref ?? "",
      item_qty: Number(i.item_qty ?? 0),
      posting_date: toTime(i.posting_date),
      due_date: toTime(i.due_date),
      partner_name: i.partner_name ?? "",
      gross_total: Number(i.gross_total),
      paid: Number(i.paid),
      outstanding: Number(i.outstanding),
      display: LABEL[i.display as ListStatus],
    },
    node: (
      <tr className="link">
        <td className="code">
          {/* A draft has no document to open — the link goes back to the
              form it came out of. */}
          <Link href={i.draft_id ? `/purchases/new?draft=${i.draft_id}`
                      : i.imported ? `/purchases/invoices/imported?q=${encodeURIComponent(i.doc_no)}` : `/documents/${i.document_id}`}
                style={{ color: "var(--link)" }}>
            {i.doc_no ?? "Resume"}
          </Link>
        </td>
        <td className="narrow">{i.imported ? "Imported historical" : "Normal"}</td>
        <td className="code narrow">{i.old_ref ?? "—"}</td>
        <td className="code">{shortDate(i.posting_date)}</td>
        <td className="code">{i.due_date ? shortDate(i.due_date) : "—"}</td>
        <td className="wrap">
          {i.draft_id ? (
            <>
              {i.partner_name}
              <div className="subline">
                {i.line_count === 1 ? "1 line" : `${i.line_count} lines`} · not posted
              </div>
            </>
          ) : (
            <Link href={`/purchases/invoices?supplier=${i.partner_id}`} style={{ color: "inherit" }}>
              {i.partner_name}
            </Link>
          )}
        </td>
        <td className="r narrow">{i.draft_id ? "—" : Number(i.item_qty ?? 0).toLocaleString("en-US")}</td>
        <td className="r">{money(i.gross_total)}</td>
        <td className="r">{i.imported ? "—" : money(i.paid)}</td>
        <td className="r">{i.imported ? "—" : money(i.outstanding)}</td>
        <td>
          <span className={`pill ${PILL[i.display as ListStatus]}`}>
            {LABEL[i.display as ListStatus]}
          </span>
        </td>
        <td className="tight">
          {i.doc_status === "POSTED" && Number(i.outstanding) > 0 && (
            <Link href={`/payables/pay?partner=${i.partner_id}&invoice=${i.document_id}`} className="btn ghost tiny">
              Pay
            </Link>
          )}
        </td>
      </tr>
    ),
  }));

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">Purchases</span>
        <h1>Purchase Invoices</h1>
        <HelpHint>
          {supplierName ? (
            <>
              Filtered to <strong>{supplierName}</strong>.{" "}
              <Link href="/purchases/invoices" style={{ color: "var(--link)" }}>Clear</Link>
            </>
          ) : (
            "Manage purchase invoices."
          )}
        </HelpHint>
      </div>

      <div className="actions">
        <Link href="/purchases/new" className="btn">+ New Purchase Invoice</Link>
        <Link href="/purchases/invoices/import" className="btn ghost">Import invoices</Link>
      </div>

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">Total Billed</span>
          <span className="kpi-value">{money(totalBilled)}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Outstanding</span>
          <span className="kpi-value">{money(totalOutstanding)}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Overdue</span>
          <span className="kpi-value" style={{ color: totalOverdue > 0 ? "var(--bad)" : undefined }}>
            {money(totalOverdue)}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Paid</span>
          <span className="kpi-value">{money(totalPaid)}</span>
        </div>
      </div>

      <div className="flow">
        {TABS.map(([value, label]) => (
          <Link
            key={value}
            href={
              (value ? `/purchases/invoices?status=${value}` : "/purchases/invoices") +
              (supplier && value ? `&supplier=${supplier}` : supplier ? `?supplier=${supplier}` : "")
            }
            className={`flow-node ${(status ?? "") === value ? "here" : ""}`}
          >
            {label}
          </Link>
        ))}
      </div>

      <section>
        <div className="card">
          <div className="card-head">
            <h2>{TABS.find(([v]) => v === (status ?? ""))?.[1] ?? "All"}</h2>
            <span className="page-sub">{invoices.length} invoice{invoices.length === 1 ? "" : "s"}</span>
          </div>
          <DataTable
            rows={rows}
            emptyLabel="No purchase invoices"
            searchPlaceholder="Search invoices…"
            defaultSort={{ key: "posting_date", dir: "desc" }}
            columns={[
              { key: "doc_no", label: "Invoice #", sortable: true },
              { key: "kind", label: "Type", sortable: true },
              { key: "old_ref", label: "Old document ID", sortable: true },
              { key: "posting_date", label: "Date", sortable: true },
              { key: "due_date", label: "Due Date", sortable: true },
              { key: "partner_name", label: "Supplier", sortable: true },
              { key: "item_qty", label: "Items", sortable: true, align: "r" },
              { key: "gross_total", label: "Total", sortable: true, align: "r" },
              { key: "paid", label: "Paid", sortable: true, align: "r" },
              { key: "outstanding", label: "Balance", sortable: true, align: "r" },
              { key: "display", label: "Status", sortable: true },
              { key: "actions", label: "" },
            ]}
          />
        </div>
      </section>
    </>
  );
}

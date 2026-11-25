import { seenLocations } from "@/lib/branch-scope";
import Link from "next/link";
import { money, shortDate } from "@/lib/db";
import {
  invoiceDisplayStatus, INVOICE_STATUS_LABEL, INVOICE_STATUS_PILL,
  type InvoiceDisplayStatus,
} from "@/lib/format";
import { getCompany, getInvoiceList, getDocumentDrafts } from "@/lib/queries";
import { DataTable, type DataRow } from "@/components/data-table";
import { serverPage } from "@/lib/server-page";
import { SalesInvoiceExport } from "@/components/sales-invoice-export";
import { HelpHint } from "@/components/help-hint";

const toTime = (v: unknown) => (v ? new Date(v as string).getTime() : 0);

const TABS: Array<["" | InvoiceDisplayStatus, string]> = [
  ["", "All"],
  ["DRAFT", "Draft"],
  ["OPEN", "Posted"],
  ["PARTIALLY_PAID", "Partially Paid"],
  ["PAID", "Paid"],
  ["OVERDUE", "Overdue"],
];

export default async function SalesInvoices({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { status, customer } = sp;
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;

  // Independent reads, so in parallel: one wait, not two.
  const [postedAll, draftsAll] = await Promise.all([
    seenLocations().then((locs) => getInvoiceList(company.id, "SALES_INVOICE", locs)),
    getDocumentDrafts(company.id, "SALES_INVOICE"),
  ]);
  const posted_ = postedAll as any[];

  /**
   * Unfinished vouchers, wearing the same shape as the rest of the list.
   *
   * They live in their own table rather than in `document` (see migration
   * 0103), so they are joined on here instead of coming back from the same
   * query. Nil paid and nil outstanding are the truth, not placeholders: a
   * draft has never been a receivable. The Draft tab has existed all along
   * and had nothing to show.
   */
  const drafts = draftsAll as any[];
  const draftRows = drafts.map((d) => ({
    document_id: d.id, draft_id: d.id as string,
    doc_no: null, posting_date: d.doc_date, due_date: null,
    partner_id: null, partner_code: d.partner_code,
    partner_name: d.partner_name ?? "No customer yet",
    gross_total: d.total, paid: 0, outstanding: 0,
    doc_status: "DRAFT", payment_status: null, days_overdue: null,
    line_count: Number(d.line_count ?? 0),
  }));

  const all = [...draftRows, ...posted_];

  const withStatus = all.map((r) => ({
    ...r,
    display: invoiceDisplayStatus({
      docStatus: r.doc_status, paymentStatus: r.payment_status,
      outstanding: r.outstanding, daysOverdue: r.days_overdue,
    }),
  }));

  // A draft has no partner_id on the row, so filtering by customer hides
  // them — which is right: that view is "this customer's invoices", and an
  // unposted one is not yet anybody's.
  const forCustomer = customer ? withStatus.filter((r) => r.partner_id === customer) : withStatus;
  const invoices = status ? forCustomer.filter((r) => r.display === status) : forCustomer;

  // Only what actually posted counts toward the KPIs — a draft or a
  // cancelled invoice was never a real receivable.
  const posted = forCustomer.filter((r) => r.doc_status === "POSTED");
  const totalInvoiced = posted.reduce((s, r) => s + Number(r.gross_total), 0);
  const totalOutstanding = posted.reduce((s, r) => s + Number(r.outstanding), 0);
  const totalOverdue = posted
    .filter((r) => r.display === "OVERDUE")
    .reduce((s, r) => s + Number(r.outstanding), 0);
  // Paid is new money; an advance put against a bill is shown on its own.
  const advOf = (r: any) => Number(r.adv_applied ?? 0);
  const totalAdv = posted.reduce((s, r) => s + advOf(r), 0);
  const totalPaid = posted.reduce((s, r) => s + Number(r.paid), 0) - totalAdv;

  const customerName = customer ? forCustomer[0]?.partner_name : null;

  const rows: DataRow[] = invoices.map((i) => ({
    key: i.document_id,
    searchText: [i.doc_no, i.partner_name].filter(Boolean).join(" "),
    facet: { channel: i.channel ?? "INVOICE", customer: i.partner_id ?? "" },
    sort: {
      doc_no: i.doc_no ?? "",
      posting_date: toTime(i.posting_date),
      channel: i.channel ?? "INVOICE",
      due_date: toTime(i.due_date),
      partner_name: i.partner_name ?? "",
      gross_total: Number(i.gross_total),
      paid: Number(i.paid) - advOf(i),
      adv_applied: advOf(i),
      outstanding: Number(i.outstanding),
      display: INVOICE_STATUS_LABEL[i.display as InvoiceDisplayStatus],
    },
    // Built only when sent: of a long list, only the page on screen is.
    get node() {
      return (
      <tr className="link">
        <td className="code">
          {/* A draft has no document to open — the link goes back to the
              form it came out of, which is the only thing you can do with
              one. */}
          <Link href={i.draft_id ? `/sales/new?draft=${i.draft_id}` : `/documents/${i.document_id}`}
                style={{ color: "var(--link)" }}>
            {i.doc_no ?? "Resume"}
          </Link>
        </td>
        <td className="code">{shortDate(i.posting_date)}</td>
        <td>
          <span className={`pill ${i.channel === "POS" ? "posted" : i.channel === "COD" ? "warn" : "draft"}`}>
            {i.channel === "POS" ? "Counter sale" : i.channel === "COD" ? "Cash on delivery" : "Sales invoice"}
          </span>
        </td>
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
            <Link href={`/sales/invoices?customer=${i.partner_id}`} style={{ color: "inherit" }}>
              {i.partner_name}
            </Link>
          )}
        </td>
        <td className="r">{money(i.gross_total)}</td>
        <td className="r">{money(Number(i.paid) - advOf(i))}</td>
        <td className="r">{advOf(i) > 0.005 ? <span className="bal-adv">{money(advOf(i))}</span> : "—"}</td>
        <td className="r">{money(i.outstanding)}</td>
        <td>
          <span className={`pill ${INVOICE_STATUS_PILL[i.display as InvoiceDisplayStatus]}`}>
            {INVOICE_STATUS_LABEL[i.display as InvoiceDisplayStatus]}
          </span>
        </td>
        <td className="tight">
          {i.channel === "POS" && i.doc_status === "POSTED" && !i.draft_id && (
            <a href={`/pos/receipt/${i.document_id}?print=1`} target="_blank" rel="noopener" className="btn ghost tiny">
              Receipt
            </a>
          )}
          {i.doc_status === "POSTED" && Number(i.outstanding) > 0 && (
            <Link href={`/receivables/receive?partner=${i.partner_id}&invoice=${i.document_id}`} className="btn ghost tiny">
              Receive
            </Link>
          )}
        </td>
      </tr>
      );
    },
  }));

  // Cut to the page on screen here, so only its rows are rendered and sent.
  const page = serverPage(rows, sp, { key: "posting_date", dir: "desc" });

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">Sales</span>
        <h1>Sales Invoices</h1>
        <HelpHint>
          {customerName ? (
            <>
              Filtered to <strong>{customerName}</strong>.{" "}
              <Link href="/sales/invoices" style={{ color: "var(--link)" }}>Clear</Link>
            </>
          ) : (
            "Manage sales invoices."
          )}
        </HelpHint>
      </div>

      <div className="actions">
        <Link href="/sales/new" className="btn">+ New sales invoice</Link>
        <Link href="/sales/invoices/import" className="btn ghost">Import invoices</Link>
        <Link href="/pos" className="btn ghost">Open POS</Link>
      </div>

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">Total Invoiced</span>
          <span className="kpi-value">{money(totalInvoiced)}</span>
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
          {totalAdv > 0.005 && <span className="kpi-note">+ {money(totalAdv)} from advances</span>}
        </div>
      </div>

      <div className="flow">
        {TABS.map(([value, label]) => (
          <Link
            key={value}
            href={
              (value ? `/sales/invoices?status=${value}` : "/sales/invoices") +
              (customer && value ? `&customer=${customer}` : customer ? `?customer=${customer}` : "")
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
            rows={page.rows}
            server={page.server}
            emptyLabel="No sales invoices"
            searchPlaceholder="Search invoices…"
            defaultSort={{ key: "posting_date", dir: "desc" }}
            filters={[{ key: "channel", allLabel: "All channels",
                        options: [{ value: "POS", label: "Counter sale" }, { value: "INVOICE", label: "Sales invoice" }, { value: "COD", label: "Cash on delivery" }] },
                      // Some customers' invoices: what a statement or an export for a few shops starts from.
                      { key: "customer", allLabel: "All customers", label: "Customers", multi: true,
                        options: [...new Map(invoices.filter((i) => i.partner_id && i.partner_name)
                          .map((i) => [i.partner_id as string, i.partner_name as string])).entries()]
                          .sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label })) }]}
            toolbarEnd={<SalesInvoiceExport />}
            columns={[
              { key: "doc_no", label: "Invoice #", sortable: true },
              { key: "posting_date", label: "Date", sortable: true },
              { key: "channel", label: "Channel", sortable: true },
              { key: "due_date", label: "Due Date", sortable: true },
              { key: "partner_name", label: "Customer", sortable: true },
              { key: "gross_total", label: "Total", sortable: true, align: "r" },
              { key: "paid", label: "Paid", sortable: true, align: "r" },
              { key: "adv_applied", label: "Adv. applied", sortable: true, align: "r" },
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

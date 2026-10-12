import Link from "next/link";
import { Plus } from "lucide-react";
import { money } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { listLandedCosts, LC_STATUS } from "@/lib/landed-cost-queries";
import { DataTable, type DataRow } from "@/components/data-table";
import { HelpHint } from "@/components/help-hint";
import { BranchScope } from "@/components/branch-scope";

export default async function LandedCosts({ searchParams }: { searchParams: Promise<{ gr?: string }> }) {
  const user = await requirePermission("cost.view");
  const { gr } = await searchParams;
  const all = (await listLandedCosts(user.companyId, await seenLocations())) as any[];
  const rows = gr ? all.filter((r) => (r.receipt_ids ?? []).includes(gr)) : all;

  const facets = (key: string) =>
    // As the rows carry them: a landed cost over two suppliers' receipts is
    // filtered as that pair, since the table matches a facet exactly.
    [...new Set(rows.map((r) => String(r[key] ?? "")).filter(Boolean))].sort()
      .map((v) => ({ value: v, label: v }));

  const data: DataRow[] = rows.map((r) => ({
    key: r.id,
    searchText: [r.doc_no, r.receipts, r.suppliers, r.payees, r.shipment_ref, r.carrier_ref, r.warehouses].filter(Boolean).join(" "),
    facet: { status: r.status, supplier: r.suppliers, warehouse: r.warehouses },
    sort: {
      doc_no: r.doc_no, posting_date: Date.parse(r.doc_date), total: Number(r.total),
      status: LC_STATUS[r.status] ?? r.status,
    },
    node: (
      <tr className="link">
        <td><Link href={`/purchases/landed-costs/${r.id}`} className="m">{r.doc_no}</Link></td>
        <td>{r.doc_date}</td>
        <td className="wrap">
          <span className="m">{r.receipts || "—"}</span>
          {r.suppliers && <div className="m" style={{ color: "var(--muted)" }}>{r.suppliers}</div>}
        </td>
        <td className="wrap">{r.shipment_ref || "—"}</td>
        <td className="r">{money(r.total)} <span className="m" style={{ color: "var(--muted)" }}>{r.currency}</span></td>
        <td><span className={`lc-status lc-${String(r.status).toLowerCase()}`}>{LC_STATUS[r.status] ?? r.status}</span></td>
        <td>{r.posted_by || "—"}</td>
      </tr>
    ),
  }));

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">Purchases</span>
        <h1>Landed costs</h1>
        <BranchScope />
        <HelpHint>
          Freight, insurance, customs duty and clearance are part of what a
          phone cost. A landed cost takes those charges, spreads them over the
          phones of one or more posted goods receipts, and adds each phone&rsquo;s
          share to its cost. Phones still in stock go up in value; a phone
          already sold puts its share into cost of sales.
        </HelpHint>
        <span className="actions">
          <Link href="/purchases/landed-costs/new" className="btn"><Plus size={16} aria-hidden="true" /> New landed cost</Link>
        </span>
      </div>

      {gr && (
        <p className="filters-note">
          Showing landed costs for one goods receipt. <Link href="/purchases/landed-costs">Show all</Link>
        </p>
      )}

      <div className="card">
        <DataTable
          rows={data}
          emptyLabel="No landed costs yet. Open a posted goods receipt and choose Add landed cost, or start a new one here."
          searchPlaceholder="Search number, receipt, supplier, shipment…"
          defaultSort={{ key: "posting_date", dir: "desc" }}
          filters={[
            { key: "status", allLabel: "Any status", options: Object.entries(LC_STATUS).map(([value, label]) => ({ value, label })) },
            { key: "supplier", allLabel: "Any supplier", options: facets("suppliers") },
            { key: "warehouse", allLabel: "Any warehouse", options: facets("warehouses") },
          ]}
          columns={[
            { key: "doc_no", label: "Number", sortable: true },
            { key: "posting_date", label: "Date", sortable: true },
            { key: "receipts", label: "Goods receipts" },
            { key: "shipment", label: "Shipment" },
            { key: "total", label: "Charges", sortable: true, align: "r" },
            { key: "status", label: "Status", sortable: true },
            { key: "posted_by", label: "Posted by" },
          ]}
        />
      </div>
    </>
  );
}

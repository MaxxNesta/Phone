import Link from "next/link";
import { Plus } from "lucide-react";
import { money, qty, shortDate, sql } from "@/lib/db";
import { requirePermission, can } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { DataTable, type DataRow } from "@/components/data-table";
import { HelpHint } from "@/components/help-hint";
import { BranchScope } from "@/components/branch-scope";
import { getTranslations } from "next-intl/server";

/**
 * Stock adjustments, the list first (2026-11-27): the menu used to open a
 * blank form, so finding last month's write-off meant the documents screen.
 * The form is one button away, top right, as Record carriage inward is.
 */
export default async function StockAdjustments() {
  const user = await requirePermission("inventory.manage");
  const t = await getTranslations("inventory");
  const n = await getTranslations("nav");
  const seeCost = can(user, "cost.view");
  const locs = await seenLocations();
  const rows = await sql`
    select d.id, d.doc_no, to_char(d.doc_date, 'YYYY-MM-DD') as doc_date, d.status, d.memo, d.reference,
           l.name as warehouse,
           coalesce(sum(m.qty) filter (where m.qty > 0), 0)::float as found,
           coalesce(-sum(m.qty) filter (where m.qty < 0), 0)::float as lost,
           coalesce(sum(m.total_cost), 0)::float as value
      from document d
      left join location l on l.id = d.location_id
      left join stock_movement m on m.document_id = d.id
     where d.company_id = ${user.companyId} and d.doc_type = 'STOCK_ADJUSTMENT' and d.reverses_document_id is null
       ${locs ? sql`and d.location_id = any(${locs})` : sql``}
     group by d.id, l.name
     order by d.doc_date desc, d.doc_no desc` as unknown as {
       id: string; doc_no: string; doc_date: string; status: string; memo: string | null; reference: string | null;
       warehouse: string | null; found: number; lost: number; value: number }[];

  const data: DataRow[] = rows.map((r) => ({
    key: r.id,
    searchText: [r.doc_no, r.memo, r.reference, r.warehouse].filter(Boolean).join(" "),
    facet: { warehouse: r.warehouse ?? "", status: r.status },
    sort: { doc_no: r.doc_no, date: Date.parse(r.doc_date), found: r.found, lost: r.lost, value: r.value },
    node: (
      <tr className="link">
        <td><Link href={`/documents/${r.id}`} className="m">{r.doc_no}</Link></td>
        <td>{shortDate(r.doc_date)}</td>
        <td>{r.warehouse ?? "—"}</td>
        <td className="wrap">{r.memo || "—"}{r.reference && <div className="m" style={{ color: "var(--muted)" }}>{r.reference}</div>}</td>
        <td className="r">{r.found ? `+${qty(r.found)}` : "—"}</td>
        <td className="r">{r.lost ? `−${qty(r.lost)}` : "—"}</td>
        {seeCost && <td className="r">{money(r.value)}</td>}
        <td><span className={`pill ${r.status === "POSTED" ? "posted" : "reversed"}`}>{r.status === "POSTED" ? "Posted" : "Voided"}</span></td>
      </tr>
    ),
  }));
  const warehouses = [...new Set(rows.map((r) => r.warehouse).filter(Boolean) as string[])].sort();

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">{n("inventory")}</span>
        <h1>{n("stockCount")}</h1>
        <BranchScope />
        <HelpHint>{t("adj.help")}</HelpHint>
        <span className="actions">
          <Link href="/inventory/adjustments/new" className="btn"><Plus size={16} aria-hidden="true" /> {t("adj.title")}</Link>
        </span>
      </div>
      <div className="card">
        <DataTable
          rows={data}
          emptyLabel="No stock adjustments yet."
          searchPlaceholder="Search number, description, reference…"
          defaultSort={{ key: "date", dir: "desc" }}
          filters={[
            { key: "warehouse", allLabel: "Any warehouse", options: warehouses.map((w) => ({ value: w, label: w })) },
            { key: "status", allLabel: "Any status", options: [{ value: "POSTED", label: "Posted" }, { value: "REVERSED", label: "Voided" }] },
          ]}
          columns={[
            { key: "doc_no", label: "Number", sortable: true },
            { key: "date", label: "Date", sortable: true },
            { key: "warehouse", label: "Warehouse" },
            { key: "memo", label: "Description" },
            { key: "found", label: "Found", sortable: true, align: "r" },
            { key: "lost", label: "Lost / written off", sortable: true, align: "r" },
            ...(seeCost ? [{ key: "value", label: "Value", sortable: true, align: "r" as const }] : []),
            { key: "status", label: "Status" },
          ]}
        />
      </div>
    </>
  );
}

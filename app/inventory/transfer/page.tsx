import Link from "next/link";
import { Plus } from "lucide-react";
import { qty, shortDate, sql } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { DataTable, type DataRow } from "@/components/data-table";
import { HelpHint } from "@/components/help-hint";
import { BranchScope } from "@/components/branch-scope";
import { getTranslations } from "next-intl/server";

/** Stock transfers, the list first, the form one button away — as adjustments (2026-11-27). */
export default async function StockTransfers() {
  const user = await requirePermission("inventory.manage");
  const t = await getTranslations("inventory");
  const n = await getTranslations("nav");
  const locs = await seenLocations();
  const rows = await sql`
    select d.id, d.doc_no, to_char(d.doc_date, 'YYYY-MM-DD') as doc_date, d.status, d.memo, d.reference,
           f.name as from_name, t.name as to_name,
           coalesce(sum(m.qty) filter (where m.qty > 0), 0)::float as units
      from document d
      left join location f on f.id = d.location_id
      left join location t on t.id = d.to_location_id
      left join stock_movement m on m.document_id = d.id
     where d.company_id = ${user.companyId} and d.doc_type = 'STOCK_TRANSFER' and d.reverses_document_id is null
       ${locs ? sql`and (d.location_id = any(${locs}) or d.to_location_id = any(${locs}))` : sql``}
     group by d.id, f.name, t.name
     order by d.doc_date desc, d.doc_no desc` as unknown as {
       id: string; doc_no: string; doc_date: string; status: string; memo: string | null; reference: string | null;
       from_name: string | null; to_name: string | null; units: number }[];

  const data: DataRow[] = rows.map((r) => ({
    key: r.id,
    searchText: [r.doc_no, r.memo, r.reference, r.from_name, r.to_name].filter(Boolean).join(" "),
    facet: { from: r.from_name ?? "", to: r.to_name ?? "", status: r.status },
    sort: { doc_no: r.doc_no, date: Date.parse(r.doc_date), units: r.units },
    node: (
      <tr className="link">
        <td><Link href={`/documents/${r.id}`} className="m">{r.doc_no}</Link></td>
        <td>{shortDate(r.doc_date)}</td>
        <td>{r.from_name ?? "—"}</td>
        <td>{r.to_name ?? "—"}</td>
        <td className="wrap">{r.memo || "—"}{r.reference && <div className="m" style={{ color: "var(--muted)" }}>{r.reference}</div>}</td>
        <td className="r">{qty(r.units)}</td>
        <td><span className={`pill ${r.status === "POSTED" ? "posted" : "reversed"}`}>{r.status === "POSTED" ? "Posted" : "Voided"}</span></td>
      </tr>
    ),
  }));
  const names = (k: "from_name" | "to_name") =>
    [...new Set(rows.map((r) => r[k]).filter(Boolean) as string[])].sort().map((w) => ({ value: w, label: w }));

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">{n("inventory")}</span>
        <h1>{n("stockTransfers")}</h1>
        <BranchScope />
        <HelpHint>{t("tr.help")}</HelpHint>
        <span className="actions">
          <Link href="/inventory/transfer/new" className="btn"><Plus size={16} aria-hidden="true" /> {t("tr.title")}</Link>
        </span>
      </div>
      <div className="card">
        <DataTable
          rows={data}
          emptyLabel="No stock transfers yet."
          searchPlaceholder="Search number, warehouse, description…"
          defaultSort={{ key: "date", dir: "desc" }}
          filters={[
            { key: "from", allLabel: "From any warehouse", options: names("from_name") },
            { key: "to", allLabel: "To any warehouse", options: names("to_name") },
            { key: "status", allLabel: "Any status", options: [{ value: "POSTED", label: "Posted" }, { value: "REVERSED", label: "Voided" }] },
          ]}
          columns={[
            { key: "doc_no", label: "Number", sortable: true },
            { key: "date", label: "Date", sortable: true },
            { key: "from", label: "From" },
            { key: "to", label: "To" },
            { key: "memo", label: "Description" },
            { key: "units", label: "Units", sortable: true, align: "r" },
            { key: "status", label: "Status" },
          ]}
        />
      </div>
    </>
  );
}

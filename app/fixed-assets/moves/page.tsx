import Link from "next/link";
import { HelpHint } from "@/components/help-hint";
import { requirePermission } from "@/lib/auth";
import { sql } from "@/lib/db";
import { seenLocations } from "@/lib/branch-scope";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { DataTable, type DataRow } from "@/components/data-table";

export const metadata = { title: "Disposals & Transfers" };
const money = (s: string | null) => (s == null ? "—" : Number(s).toLocaleString("en-US", { maximumFractionDigits: 0 }));

/** Every transfer and disposal, with the voucher each posted. Start one from the asset's own page. */
export default async function Moves() {
  const user = await requirePermission("accounting.view");
  const co = user.companyId;
  const seen = await seenLocations();
  const rows = (await sql`
    select e.id, e.event_type, to_char(e.event_date, 'YYYY-MM-DD') as date, f.id as asset_id, f.code, f.name,
           fb.name as from_branch, tb.name as to_branch, b.name as branch, e.detail, u.name as by,
           (select d.id from document d where d.company_id = e.company_id and d.doc_no = e.detail->>'voucher' limit 1) as doc_id
      from fa_event e join fixed_asset f on f.id = e.asset_id join location b on b.id = f.branch_id
      left join location fb on fb.id = e.from_branch_id left join location tb on tb.id = e.to_branch_id
      left join app_user u on u.id = e.created_by
     where e.company_id = ${co} and e.event_type in ('TRANSFERRED', 'DISPOSED')
       ${seen ? sql`and (f.branch_id = any(${seen}) or e.from_branch_id = any(${seen}))` : sql``}
     order by e.event_date desc, e.created_at desc`) as any[];
  const data: DataRow[] = rows.map((r) => ({
    key: r.id,
    searchText: `${r.code} ${r.name} ${r.detail?.reason ?? ""} ${r.detail?.voucher ?? ""}`,
    facet: { kind: r.event_type },
    sort: { date: r.date, asset: r.code },
    csv: { date: r.date, kind: r.event_type === "DISPOSED" ? "Disposal" : "Transfer", asset: `${r.code} ${r.name}`,
           detail: r.event_type === "DISPOSED" ? r.detail?.reason ?? "" : `${r.from_branch} → ${r.to_branch}`,
           nbv: r.detail?.nbv ?? "", proceeds: r.detail?.proceeds ?? "", gain: r.detail?.gain ?? "", voucher: r.detail?.voucher ?? "" },
    node: (
      <tr key={r.id}>
        <td className="nowrap">{r.date}</td>
        <td><span className={`fa-pill ${r.event_type === "DISPOSED" ? "due" : "ready"}`}>{r.event_type === "DISPOSED" ? "Disposal" : "Transfer"}</span></td>
        <td><Link href={`/fixed-assets/${r.asset_id}`} style={{ color: "var(--link)" }}>{r.code}</Link> {r.name}</td>
        <td>{r.event_type === "DISPOSED" ? r.detail?.reason : `${r.from_branch} → ${r.to_branch}`}</td>
        <td className="r">{r.event_type === "DISPOSED" ? money(r.detail?.nbv) : "—"}</td>
        <td className="r">{r.event_type === "DISPOSED" ? money(r.detail?.proceeds) : "—"}</td>
        <td className="r">{r.event_type === "DISPOSED" ? money(r.detail?.gain) : "—"}</td>
        <td>{r.doc_id ? <Link href={`/documents/${r.doc_id}`} className="fa-jlink">{r.detail?.voucher}</Link> : r.detail?.voucher ?? "—"}</td>
      </tr>
    ),
  }));
  return (
    <div className="fa">
      <Breadcrumbs trail={[{ label: "Fixed Assets", href: "/fixed-assets" }, { label: "Disposals & Transfers" }]} />
      <div className="fa-head"><div><h1>Disposals &amp; Transfers <HelpHint label="About Disposals & Transfers">Every asset moved between branches or taken off the books. Start one from the asset&apos;s page.</HelpHint></h1></div></div>
      <section className="card">
        {rows.length === 0 ? <div className="fa-empty"><strong>Nothing yet</strong><span>Transfers and disposals appear here once posted.</span></div> : (
          <DataTable rows={data} storageKey="fa-moves" csvFilename="disposals-transfers.csv" searchPlaceholder="Search asset, reason, voucher…"
            defaultSort={{ key: "date", dir: "desc" }}
            filters={[{ key: "kind", allLabel: "Transfers and disposals", label: "Kind",
              options: [{ value: "TRANSFERRED", label: "Transfers" }, { value: "DISPOSED", label: "Disposals" }] }]}
            columns={[{ key: "date", label: "Date", sortable: true }, { key: "kind", label: "Kind" }, { key: "asset", label: "Asset", sortable: true },
              { key: "detail", label: "Detail" }, { key: "nbv", label: "NBV", align: "r" }, { key: "proceeds", label: "Proceeds", align: "r" },
              { key: "gain", label: "Gain / (loss)", align: "r" }, { key: "voucher", label: "Voucher" }]} />
        )}
      </section>
    </div>
  );
}

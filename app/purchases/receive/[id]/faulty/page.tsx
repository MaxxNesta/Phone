import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { sql } from "@/lib/db";
import { shortDate } from "@/lib/format";
import { FaultReportForm, type FaultLine } from "@/components/fault-report-form";

/**
 * Report faulty (0224, docs/06 D-P7): a unit that passed the door and failed
 * later. The receipt stays as posted; the unit is written down against the
 * line it came in on and moved into its warehouse's quarantine bin, and goes
 * back from there as a refused unit does. A phone already sold is not here —
 * it comes back as a customer return.
 */
export default async function ReportFaulty({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission("inventory.manage");
  const { id } = await params;
  const sp = await searchParams;
  const [gr] = await sql`
    select d.id, d.doc_no, d.doc_date, bp.name as partner_name, l.name as location_name
      from document d
      left join business_partner bp on bp.id = d.partner_id
      left join location l on l.id = d.location_id
     where d.id = ${id} and d.company_id = ${user.companyId}
       and d.doc_type = 'GOODS_RECEIPT' and d.status = 'POSTED'`;
  if (!gr) notFound();

  const rows = await sql`
    select dl.id, i.code, i.name, i.identity, i.tracks_serial, dl.base_qty::float as qty,
           coalesce((select sum(fr.qty) from fault_report fr where fr.receipt_line_id = dl.id), 0)::float as reported,
           coalesce((
             select array_agg(s.serial_no order by s.serial_no)
               from stock_serial_event e
               join stock_serial s on s.id = e.serial_id
               join stock_lot lot on lot.id = e.lot_id
               join stock_movement sm on sm.id = lot.stock_movement_id
               join v_stock_serial v on v.serial_id = s.id and v.status = 'IN_STOCK'
               join location vl on vl.id = v.location_id and not vl.is_quarantine
              where e.event = 'RECEIVED' and sm.document_line_id = dl.id
                and not exists (select 1 from fault_report fr where fr.serial_id = s.id)), '{}') as units
      from document_line dl join item i on i.id = dl.item_id
     where dl.document_id = ${gr.id} and dl.reject_reason is null and i.is_stocked
     order by dl.line_no`;
  const lines: FaultLine[] = rows.map((r: any) => ({
    lineId: r.id, itemCode: r.code, itemName: r.name, identity: r.identity,
    tracked: !!r.tracks_serial, units: r.units as string[],
    maxQty: Math.max(0, Number(r.qty) - Number(r.reported)),
  })).filter((l) => l.tracked ? l.units.length > 0 : l.maxQty > 0);
  const preselect = sp.serial ? [sp.serial] : [];

  return (
    <>
      <div className="page-head hero">
        <Link href={`/documents/${gr.id}`} className="btn ghost tiny" style={{ marginBottom: "var(--s2)" }}>
          <ArrowLeft size={13} aria-hidden="true" /> {gr.doc_no}
        </Link>
        <h1>Report faulty</h1>
        <p className="page-sub">
          Found faulty after {gr.doc_no} was received{gr.partner_name ? ` from ${gr.partner_name}` : ""}
          {" "}on {shortDate(gr.doc_date)}{gr.location_name ? `, at ${gr.location_name}` : ""}. The receipt stays as it is;
          the units are written down against it and go back to the supplier from quarantine.
        </p>
      </div>
      {lines.length === 0
        ? <div className="card"><div className="card-body page-sub">Nothing from this receipt is still on the shelf to report.</div></div>
        : <FaultReportForm receiptId={gr.id} lines={lines} preselect={preselect} />}
    </>
  );
}

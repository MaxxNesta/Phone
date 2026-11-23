import { sql } from "./db";
import { carrierParcels } from "./cod";
import { carrierInstruction } from "./carrier-instruction";

export async function deliveryRows(companyId: string, locations: string[] | null, ids?: string[]) {
  const [cod, credits] = await Promise.all([
    carrierParcels(companyId, locations, ids),
    sql`select d.id, d.doc_no, d.doc_date::text as date, i.id as invoice_id, i.doc_no as invoice_no,
           p.name, p.phone, concat_ws(', ', nullif(p.address,''), nullif(p.township,''), nullif(p.region,'')) as address,
           coalesce(dr.name, c.name) as carrier,
           exists(select 1 from dispatch_event e where e.parcel_id = d.id and e.kind = 'DELIVERED')
             or exists(select 1 from delivery_trip_stop s where s.document_id = d.id and s.status = 'DELIVERED') as arrived,
           (select s.status from delivery_trip_stop s join delivery_trip t on t.id = s.trip_id
             where s.document_id = d.id order by t.trip_date desc, t.created_at desc limit 1) as stop_status
          from document d
          join lateral (select inv.* from document inv where inv.company_id = d.company_id
               and inv.doc_type = 'SALES_INVOICE' and inv.payment_type = 'CREDIT' and inv.status = 'POSTED'
               and inv.reversed_by_document_id is null and inv.reverses_document_id is null
               and (inv.id = d.source_document_id or inv.source_document_id = d.id) order by inv.doc_no limit 1) i on true
          join business_partner p on p.id = i.partner_id
          left join driver dr on dr.id = coalesce(d.driver_id, i.driver_id)
          left join business_partner c on c.id = coalesce(d.courier_id, i.courier_id)
         where d.company_id = ${companyId} and d.doc_type = 'DELIVERY' and d.status = 'POSTED'
           and d.reverses_document_id is null and d.reversed_by_document_id is null
           ${locations ? sql`and d.location_id = any(${locations}::uuid[])` : sql``}
           ${ids ? sql`and d.id = any(${ids}::uuid[])` : sql`and not exists(select 1 from dispatch_event e where e.parcel_id = d.id and e.kind = 'DELIVERED')
             and not exists(select 1 from delivery_trip_stop s where s.document_id = d.id and s.status = 'DELIVERED')`}`,
  ]);
  return [
    ...cod.map(p => ({ id: p.id, no: p.no, date: p.date, invoiceId: p.invoiceId, invoiceNo: p.invoiceNo,
      customer: p.customer, phone: p.phone, address: p.address, carrier: p.collector?.name ?? null,
      state: p.state, instruction: carrierInstruction(p), parcel: p })),
    ...credits.map(d => ({ id: String(d.id), no: String(d.doc_no), date: String(d.date), invoiceId: String(d.invoice_id),
      invoiceNo: String(d.invoice_no), customer: String(d.name), phone: d.phone as string | null,
      address: d.address as string | null, carrier: d.carrier as string | null, state: d.arrived ? "HANDED_OVER" : d.stop_status === "FAILED" ? "NOT_HOME" : "OUT",
      instruction: d.arrived ? "Already delivered" : "Credit sale · no collection", parcel: null })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.no.localeCompare(b.no));
}

export type DeliveryRow = Awaited<ReturnType<typeof deliveryRows>>[number];

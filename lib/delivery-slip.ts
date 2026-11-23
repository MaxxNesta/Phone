/**
 * What the person carrying goods is told (0233): for a COD parcel, how much
 * to collect; for a delivery on credit, cash or an order, that nothing is
 * collected. One place for the slip, the parcel worklist and the trip sheet,
 * so the three never disagree.
 *
 * Who carries it: the driver or courier the dispatch names, else the driver
 * of the trip it rides on, else the one the invoice names.
 */

import { sql } from "./db";
import { invoiceParcels, openParcels, parcel as codParcel, collectText, type Parcel } from "./cod";

export type Carried = {
  id: string; no: string; date: string; kind: "COD" | "DELIVERY";
  invoiceId: string | null; invoiceNo: string | null;
  customer: string; phone: string | null; address: string | null;
  carrier: string | null;
  /** OUT, NOT_HOME (retry), REFUSED (coming back), or done. */
  state: "OUT" | "NOT_HOME" | "REFUSED" | "DONE";
  instruction: string;
  /** Who signs: the customer, or the shop when goods come back. */
  signer: string;
  warehouseId: string;
  parcel: Parcel | null;
};

const TRIP_DRIVER = (doc: ReturnType<typeof sql>) => sql`(
  select dr.name from delivery_trip_stop ts join delivery_trip tr on tr.id = ts.trip_id join driver dr on dr.id = tr.driver_id
   where ts.document_id = ${doc} and tr.status <> 'CANCELLED' order by tr.trip_date desc, tr.created_at desc limit 1)`;

function fromParcel(p: Parcel, tripDriver: string | null, phone: string | null, address: string | null): Carried {
  const state = p.state === "HANDED_OVER" || p.state === "RETURNED" ? "DONE" : p.state;
  return {
    id: p.id, no: p.no, date: p.date, kind: "COD", invoiceId: p.invoiceId, invoiceNo: p.invoiceNo,
    customer: p.customer, phone, address, carrier: p.collector?.name ?? tripDriver,
    state, instruction: collectText(p),
    signer: p.state === "REFUSED" ? "Checked back in by (shop)" : "Received by (customer)",
    warehouseId: p.warehouseId, parcel: p,
  };
}

/** Deliveries (not COD handovers) by id, or every one still out when ids is null. */
async function deliveries(companyId: string, ids: string[] | null): Promise<Carried[]> {
  const rows = await sql`
    select d.id, d.doc_no, d.doc_date::text as date, d.location_id,
           bp.name as customer, bp.phone, concat_ws(', ', nullif(bp.address, ''), nullif(bp.township, ''), nullif(bp.region, '')) as address,
           coalesce(dr.name, cr.name, ${TRIP_DRIVER(sql`d.id`)}, idr.name, icr.name) as carrier,
           inv.id as invoice_id, inv.doc_no as invoice_no, inv.payment_type, coalesce(o.outstanding, 0)::float as outstanding,
           exists (select 1 from dispatch_event e where e.parcel_id = d.id and e.kind in ('DELIVERED', 'HANDED_OVER'))
             or exists (select 1 from delivery_trip_stop ts where ts.document_id = d.id and ts.status = 'DELIVERED') as arrived,
           exists (select 1 from delivery_trip_stop ts join delivery_trip tr on tr.id = ts.trip_id
                    where ts.document_id = d.id and ts.status = 'FAILED') as failed
      from document d
      join business_partner bp on bp.id = d.partner_id
      left join driver dr on dr.id = d.driver_id
      left join business_partner cr on cr.id = d.courier_id
      -- The invoice billing it: the one it was raised from, or the one billing it after.
      left join lateral (select i.* from document i
                          where i.doc_type = 'SALES_INVOICE' and i.status = 'POSTED' and i.reverses_document_id is null
                            and (i.id = d.source_document_id or i.source_document_id = d.id)
                          order by i.doc_date, i.doc_no limit 1) inv on true
      left join driver idr on idr.id = inv.driver_id
      left join business_partner icr on icr.id = inv.courier_id
      left join v_open_item o on o.document_id = inv.id
     where d.company_id = ${companyId} and d.doc_type = 'DELIVERY' and d.status = 'POSTED'
       and d.reverses_document_id is null and coalesce(inv.ar_on_handover, false) = false
       ${ids ? sql`and d.id = any(${ids}::uuid[])` : sql`
       and not exists (select 1 from dispatch_event e where e.parcel_id = d.id and e.kind in ('DELIVERED', 'HANDED_OVER'))
       and not exists (select 1 from delivery_trip_stop ts where ts.document_id = d.id and ts.status = 'DELIVERED')`}
     order by d.doc_date, d.doc_no`;
  return rows.map((r) => {
    const instruction = r.arrived ? "Delivered"
      : !r.invoice_id ? "Deliver · invoice to follow · collect nothing"
      : r.payment_type === "CASH" && Number(r.outstanding) <= 0.005 ? "Paid at the shop · collect nothing"
      : r.payment_type === "CASH" ? `Collect ${Number(r.outstanding).toLocaleString("en-US", { maximumFractionDigits: 0 })} MMK`
      : "Credit sale · collect nothing";
    return {
      id: r.id as string, no: r.doc_no as string, date: r.date as string, kind: "DELIVERY" as const,
      invoiceId: (r.invoice_id as string) ?? null, invoiceNo: (r.invoice_no as string) ?? null,
      customer: r.customer as string, phone: r.phone as string | null, address: (r.address as string) || null,
      carrier: r.carrier as string | null,
      state: r.arrived ? "DONE" as const : r.failed ? "NOT_HOME" as const : "OUT" as const,
      instruction, signer: "Received by (customer)", warehouseId: r.location_id as string, parcel: null,
    };
  });
}

async function partyOf(ids: string[]) {
  const rows = await sql`
    select t.id, bp.phone, concat_ws(', ', nullif(bp.address, ''), nullif(bp.township, ''), nullif(bp.region, '')) as address,
           ${TRIP_DRIVER(sql`t.id`)} as trip_driver
      from document t join business_partner bp on bp.id = t.partner_id where t.id = any(${ids}::uuid[])`;
  return new Map(rows.map((r) => [r.id as string, r]));
}

/** One slip: a COD parcel or a delivery, by id. */
export async function carriedOne(companyId: string, id: string): Promise<Carried | null> {
  const p = await codParcel(id);
  if (p) {
    const [c] = await sql`select company_id from document where id = ${id}`;
    if (c?.company_id !== companyId) return null;
    const x = (await partyOf([id])).get(id);
    return fromParcel(p, x?.trip_driver ?? null, x?.phone ?? null, x?.address || null);
  }
  return (await deliveries(companyId, [id]))[0] ?? null;
}

/** Instructions for a trip's stops, by document id. */
export async function carriedMany(companyId: string, ids: string[]): Promise<Map<string, Carried>> {
  if (ids.length === 0) return new Map();
  const [dels, parcelIds] = await Promise.all([
    deliveries(companyId, ids),
    sql`select t.id, t.source_document_id from document t join location b on b.id = t.to_location_id and b.is_transit
         where t.id = any(${ids}::uuid[]) and t.company_id = ${companyId}`,
  ]);
  const invoices = [...new Set(parcelIds.map((r) => r.source_document_id as string))];
  const parcels = (await Promise.all(invoices.map((i) => invoiceParcels(i)))).flat().filter((p) => ids.includes(p.id));
  const party = await partyOf(parcels.map((p) => p.id));
  const map = new Map<string, Carried>(dels.map((d) => [d.id, d]));
  for (const p of parcels) {
    const x = party.get(p.id);
    map.set(p.id, fromParcel(p, x?.trip_driver ?? null, x?.phone ?? null, x?.address || null));
  }
  return map;
}

/** Everything out with a carrier and not yet delivered or back: COD parcels and deliveries. */
export async function carriedOut(companyId: string): Promise<Carried[]> {
  const [cod, dels] = await Promise.all([openParcels(companyId), deliveries(companyId, null)]);
  const party = await partyOf(cod.map((p) => p.id));
  return [
    ...cod.map((p) => { const x = party.get(p.id); return fromParcel(p, x?.trip_driver ?? null, x?.phone ?? null, x?.address || null); }),
    ...dels,
  ].sort((a, b) => a.date.localeCompare(b.date) || a.no.localeCompare(b.no));
}

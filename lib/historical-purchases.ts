/** History records: purchase invoices kept from the old system as a record only (no stock, journal or payable). */
import { sql } from "./db";

export type HistoricalInvoice = {
  id: string; invoice_no: string; old_ref: string; doc_date: string; supplier: string; location: string;
  payment: string | null; remark: string | null; total_qty: number; net_total: number; batch_ref: string;
  lines: { line_no: number; item_code: string; description: string; qty: number; unit_price: number; amount: number; serials: string[] }[];
};

/** Imported invoices, newest first; q matches the old or new number, the supplier, or an IMEI. */
export async function listHistoricalPurchases(companyId: string, q = ""): Promise<HistoricalInvoice[]> {
  const like = `%${q}%`;
  return (await sql`
    select h.id, h.invoice_no, h.old_ref, h.doc_date::text, p.name as supplier, lo.name as location, h.payment,
           h.remark, h.total_qty::float, h.net_total::float, h.batch_ref,
           (select json_agg(json_build_object('line_no', l.line_no, 'item_code', l.item_code, 'description', l.description,
                   'qty', l.qty::float, 'unit_price', l.unit_price::float, 'amount', l.amount::float, 'serials', l.serials)
                   order by l.line_no)
              from historical_purchase_invoice_line l where l.invoice_id = h.id) as lines
      from historical_purchase_invoice h
      join business_partner p on p.id = h.partner_id
      join location lo on lo.id = h.location_id
     where h.company_id = ${companyId}
       ${q ? sql`and (h.old_ref ilike ${like} or h.invoice_no ilike ${like} or p.name ilike ${like}
                 or exists (select 1 from historical_purchase_invoice_line l where l.invoice_id = h.id and ${q} = any(l.serials)))` : sql``}
     order by h.doc_date desc, h.invoice_no desc
     limit 200`) as unknown as HistoricalInvoice[];
}

/** Imported invoices for the purchase invoice list, beside the real ones. */
export async function getImportedInvoiceRows(companyId: string, locs: string[] | null = null) {
  return sql`
    select h.id, h.invoice_no, h.old_ref, h.doc_date, h.partner_id, p.code as partner_code, p.name as partner_name,
           h.net_total::float as net_total, h.total_qty::float as item_qty
      from historical_purchase_invoice h
      join business_partner p on p.id = h.partner_id
     where h.company_id = ${companyId}
       ${locs ? sql`and h.location_id = any(${locs})` : sql``}`;
}

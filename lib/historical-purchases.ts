import { sql } from "./db";
import type { PlannedInvoice, PurchaseImportMaster, Mapping } from "./import-purchase-invoices";
import { resolved } from "./import-purchase-invoices";

/** What an old report is checked against: suppliers, stock locations, the catalogue, and what came in before. */
export async function getPurchaseImportMaster(companyId: string, fileSerials: string[] = []): Promise<PurchaseImportMaster> {
  const [suppliers, locations, items, refs, serials, stock] = await Promise.all([
    sql`select id, code, name from business_partner where company_id = ${companyId} and is_supplier order by code`,
    sql`select id, code, name from location where company_id = ${companyId} and is_stock_location and is_active order by name`,
    sql`select id, code, name, tracks_serial, identity from item where company_id = ${companyId} and is_active`,
    sql`select old_ref from historical_purchase_invoice where company_id = ${companyId}`,
    sql`select distinct unnest(l.serials) as s from historical_purchase_invoice_line l
          join historical_purchase_invoice h on h.id = l.invoice_id where h.company_id = ${companyId}`,
    // Only the units this file names: the whole serial register is not needed to check a few hundred.
    sql`select s.serial_no as serial, i.code as item_code from stock_serial s join item i on i.id = s.item_id
          where s.company_id = ${companyId} and (s.serial_no = any(${fileSerials}) or s.imei2 = any(${fileSerials}))`,
  ]);
  return {
    suppliers: suppliers as unknown as PurchaseImportMaster["suppliers"],
    locations: locations as unknown as PurchaseImportMaster["locations"],
    items: items as unknown as PurchaseImportMaster["items"],
    importedRefs: refs.map((r) => r.old_ref as string),
    importedSerials: serials.map((r) => r.s as string),
    stockSerials: stock as unknown as PurchaseImportMaster["stockSerials"],
  };
}

/**
 * Writes the chosen invoices, all or none. Each takes the next number from the
 * purchase invoice series for its date — the series real invoices draw from,
 * so the two can never share a number. Nothing touches stock, the journal or payables.
 */
export async function importHistoricalPurchases(input: {
  companyId: string; userId: string | null; filename: string; invoices: PlannedInvoice[]; mapping: Mapping;
}): Promise<{ batchRef: string; imported: { oldRef: string; invoiceNo: string; id: string }[] }> {
  const { companyId, invoices, mapping } = input;
  if (invoices.length === 0) throw new Error("There is nothing to import.");
  return sql.begin(async (tx) => {
    // One import at a time per company, so two uploads cannot take the same numbers.
    await tx`select id from company where id = ${companyId} for update`;
    const [{ next }] = await tx`
      select coalesce(max(substring(batch_ref from '[0-9]+$')::int), 0) + 1 as next
        from historical_purchase_invoice where company_id = ${companyId}`;
    const batchRef = `HIMP-${String(next).padStart(6, "0")}`;
    const imported: { oldRef: string; invoiceNo: string; id: string }[] = [];

    for (const p of [...invoices].sort((a, b) => a.date!.localeCompare(b.date!) || a.oldRef.localeCompare(b.oldRef))) {
      const [{ no: invoiceNo }] = await tx`select fn_next_document_no(${companyId}, 'PURCHASE_INVOICE', ${p.date}::date) as no`;
      const t = p.totals;
      const [h] = await tx`
        insert into historical_purchase_invoice (company_id, invoice_no, old_ref, doc_date, partner_id, location_id,
          payment, supplier_invoice_no, remark, total_qty, gross_total, item_discount, voucher_discount, advance_pay,
          paid_amount, net_total, currency, exchange_rate, batch_ref, filename, created_by)
        values (${companyId}, ${invoiceNo}, ${p.oldRef}, ${p.date}, ${resolved(p.supplier, mapping.suppliers)},
          ${resolved(p.location, mapping.locations)}, ${p.payment}, ${p.supplierInvoiceNo}, ${p.remark},
          ${t.qty ?? p.lines.reduce((a, l) => a + l.qty, 0)}, ${t.invoiceTotal ?? t.lines}, ${t.itemDiscount},
          ${t.voucherDiscount}, ${t.advancePay}, ${t.paidAmount},
          ${t.netTotal ?? (t.invoiceTotal ?? t.lines) - t.itemDiscount - t.voucherDiscount},
          ${t.currency}, ${t.exchangeRate}, ${batchRef}, ${input.filename}, ${input.userId})
        returning id`;
      let lineNo = 0;
      for (const l of p.lines) {
        await tx`
          insert into historical_purchase_invoice_line (invoice_id, line_no, item_id, item_code, description,
            qty, unit_price, amount, remark, serials)
          values (${h.id}, ${++lineNo}, ${l.itemId}, ${l.code}, ${l.description}, ${l.qty}, ${l.unitPrice},
            ${l.amount}, ${l.remark}, ${l.serials})`;
      }
      imported.push({ oldRef: p.oldRef, invoiceNo, id: h.id });
    }
    return { batchRef, imported };
  });
}

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

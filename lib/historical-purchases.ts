import { sql } from "./db";
import type { PlannedInvoice, PurchaseImportMaster, Mapping } from "./import-purchase-invoices";
import { resolved } from "./import-purchase-invoices";

/**
 * What an old report is checked against: suppliers, stock locations, the
 * catalogue, and — for only the old IDs and serials this file names — what
 * came in before and what is in the system now. One round trip; the history
 * is matched through the GIN index rather than read whole.
 */
export async function getPurchaseImportMaster(companyId: string, file: { refs: string[]; serials: string[] }): Promise<PurchaseImportMaster> {
  const refs = file.refs.map((r) => r.trim().toLowerCase());
  const [suppliers, locations, items, imported, serials, stock] = await Promise.all([
    sql`select id, code, name from business_partner where company_id = ${companyId} and is_supplier order by code`,
    sql`select id, code, name from location where company_id = ${companyId} and is_stock_location and is_active order by name`,
    sql`select id, code, name, tracks_serial, identity from item where company_id = ${companyId} and is_active`,
    sql`select old_ref from historical_purchase_invoice where company_id = ${companyId} and lower(old_ref) = any(${refs})`,
    sql`select distinct s from historical_purchase_invoice_line l
          join historical_purchase_invoice h on h.id = l.invoice_id
          cross join unnest(l.serials) s
         where h.company_id = ${companyId} and l.serials && ${file.serials}::text[] and s = any(${file.serials})`,
    sql`select s.serial_no as serial, i.code as item_code from stock_serial s join item i on i.id = s.item_id
          where s.company_id = ${companyId} and (s.serial_no = any(${file.serials}) or s.imei2 = any(${file.serials}))`,
  ]);
  return {
    suppliers: suppliers as unknown as PurchaseImportMaster["suppliers"],
    locations: locations as unknown as PurchaseImportMaster["locations"],
    items: items as unknown as PurchaseImportMaster["items"],
    importedRefs: imported.map((r) => r.old_ref as string),
    importedSerials: serials.map((r) => r.s as string),
    stockSerials: stock as unknown as PurchaseImportMaster["stockSerials"],
  };
}

/** Rows per insert: 21 values a header keeps a chunk far under Postgres's 65,534 parameters. */
const CHUNK = 2000;

/**
 * Writes the chosen invoices, all or none. Each takes the next number from the
 * purchase invoice series for its date — the series real invoices draw from,
 * so the two can never share a number. Nothing touches stock, the journal or payables.
 *
 * A fixed number of statements however big the file: one to lock and name the
 * batch, one to draw every number, then the headers and the lines in bulk.
 * Row by row, 300 invoices of five lines was 2,100 round trips.
 */
export async function importHistoricalPurchases(input: {
  companyId: string; userId: string | null; filename: string; invoices: PlannedInvoice[]; mapping: Mapping;
}): Promise<{ batchRef: string; imported: { oldRef: string; invoiceNo: string; id: string }[] }> {
  const { companyId, mapping } = input;
  if (input.invoices.length === 0) throw new Error("There is nothing to import.");
  // Oldest first, so numbers run with the dates.
  const invoices = [...input.invoices].sort((a, b) => a.date!.localeCompare(b.date!) || a.oldRef.localeCompare(b.oldRef));

  return sql.begin(async (tx) => {
    // One import at a time per company, so two uploads cannot take the same numbers.
    const [{ next }] = await tx`
      select (select coalesce(max(substring(batch_ref from '[0-9]+$')::int), 0) + 1
                from historical_purchase_invoice where company_id = ${companyId}) as next
        from company where id = ${companyId} for update`;
    const batchRef = `HIMP-${String(next).padStart(6, "0")}`;

    // Drawn in array order, so each date's numbers ascend with the sort above.
    const numbers = await tx`
      select n.o, fn_next_document_no(${companyId}, 'PURCHASE_INVOICE', n.d) as no
        from unnest(${invoices.map((p) => p.date!)}::date[]) with ordinality as n(d, o)
       order by n.o`;

    const headers = invoices.map((p, k) => {
      const t = p.totals;
      return {
        company_id: companyId, invoice_no: numbers[k].no as string, old_ref: p.oldRef, doc_date: p.date,
        partner_id: resolved(p.supplier, mapping.suppliers), location_id: resolved(p.location, mapping.locations),
        payment: p.payment, supplier_invoice_no: p.supplierInvoiceNo, remark: p.remark,
        total_qty: t.qty ?? p.lines.reduce((a, l) => a + l.qty, 0), gross_total: t.invoiceTotal ?? t.lines,
        item_discount: t.itemDiscount, voucher_discount: t.voucherDiscount, advance_pay: t.advancePay,
        paid_amount: t.paidAmount, net_total: t.netTotal ?? (t.invoiceTotal ?? t.lines) - t.itemDiscount - t.voucherDiscount,
        currency: t.currency, exchange_rate: t.exchangeRate, batch_ref: batchRef, filename: input.filename,
        created_by: input.userId,
      };
    });
    // Ids matched back by old ID, which is unique per company — not by the order rows come back in.
    const idOf = new Map<string, string>();
    for (let i = 0; i < headers.length; i += CHUNK) {
      const rows = await tx`insert into historical_purchase_invoice ${tx(headers.slice(i, i + CHUNK))} returning id, old_ref`;
      for (const r of rows) idOf.set(r.old_ref as string, r.id as string);
    }

    const lines = invoices.flatMap((p) => p.lines.map((l, n) => ({
      invoice_id: idOf.get(p.oldRef)!, line_no: n + 1, item_id: l.itemId, item_code: l.code, description: l.description,
      qty: l.qty, unit_price: l.unitPrice, amount: l.amount, remark: l.remark, serials: l.serials,
    })));
    for (let i = 0; i < lines.length; i += CHUNK) {
      await tx`insert into historical_purchase_invoice_line ${tx(lines.slice(i, i + CHUNK))}`;
    }

    return {
      batchRef,
      imported: invoices.map((p, k) => ({ oldRef: p.oldRef, invoiceNo: numbers[k].no as string, id: idOf.get(p.oldRef)! })),
    };
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

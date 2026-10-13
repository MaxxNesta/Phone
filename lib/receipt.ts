import { sql } from "./db";

/** Everything a till receipt shows, as plain data a page or the sale popup can draw. */
export type ReceiptData = {
  company: string; location: string | null; date: string; docNo: string; version: number;
  status: string; customer: string | null; salesman: string | null; cashier: string | null;
  net: number; tax: number; total: number;
  subtotal: number; discount: number; freeCount: number; freeValue: number;
  lines: Array<{
    lineNo: number; name: string; qty: number; amount: number; imeis: string | null;
    warrantyMonths: number | null; discountPct: number; freeReason: string | null;
  }>;
  paid: Array<{ name: string; amount: number }>;
  onAccount: number;
};

/**
 * One sales receipt, read the way the receipt page has always read it.
 * `locs` limits it to the person's own branch (null sees every one); a receipt
 * of another company, or one outside that, comes back null.
 */
export async function getReceipt(companyId: string, id: string, locs: string[] | null): Promise<ReceiptData | null> {
  const [doc] = await sql`
    select d.id, d.doc_no, d.version, d.posting_date::text as posting_date, d.net_total::float as net_total,
           d.tax_total::float as tax_total, d.gross_total::float as gross_total,
           d.status, bp.name as customer, sm.name as salesman, c.name as company,
           l.name as location, u.name as cashier
      from document d
      join company c on c.id = d.company_id
      left join business_partner bp on bp.id = d.partner_id
      left join salesman sm on sm.id = d.salesman_id
      left join location l on l.id = d.location_id
      left join app_user u on u.id = d.posted_by_id
     where d.id = ${id} and d.company_id = ${companyId} and d.doc_type = 'SALES_INVOICE'
       ${locs ? sql`and d.location_id = any(${locs})` : sql``}`;
  if (!doc) return null;

  const [lines, paid] = await Promise.all([
    sql`
      select dl.line_no, i.name, dl.entered_qty::float as qty, dl.unit_price::float as price,
             dl.net_amount::float + dl.tax_amount::float as amount, dl.warranty_months,
             coalesce(dl.discount_pct, 0)::float as discount_pct, fr.name as free_reason,
             -- What a free line would have cost the customer, from the price list,
             -- so the slip can say what was given.
             case when dl.foc_reason_id is not null then (
               select ip.price::float from item_price ip join price_level pl on pl.id = ip.price_level_id
                where ip.item_id = dl.item_id and pl.code = 'RETAIL' and ip.valid_from <= current_date
                order by ip.valid_from desc limit 1) end as list_price,
             (select string_agg(s.serial_no, ', ') from stock_movement sm
                join stock_serial_issue si on si.stock_movement_id = sm.id
                join stock_serial s on s.id = si.serial_id
               where sm.document_line_id = dl.id) as imeis
        from document_line dl join item i on i.id = dl.item_id
        left join foc_reason fr on fr.id = dl.foc_reason_id
       where dl.document_id = ${id} order by dl.line_no`,
    sql`
      select a.name, pa.amount::float as amount
        from payment_allocation pa
        join document r on r.id = pa.payment_id and r.status = 'POSTED'
        join journal_line jl on jl.journal_entry_id = r.journal_entry_id and jl.base_amount > 0
        join account a on a.id = jl.account_id
       where pa.invoice_id = ${id}`,
  ]);

  const paidTotal = paid.reduce((s, p) => s + Number(p.amount), 0);
  // Before discount, the charged lines only; free lines are counted apart.
  const charged = lines.filter((l) => !l.free_reason);
  const free = lines.filter((l) => l.free_reason);
  return {
    company: doc.company, location: doc.location, date: doc.posting_date, docNo: doc.doc_no,
    version: Number(doc.version), status: doc.status, customer: doc.customer, salesman: doc.salesman,
    cashier: doc.cashier, net: doc.net_total, tax: doc.tax_total, total: doc.gross_total,
    subtotal: charged.reduce((s, l) => s + Number(l.qty) * Number(l.price), 0),
    discount: charged.reduce((s, l) => s + Number(l.qty) * Number(l.price) * Number(l.discount_pct) / 100, 0),
    freeCount: free.reduce((s, l) => s + Number(l.qty), 0),
    freeValue: free.reduce((s, l) => s + Number(l.qty) * Number(l.list_price ?? 0), 0),
    lines: lines.map((l) => ({
      lineNo: l.line_no, name: l.name, qty: Number(l.qty), amount: Number(l.amount), imeis: l.imeis,
      warrantyMonths: l.warranty_months, discountPct: Number(l.discount_pct), freeReason: l.free_reason,
    })),
    paid: paid.map((p) => ({ name: p.name, amount: Number(p.amount) })),
    onAccount: Math.max(0, doc.gross_total - paidTotal),
  };
}

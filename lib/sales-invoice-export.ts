"use server";
/**
 * Sales Report [Each Invoice]: every invoice the list is showing, in full —
 * header, lines with their IMEIs or serials, and the money below it (invoice
 * total, item and voucher discount, tax, net, advance applied, paid, returned
 * or credited, balance). The old software's export, in our own layout; a
 * field with nothing in it reads 0 rather than being left out.
 *
 * Two calls, so the screen can show progress: which invoices (the list's own
 * filters, applied here the same way), then their details in batches.
 */
import { sql } from "./db";
import { requirePermission } from "./auth";
import { seenLocations } from "./branch-scope";
import { getInvoiceList } from "./queries";
import { invoiceDisplayStatus } from "./format";
import { dateWindow, type DateRange } from "./date-range";

const BATCH = 50;

/** The posted invoices the list shows for these search parameters, oldest first. */
export async function salesExportIds(sp: Record<string, string>): Promise<string[]> {
  const user = await requirePermission("sales.view");
  const rows = (await getInvoiceList(user.companyId, "SALES_INVOICE", await seenLocations())) as any[];
  const needle = (sp.q ?? "").trim().toLowerCase();
  const window = dateWindow({ preset: (sp.dp ?? "") as DateRange["preset"], from: sp.dfrom ?? "", to: sp.dto ?? "" });
  const picked = rows.filter((r) => {
    const t = new Date(r.posting_date).getTime();
    if (window && (t < window[0] || t >= window[1])) return false;
    if (needle && ![r.doc_no, r.partner_name].filter(Boolean).join(" ").toLowerCase().includes(needle)) return false;
    if (sp.f_channel && (r.channel ?? "INVOICE") !== sp.f_channel) return false;
    if (sp.f_customer && r.partner_name !== sp.f_customer) return false;
    if (sp.customer && r.partner_id !== sp.customer) return false;
    if (sp.status && invoiceDisplayStatus({ docStatus: "POSTED", paymentStatus: r.payment_status,
      outstanding: r.outstanding, daysOverdue: r.days_overdue }) !== sp.status) return false;
    return true;
  });
  picked.sort((a, b) => new Date(a.posting_date).getTime() - new Date(b.posting_date).getTime()
    || String(a.doc_no).localeCompare(String(b.doc_no)));
  return picked.map((r) => r.document_id as string);
}

export type ExportInvoice = {
  id: string; docNo: string; date: string; reference: string | null; memo: string | null;
  customer: string | null; customerCode: string | null; location: string | null; salesman: string | null;
  payment: string; channel: string | null; currency: string;
  lines: { code: string; name: string; qty: number; uom: string | null; price: number; amount: number; foc: string | null; serials: string[] }[];
  totals: { qty: number; invoiceTotal: number; itemDiscount: number; voucherDiscount: number; tax: number;
            net: number; advance: number; paid: number; credited: number; balance: number };
};

/** Full detail for up to BATCH invoices: four queries, whatever the batch size. */
export async function salesExportBatch(ids: string[]): Promise<ExportInvoice[]> {
  const user = await requirePermission("sales.view");
  const locs = await seenLocations();
  const co = user.companyId;
  const want = ids.slice(0, BATCH);
  if (want.length === 0) return [];

  const [heads, lines, serials, money] = await Promise.all([
    sql`
      select d.id, d.doc_no, d.doc_date::text as date, d.reference, d.memo, d.currency, d.payment_type,
             d.gross_total::float as net, d.tax_total::float as tax,
             p.name as customer, p.code as customer_code, l.name as location, s.name as salesman, pc.name as channel
        from document d
        left join business_partner p on p.id = d.partner_id
        left join location l on l.id = d.location_id
        left join salesman s on s.id = d.salesman_id
        left join payment_channel pc on pc.id = d.payment_channel_id
       where d.id = any(${want}) and d.company_id = ${co} and d.doc_type = 'SALES_INVOICE' and d.status = 'POSTED'
         ${locs ? sql`and (d.location_id is null or d.location_id = any(${locs}))` : sql``}`,
    sql`
      select dl.id, dl.document_id, dl.line_no, dl.item_id, i.code, coalesce(nullif(dl.description, ''), i.name) as name,
             coalesce(dl.entered_qty, dl.base_qty)::float as qty, u.code as uom, dl.unit_price::float as price,
             (coalesce(dl.discount_amount, 0) + coalesce(dl.volume_discount_amount, 0))::float as item_disc,
             coalesce(dl.invoice_discount_amount, 0)::float as voucher_disc, f.name as foc
        from document_line dl
        join item i on i.id = dl.item_id
        left join uom u on u.id = coalesce(dl.entered_uom_id, i.base_uom_id)
        left join foc_reason f on f.id = dl.foc_reason_id
       where dl.document_id = any(${want})
       order by dl.document_id, dl.line_no`,
    // The units each invoice took out: on the invoice itself (a retail sale),
    // on the delivery it billed (source_document_id), or on a delivery it owns
    // (deliver later). Matched to the invoice's lines by item, below.
    sql`
      select inv.id as invoice_id, sm.item_id, s.serial_no
        from document inv
        join stock_movement sm on sm.document_id = inv.id or sm.document_id = inv.source_document_id
          or sm.document_id in (select o.id from document o where o.lifecycle_owner_id = inv.id and o.doc_type = 'DELIVERY')
        join stock_serial_issue si on si.stock_movement_id = sm.id
        join stock_serial s on s.id = si.serial_id
       where inv.id = any(${want}) and fn_serial_issue_stands(si.stock_movement_id)
       order by inv.id, sm.item_id, s.serial_no`,
    sql`
      select inv.id,
             coalesce((select sum(pa.amount) from payment_allocation pa
                        join document pay on pay.id = pa.payment_id and pay.status = 'POSTED' and pay.reversed_by_document_id is null
                        left join document app on app.id = pa.applied_by_document_id
                       where pa.invoice_id = inv.id and pa.applied_by_document_id is not null and app.status = 'POSTED'), 0)::float as advance,
             coalesce((select sum(pa.amount) from payment_allocation pa
                        join document pay on pay.id = pa.payment_id and pay.status = 'POSTED' and pay.reversed_by_document_id is null
                       where pa.invoice_id = inv.id and pa.applied_by_document_id is null), 0)::float as paid,
             coalesce((select sum(r.gross_total) from document r
                        where r.source_document_id = inv.id and r.doc_type in ('SALES_RETURN', 'CREDIT_NOTE')
                          and r.status = 'POSTED' and r.reversed_by_document_id is null and r.reverses_document_id is null), 0)::float as credited
        from document inv where inv.id = any(${want})`,
  ]);

  // Each invoice's units by item; its lines of that item take them in line
  // order, as many as each line's quantity (the last line takes any rest).
  const pool = new Map<string, string[]>();
  for (const x of serials as any[]) {
    const k = `${x.invoice_id}|${x.item_id}`;
    pool.set(k, [...(pool.get(k) ?? []), x.serial_no]);
  }
  const serialsOf = new Map<string, string[]>();
  for (const l of lines as any[]) {
    const k = `${l.document_id}|${l.item_id}`;
    const left = pool.get(k);
    if (!left?.length) continue;
    const more = (lines as any[]).some((o) => o !== l && o.document_id === l.document_id && o.item_id === l.item_id && o.line_no > l.line_no);
    serialsOf.set(l.id, left.splice(0, more ? Math.max(0, Math.round(l.qty)) : left.length));
  }
  const moneyOf = new Map((money as any[]).map((m) => [m.id as string, m]));
  const order = new Map(want.map((id, i) => [id, i]));

  return (heads as any[])
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map((h) => {
      const ls = (lines as any[]).filter((l) => l.document_id === h.id);
      const m = moneyOf.get(h.id) ?? { advance: 0, paid: 0, credited: 0 };
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const invoiceTotal = r2(ls.reduce((s, l) => s + l.qty * l.price, 0));
      const net = r2(h.net);
      return {
        id: h.id, docNo: h.doc_no, date: h.date, reference: h.reference?.startsWith("POS:") ? null : h.reference,
        memo: h.memo, customer: h.customer, customerCode: h.customer_code, location: h.location,
        salesman: h.salesman, channel: h.channel, currency: h.currency,
        payment: h.reference?.startsWith("POS:") ? "Counter sale" : h.payment_type === "CASH" ? "Cash" : h.payment_type === "CREDIT" ? "Credit" : h.payment_type === "COD" ? "Cash on delivery" : (h.payment_type ?? "—"),
        lines: ls.map((l) => ({ code: l.code, name: l.name, qty: l.qty, uom: l.uom, price: l.price,
          amount: r2(l.qty * l.price), foc: l.foc, serials: serialsOf.get(l.id) ?? [] })),
        totals: {
          qty: ls.reduce((s, l) => s + l.qty, 0), invoiceTotal,
          itemDiscount: r2(ls.reduce((s, l) => s + l.item_disc, 0)),
          voucherDiscount: r2(ls.reduce((s, l) => s + l.voucher_disc, 0)),
          tax: r2(h.tax ?? 0), net, advance: r2(m.advance), paid: r2(m.paid), credited: r2(m.credited),
          balance: r2(net - m.advance - m.paid - m.credited),
        },
      };
    });
}

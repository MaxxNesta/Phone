"use server";
/**
 * Purchase Report [Each Invoice]: every bill the purchase list is showing, in
 * full — header, lines with the IMEIs or serials received for them, and the
 * money below (invoice total, item and voucher discount, tax, net, advance
 * applied, paid, returned or debited, balance). The balance is the payables
 * ledger's own (v_open_item), so the file agrees with the Payables page. The sales export's twin
 * (lib/sales-invoice-export.ts), with the old software's purchase labels.
 */
import { sql } from "./db";
import { requirePermission } from "./auth";
import { seenLocations } from "./branch-scope";
import { getInvoiceList } from "./queries";
import { invoiceDisplayStatus } from "./format";
import { dateWindow, type DateRange } from "./date-range";
import type { ExportInvoice } from "./sales-invoice-export";

const BATCH = 50;

/** The posted bills the list shows for these search parameters, oldest first. */
export async function purchaseExportIds(sp: Record<string, string>): Promise<string[]> {
  const user = await requirePermission("purchase.view");
  const rows = (await getInvoiceList(user.companyId, "PURCHASE_INVOICE", await seenLocations())) as any[];
  const needle = (sp.q ?? "").trim().toLowerCase();
  const window = dateWindow({ preset: (sp.dp ?? "") as DateRange["preset"], from: sp.dfrom ?? "", to: sp.dto ?? "" });
  const picked = rows.filter((r) => {
    const t = new Date(r.posting_date).getTime();
    if (window && (t < window[0] || t >= window[1])) return false;
    if (needle && ![r.doc_no, r.source_ref, r.partner_name].filter(Boolean).join(" ").toLowerCase().includes(needle)) return false;
    if (sp.supplier && r.partner_id !== sp.supplier) return false;
    // The list's supplier checklist: one or several ids, comma-joined.
    if (sp.f_supplier && !sp.f_supplier.split(",").includes(r.partner_id)) return false;
    if (sp.status && invoiceDisplayStatus({ docStatus: "POSTED", paymentStatus: r.payment_status,
      outstanding: r.outstanding, daysOverdue: r.days_overdue }) !== sp.status) return false;
    return true;
  });
  picked.sort((a, b) => new Date(a.posting_date).getTime() - new Date(b.posting_date).getTime()
    || String(a.doc_no).localeCompare(String(b.doc_no)));
  return picked.map((r) => r.document_id as string);
}

/** Full detail for up to BATCH bills: four queries, whatever the batch size. */
export async function purchaseExportBatch(ids: string[]): Promise<ExportInvoice[]> {
  const user = await requirePermission("purchase.view");
  const locs = await seenLocations();
  const co = user.companyId;
  const want = ids.slice(0, BATCH);
  if (want.length === 0) return [];

  const [heads, lines, serials, money] = await Promise.all([
    sql`
      select d.id, d.doc_no, d.doc_date::text as date, d.reference, d.memo, d.currency, d.payment_type,
             d.gross_total::float as net, d.tax_total::float as tax,
             p.name as supplier, p.code as supplier_code, l.name as location
        from document d
        left join business_partner p on p.id = d.partner_id
        left join location l on l.id = d.location_id
       where d.id = any(${want}) and d.company_id = ${co} and d.doc_type = 'PURCHASE_INVOICE' and d.status = 'POSTED'
         ${locs ? sql`and (d.location_id is null or d.location_id = any(${locs}))` : sql``}`,
    sql`
      select dl.id, dl.document_id, dl.line_no, i.code, coalesce(nullif(dl.description, ''), i.name) as name,
             coalesce(dl.entered_qty, dl.base_qty)::float as qty, dl.unit_price::float as price,
             (coalesce(dl.discount_amount, 0) + coalesce(dl.volume_discount_amount, 0))::float as item_disc,
             coalesce(dl.invoice_discount_amount, 0)::float as voucher_disc, f.name as foc
        from document_line dl
        join item i on i.id = dl.item_id
        left join foc_reason f on f.id = dl.foc_reason_id
       where dl.document_id = any(${want})
       order by dl.document_id, dl.line_no`,
    // The units each line brought in: received on the goods receipt line it
    // bills (source_line_id), or on the bill's own line where it received them.
    sql`
      select dl.id as line_id, s.serial_no
        from document_line dl
        join stock_movement sm on sm.document_line_id in (dl.id, dl.source_line_id)
        join stock_serial s on s.stock_movement_id = sm.id
       where dl.document_id = any(${want})
       order by dl.id, s.serial_no`,
    sql`
      select inv.id,
             coalesce((select sum(pa.amount) from payment_allocation pa
                        join document pay on pay.id = pa.payment_id and pay.status = 'POSTED' and pay.reversed_by_document_id is null
                        left join document app on app.id = pa.applied_by_document_id
                       where pa.invoice_id = inv.id and pa.applied_by_document_id is not null and app.status = 'POSTED'), 0)::float as advance,
             coalesce((select sum(pa.amount) from payment_allocation pa
                        join document pay on pay.id = pa.payment_id and pay.status = 'POSTED' and pay.reversed_by_document_id is null
                       where pa.invoice_id = inv.id and pa.applied_by_document_id is null), 0)::float as paid,
             -- What is still owed, as the payables ledger has it: the balance
             -- the Payables page shows, whatever reduced it.
             coalesce((select sum(o.outstanding) from v_open_item o
                        where o.document_id = inv.id and o.company_id = ${co}), 0)::float as owed
        from document inv where inv.id = any(${want})`,
  ]);

  const serialsOf = new Map<string, string[]>();
  for (const x of serials as any[]) serialsOf.set(x.line_id, [...(serialsOf.get(x.line_id) ?? []), x.serial_no]);
  const moneyOf = new Map((money as any[]).map((m) => [m.id as string, m]));
  const order = new Map(want.map((id, i) => [id, i]));
  const r2 = (n: number) => Math.round(n * 100) / 100;

  return (heads as any[])
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map((h) => {
      const ls = (lines as any[]).filter((l) => l.document_id === h.id);
      const m = moneyOf.get(h.id) ?? { advance: 0, paid: 0, owed: 0 };
      const net = r2(h.net);
      return {
        id: h.id, docNo: h.doc_no, date: h.date, reference: h.reference, memo: h.memo,
        customer: h.supplier, customerCode: h.supplier_code, location: h.location, salesman: null,
        channel: null, currency: h.currency,
        payment: h.payment_type === "CASH" ? "Cash" : h.payment_type === "CREDIT" ? "Credit" : (h.payment_type ?? "—"),
        lines: ls.map((l) => ({ code: l.code, name: l.name, qty: l.qty, uom: null, price: l.price,
          amount: r2(l.qty * l.price), foc: l.foc, serials: serialsOf.get(l.id) ?? [] })),
        totals: {
          qty: ls.reduce((s, l) => s + l.qty, 0), invoiceTotal: r2(ls.reduce((s, l) => s + l.qty * l.price, 0)),
          itemDiscount: r2(ls.reduce((s, l) => s + l.item_disc, 0)),
          voucherDiscount: r2(ls.reduce((s, l) => s + l.voucher_disc, 0)),
          // Returned or debited is the rest: what took the bill down besides the money paid.
          tax: r2(h.tax ?? 0), net, advance: r2(m.advance), paid: r2(m.paid),
          credited: r2(Math.max(0, net - m.advance - m.paid - m.owed)), balance: r2(m.owed),
        },
      };
    });
}

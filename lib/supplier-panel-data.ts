import { todayLocal } from "@/lib/format";
import { sql } from "./db";
import { activityRows, iso, n, type Scope } from "./customer-panel-data";

/**
 * What the supplier panel on the Suppliers list loads, one tab at a time —
 * the purchase side of customer-panel-data.ts, built the same way.
 *
 * Read-only, and every figure comes from what posting already wrote: what is
 * owed from v_open_item (purchase invoices), orders still to arrive from
 * v_order_outstanding. A purchase order is never counted as a purchase — it
 * becomes one when it is billed — so nothing is counted twice.
 *
 * Every tab is a fixed number of queries whatever the supplier's size (no
 * query per row), on document (company_id, partner_id), supplier_item
 * (company_id, supplier_id, item_id) and payment_allocation (company_id,
 * invoice_id).
 */

const PAGE = 20;

async function scope(s: Scope, partnerId: string) {
  const [p] = await sql`
    select id from business_partner where id = ${partnerId} and company_id = ${s.co} and is_supplier`;
  if (!p) throw new Error("That supplier is not in this company.");
  const at = (col: string) => s.locs ? sql`and ${sql(col)} = any(${s.locs})` : sql``;
  return { co: s.co, at };
}

export async function supplierOverview(s: Scope, partnerId: string) {
  const { co, at } = await scope(s, partnerId);
  const [[money], [last], recent] = await Promise.all([
    sql`
      select coalesce(sum(oi.outstanding), 0) as owed,
             coalesce(sum(oi.outstanding) filter (where oi.days_overdue > 0), 0) as overdue
        from v_open_item oi
       where oi.company_id = ${co} and oi.partner_id = ${partnerId} and oi.doc_type = 'PURCHASE_INVOICE'`,
    sql`
      select max(coalesce(d.posting_date, d.doc_date)) as last_purchase
        from document d
       where d.company_id = ${co} and d.partner_id = ${partnerId} and d.status = 'POSTED'
         and d.doc_type in ('GOODS_RECEIPT', 'PURCHASE_INVOICE') and d.reverses_document_id is null
         ${at("d.location_id") as never}`,
    activityRows(partnerId, co, at, 0, 5),
  ]);
  return { owed: n(money.owed), overdue: n(money.overdue), lastPurchase: iso(last?.last_purchase), recent: recent.rows };
}

export async function supplierPurchases(s: Scope, partnerId: string, offset = 0) {
  const { co, at } = await scope(s, partnerId);
  const [rows, [sum]] = await Promise.all([
    sql`
      select d.id, d.doc_no, d.doc_type, coalesce(d.posting_date, d.doc_date) as date,
             d.gross_total, d.status, d.reversed_by_document_id is not null as voided,
             case when d.doc_type = 'PURCHASE_ORDER' then
               (select coalesce(sum(v.outstanding), 0) from v_order_outstanding v where v.order_id = d.id)
             end as to_receive
        from document d
       where d.company_id = ${co} and d.partner_id = ${partnerId}
         and d.doc_type in ('PURCHASE_ORDER', 'GOODS_RECEIPT', 'PURCHASE_INVOICE')
         and d.reverses_document_id is null ${at("d.location_id") as never}
       order by coalesce(d.posting_date, d.doc_date) desc nulls last, d.created_at desc
       limit ${PAGE + 1} offset ${offset}`,
    sql`
      select
        coalesce((select sum(d.gross_total) from document d
                   where d.company_id = ${co} and d.partner_id = ${partnerId}
                     and d.doc_type = 'PURCHASE_INVOICE' and d.status = 'POSTED'
                     and d.reverses_document_id is null and d.reversed_by_document_id is null
                     ${at("d.location_id") as never}), 0) as total_purchased,
        (select count(distinct d.id)::int from document d
           join v_order_outstanding v on v.order_id = d.id
          where d.company_id = ${co} and d.partner_id = ${partnerId}
            and d.doc_type = 'PURCHASE_ORDER' and d.status = 'POSTED'
            and d.reversed_by_document_id is null and v.outstanding > 0
            ${at("d.location_id") as never}) as open_orders,
        coalesce((select sum(v.outstanding) from v_order_outstanding v
                    join document d on d.id = v.order_id
                   where d.company_id = ${co} and d.partner_id = ${partnerId}
                     and d.doc_type = 'PURCHASE_ORDER' and d.reversed_by_document_id is null
                     ${at("d.location_id") as never}), 0) as to_receive`,
  ]);
  return {
    rows: (rows as any[]).slice(0, PAGE).map((r) => ({
      id: r.id as string, docNo: r.doc_no as string | null, docType: r.doc_type as string,
      date: iso(r.date), amount: n(r.gross_total), status: r.status as string, voided: !!r.voided,
      toReceive: r.to_receive === null ? null : n(r.to_receive),
    })),
    more: rows.length > PAGE,
    summary: { totalPurchased: n(sum.total_purchased), openOrders: n(sum.open_orders), toReceive: n(sum.to_receive) },
  };
}

export async function supplierBills(s: Scope, partnerId: string, offset = 0) {
  const { co, at } = await scope(s, partnerId);
  const base = sql`
      from document d
      left join v_open_item oi on oi.document_id = d.id
     where d.company_id = ${co} and d.partner_id = ${partnerId}
       and d.doc_type = 'PURCHASE_INVOICE' and d.status = 'POSTED'
       and d.reverses_document_id is null and d.reversed_by_document_id is null
       ${at("d.location_id") as never}`;
  const [rows, [sum]] = await Promise.all([
    sql`
      select d.id, d.doc_no, d.posting_date, d.due_date, d.gross_total, d.currency,
             coalesce(oi.outstanding, 0) as outstanding
        ${base}
       order by d.posting_date desc, d.created_at desc
       limit ${PAGE + 1} offset ${offset}`,
    sql`
      select coalesce(sum(d.gross_total), 0) as billed,
             coalesce(sum(oi.outstanding), 0) as owed,
             coalesce(sum(oi.outstanding) filter (where d.due_date < fn_shop_today()), 0) as overdue,
             count(*) filter (where coalesce(oi.outstanding, 0) > 0)::int as unpaid
        ${base}`,
  ]);
  const today = todayLocal();
  return {
    rows: (rows as any[]).slice(0, PAGE).map((r) => {
      const total = n(r.gross_total), out = n(r.outstanding);
      const due = iso(r.due_date)?.slice(0, 10) ?? null;
      const status = out <= 0 ? "PAID" : due && due < today ? "OVERDUE" : out < total ? "PARTIAL" : "UNPAID";
      return { id: r.id as string, docNo: r.doc_no as string, date: iso(r.posting_date), due,
               total, outstanding: out, status, currency: r.currency as string | null };
    }),
    more: rows.length > PAGE,
    summary: { billed: n(sum.billed), owed: n(sum.owed), overdue: n(sum.overdue), unpaid: n(sum.unpaid) },
  };
}

/** What settled one bill: payments allocated to it, and returns or debit notes against it. */
export async function billSettlements(s: Scope, partnerId: string, billId: string) {
  const { co } = await scope(s, partnerId);
  const rows = await sql`
    select pay.id, pay.doc_no, pay.doc_type, pay.posting_date as date, pa.amount, pc.name as channel
      from payment_allocation pa
      join document bill on bill.id = pa.invoice_id
      join document pay on pay.id = pa.payment_id
      left join document app on app.id = pa.applied_by_document_id
      left join payment_channel pc on pc.id = pay.payment_channel_id
     where pa.company_id = ${co} and pa.invoice_id = ${billId} and bill.partner_id = ${partnerId}
       and pay.status = 'POSTED' and pay.reversed_by_document_id is null
       and (pa.applied_by_document_id is null or app.status = 'POSTED')
    union all
    select r.id, r.doc_no, r.doc_type, r.posting_date, r.gross_total, null
      from document r
     where r.source_document_id = ${billId} and r.company_id = ${co}
       and r.doc_type in ('PURCHASE_RETURN', 'DEBIT_NOTE') and r.status = 'POSTED'
       and r.reversed_by_document_id is null and r.reverses_document_id is null
     order by 4`;
  return (rows as any[]).map((r) => ({
    id: r.id as string, docNo: r.doc_no as string, docType: r.doc_type as string,
    date: iso(r.date), amount: n(r.amount), channel: r.channel as string | null,
  }));
}

/**
 * Purchasing terms: the supplier's usual delivery time and the products that
 * come at a different speed (supplier_item), with the company default behind
 * both. Blank on a product means "the supplier's usual".
 */
export async function supplierTerms(s: Scope, partnerId: string) {
  const { co } = await scope(s, partnerId);
  const [[head], rows] = await Promise.all([
    sql`select bp.lead_time_days, c.default_lead_time_days
          from business_partner bp join company c on c.id = bp.company_id where bp.id = ${partnerId}`,
    sql`select si.id, si.item_id, si.lead_time_days, si.supplier_sku, si.note, i.code as item_code, i.name as item_name
          from supplier_item si join item i on i.id = si.item_id
         where si.company_id = ${co} and si.supplier_id = ${partnerId}
         order by i.code`,
  ]);
  return {
    usual: head?.lead_time_days === null || head?.lead_time_days === undefined ? null : n(head.lead_time_days),
    companyDefault: n(head?.default_lead_time_days),
    rows: (rows as any[]).map((r) => ({
      id: r.id as string, itemId: r.item_id as string, itemCode: r.item_code as string, itemName: r.item_name as string,
      days: r.lead_time_days === null ? null : n(r.lead_time_days), sku: r.supplier_sku as string | null, note: r.note as string | null,
    })),
  };
}

/** Products to pick from when adding a purchasing term: stocked, active. */
export async function termItems(s: Scope) {
  const rows = await sql`select id, code, name from item
                          where company_id = ${s.co} and is_active and is_stocked order by code`;
  return (rows as any[]).map((r) => ({ id: r.id as string, code: r.code as string, name: r.name as string }));
}

export async function supplierActivity(s: Scope, partnerId: string, offset = 0) {
  const { co, at } = await scope(s, partnerId);
  return activityRows(partnerId, co, at, offset, PAGE);
}

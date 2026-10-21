import { sql } from "./db";

/**
 * What the customer panel on the Customers list loads, one tab at a time.
 *
 * Read-only, and every figure comes from what posting already wrote:
 * revenue from posted invoices (a till sale is an invoice too), balances from
 * v_open_item, open orders from v_order_outstanding. A sales order is never
 * counted as a sale — it becomes one when it is invoiced — so an order that
 * was billed is not counted twice.
 *
 * Documents are limited to the branches the person may see, as on the
 * partner page. Credit figures are not: a limit is the customer's across the
 * company, and the till enforces it that way.
 */

const PAGE = 20;

/** Who is asking: their company, and the locations they may see (null = all). */
export type Scope = { co: string; locs: string[] | null };

async function scope(s: Scope, partnerId: string) {
  const [p] = await sql`
    select id from business_partner where id = ${partnerId} and company_id = ${s.co}`;
  if (!p) throw new Error("That customer is not in this company.");
  const at = (col: string) => s.locs ? sql`and ${sql(col)} = any(${s.locs})` : sql``;
  return { co: s.co, at };
}

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d ? String(d) : null);
const n = (v: unknown) => Number(v ?? 0);

export type Activity = {
  kind: string; at: string | null; docId: string | null; docNo: string | null;
  docType: string | null; status: string | null; amount: number | null; user: string | null;
};

/** Newest first, from what is recorded: the partner row and its documents. */
async function activityRows(partnerId: string, co: string, at: (c: string) => unknown, offset: number, limit: number) {
  const rows = await sql`
    select * from (
      select 'CREATED' as kind, bp.created_at as at, null::uuid as doc_id, null as doc_no,
             null as doc_type, null as status, null::numeric as amount, null as user_name
        from business_partner bp where bp.id = ${partnerId}
      union all
      select case when d.reverses_document_id is not null then 'VOID' else d.doc_type end,
             coalesce(d.posted_at, d.created_at), d.id, d.doc_no, d.doc_type, d.status,
             d.gross_total, u.name
        from document d
        left join app_user u on u.id = coalesce(d.posted_by_id, d.created_by_id)
       where d.company_id = ${co} and d.partner_id = ${partnerId} ${at("d.location_id") as never}
    ) x
    order by at desc nulls last
    limit ${limit + 1} offset ${offset}`;
  const list: Activity[] = (rows as any[]).slice(0, limit).map((r) => ({
    kind: r.kind, at: iso(r.at), docId: r.doc_id, docNo: r.doc_no, docType: r.doc_type,
    status: r.status, amount: r.amount === null ? null : n(r.amount), user: r.user_name,
  }));
  return { rows: list, more: rows.length > limit };
}

export async function customerOverview(s: Scope, partnerId: string) {
  const { co, at } = await scope(s, partnerId);
  const [[money], recent] = await Promise.all([
    sql`
      select coalesce(sum(oi.outstanding), 0) as outstanding,
             coalesce(sum(oi.outstanding) filter (where oi.days_overdue > 0), 0) as overdue
        from v_open_item oi
       where oi.company_id = ${co} and oi.partner_id = ${partnerId} and oi.doc_type = 'SALES_INVOICE'`,
    activityRows(partnerId, co, at, 0, 5),
  ]);
  return { outstanding: n(money.outstanding), overdue: n(money.overdue), recent: recent.rows };
}

/** How a sales invoice came to be: from the till, from an order, or on its own. */
const SOURCE = sql`
  case when d.doc_type = 'SALES_ORDER' then 'SO'
       when d.doc_type = 'DELIVERY' then 'DO'
       when d.reference like 'POS:%' then 'POS'
       when exists (select 1 from document s where s.id = d.source_document_id
                       and s.doc_type in ('DELIVERY', 'SALES_ORDER'))
         or exists (select 1 from document_line il
                      join document_line ol on ol.id = il.source_line_id
                      join document o on o.id = ol.document_id
                     where il.document_id = d.id and o.doc_type in ('SALES_ORDER', 'DELIVERY'))
         then 'SO_SI'
       else 'DIRECT' end`;

export async function customerSales(s: Scope, partnerId: string, offset = 0) {
  const { co, at } = await scope(s, partnerId);
  const [rows, [sum]] = await Promise.all([
    sql`
      select d.id, d.doc_no, d.doc_type, coalesce(d.posting_date, d.doc_date) as date,
             d.gross_total, d.status, d.reversed_by_document_id is not null as voided,
             ${SOURCE} as source,
             case when d.doc_type = 'SALES_ORDER' then
               (select coalesce(sum(v.outstanding), 0) from v_order_outstanding v where v.order_id = d.id)
             end as to_deliver
        from document d
       where d.company_id = ${co} and d.partner_id = ${partnerId}
         and d.doc_type in ('SALES_ORDER', 'DELIVERY', 'SALES_INVOICE')
         and d.reverses_document_id is null ${at("d.location_id") as never}
       order by coalesce(d.posting_date, d.doc_date) desc nulls last, d.created_at desc
       limit ${PAGE + 1} offset ${offset}`,
    sql`
      select
        coalesce((select sum(d.gross_total) from document d
                   where d.company_id = ${co} and d.partner_id = ${partnerId}
                     and d.doc_type = 'SALES_INVOICE' and d.status = 'POSTED'
                     and d.reverses_document_id is null and d.reversed_by_document_id is null
                     ${at("d.location_id") as never}), 0) as total_sales,
        (select count(*)::int from document d
          where d.company_id = ${co} and d.partner_id = ${partnerId}
            and d.doc_type = 'SALES_ORDER' and d.status = 'POSTED'
            and d.reversed_by_document_id is null ${at("d.location_id") as never}
            and (select coalesce(sum(v.outstanding), 0) from v_order_outstanding v where v.order_id = d.id) > 0
        ) as open_orders,
        coalesce((select sum(v.outstanding) from v_order_outstanding v
                    join document d on d.id = v.order_id
                   where d.company_id = ${co} and d.partner_id = ${partnerId}
                     and d.doc_type = 'SALES_ORDER' and d.reversed_by_document_id is null
                     ${at("d.location_id") as never}), 0) as to_deliver`,
  ]);
  return {
    rows: (rows as any[]).slice(0, PAGE).map((r) => ({
      id: r.id as string, docNo: r.doc_no as string | null, docType: r.doc_type as string,
      date: iso(r.date), amount: n(r.gross_total), status: r.status as string, voided: !!r.voided,
      source: r.source as string, toDeliver: r.to_deliver === null ? null : n(r.to_deliver),
    })),
    more: rows.length > PAGE,
    summary: { totalSales: n(sum.total_sales), openOrders: n(sum.open_orders), toDeliver: n(sum.to_deliver) },
  };
}

export async function customerInvoices(s: Scope, partnerId: string, offset = 0) {
  const { co, at } = await scope(s, partnerId);
  const base = sql`
      from document d
      left join v_open_item oi on oi.document_id = d.id
     where d.company_id = ${co} and d.partner_id = ${partnerId}
       and d.doc_type = 'SALES_INVOICE' and d.status = 'POSTED'
       and d.reverses_document_id is null and d.reversed_by_document_id is null
       ${at("d.location_id") as never}`;
  const [rows, [sum]] = await Promise.all([
    sql`
      select d.id, d.doc_no, d.posting_date, d.due_date, d.gross_total, d.currency,
             d.reference like 'POS:%' as pos,
             coalesce(oi.outstanding, 0) as outstanding
        ${base}
       order by d.posting_date desc, d.created_at desc
       limit ${PAGE + 1} offset ${offset}`,
    sql`
      select coalesce(sum(d.gross_total), 0) as invoiced,
             coalesce(sum(oi.outstanding), 0) as outstanding,
             coalesce(sum(oi.outstanding) filter (where d.due_date < current_date), 0) as overdue,
             count(*) filter (where coalesce(oi.outstanding, 0) > 0)::int as unpaid
        ${base}`,
  ]);
  const today = new Date().toISOString().slice(0, 10);
  return {
    rows: (rows as any[]).slice(0, PAGE).map((r) => {
      const total = n(r.gross_total), out = n(r.outstanding);
      const due = iso(r.due_date)?.slice(0, 10) ?? null;
      const status = out <= 0 ? "PAID" : due && due < today ? "OVERDUE" : out < total ? "PARTIAL" : "UNPAID";
      return { id: r.id as string, docNo: r.doc_no as string, date: iso(r.posting_date), due,
               total, outstanding: out, status, pos: !!r.pos, currency: r.currency as string | null };
    }),
    more: rows.length > PAGE,
    summary: { invoiced: n(sum.invoiced), outstanding: n(sum.outstanding),
               overdue: n(sum.overdue), unpaid: n(sum.unpaid) },
  };
}

/** What settled one invoice: receipts allocated to it, and returns against it. */
export async function invoiceSettlements(s: Scope, partnerId: string, invoiceId: string) {
  const { co } = await scope(s, partnerId);
  const rows = await sql`
    select pay.id, pay.doc_no, pay.doc_type, pay.posting_date as date, pa.amount, pc.name as channel
      from payment_allocation pa
      join document inv on inv.id = pa.invoice_id
      join document pay on pay.id = pa.payment_id
      left join document app on app.id = pa.applied_by_document_id
      left join payment_channel pc on pc.id = pay.payment_channel_id
     where pa.invoice_id = ${invoiceId} and inv.company_id = ${co} and inv.partner_id = ${partnerId}
       and pay.status = 'POSTED' and pay.reversed_by_document_id is null
       and (pa.applied_by_document_id is null or app.status = 'POSTED')
    union all
    select r.id, r.doc_no, r.doc_type, r.posting_date, r.gross_total, null
      from document r
     where r.source_document_id = ${invoiceId} and r.company_id = ${co}
       and r.doc_type in ('SALES_RETURN', 'CREDIT_NOTE') and r.status = 'POSTED'
       and r.reversed_by_document_id is null and r.reverses_document_id is null
     order by 4`;
  return (rows as any[]).map((r) => ({
    id: r.id as string, docNo: r.doc_no as string, docType: r.doc_type as string,
    date: iso(r.date), amount: n(r.amount), channel: r.channel as string | null,
  }));
}

export async function customerActivity(s: Scope, partnerId: string, offset = 0) {
  const { co, at } = await scope(s, partnerId);
  return activityRows(partnerId, co, at, offset, PAGE);
}

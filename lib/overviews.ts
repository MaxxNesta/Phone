import { todayLocal } from "@/lib/format";
import { sql } from "./db";
import { getReceiptsByAccount, getDueWithin } from "./queries";

/**
 * The Sales and Purchases menus' own landing pages: the day's selling and the
 * month's buying, for the people who do them. The main dashboard keeps the
 * whole-business view.
 *
 * One query per figure, all at once; every query reads through the
 * (company_id, doc_type, posting_date) index on document and is limited to the
 * branches the reader may see (seenLocations).
 */

/** Today in Yangon, whatever the server's clock says. */
export function yangonToday() {
  return todayLocal();
}
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export type RecentSale = { id: string; doc_no: string; date: string; customer: string; walk_in: boolean;
  items: number; total: number; outstanding: number; voided: boolean };

export async function salesOverview(co: string, locs: string[] | null) {
  const today = yangonToday();
  const at = locs ? sql`and d.location_id = any(${locs})` : sql``;
  const [[kpi], takings, week, top, recent, [ar]] = await Promise.all([
    // A void posts its reversal as a negative invoice the same way, so the
    // sums net it out; only the count has to leave both sides out.
    sql`select count(distinct d.id) filter (where d.reverses_document_id is null and d.reversed_by_document_id is null)::int as sales,
               coalesce(sum(dl.net_amount), 0)::float as revenue,
               coalesce(sum(c.cost), 0)::float as cost,
               coalesce(sum(dl.base_qty) filter (where i.tracks_serial), 0)::int as phones
          from document d
          join document_line dl on dl.document_id = d.id
          join item i on i.id = dl.item_id
          left join lateral (select sum(a.qty * a.unit_cost) as cost from sales_cost_allocation a
                              where a.invoice_line_id = dl.id) c on true
         where d.company_id = ${co} and d.doc_type = 'SALES_INVOICE' and d.status = 'POSTED'
           and d.posting_date = ${today}::date ${at}`,
    getReceiptsByAccount(co, today, nextDay(today), locs),
    sql`select to_char(g, 'YYYY-MM-DD') as day, coalesce(s.revenue, 0)::float as revenue
          from generate_series(${today}::date - 6, ${today}::date, interval '1 day') g
          left join (select d.posting_date, sum(d.net_total) as revenue from document d
                      where d.company_id = ${co} and d.doc_type = 'SALES_INVOICE' and d.status = 'POSTED'
                        and d.posting_date between ${today}::date - 6 and ${today}::date ${at}
                      group by 1) s on s.posting_date = g::date
         order by g`,
    sql`select coalesce(p.name, i.name) as model, sum(dl.base_qty)::int as sold, sum(dl.net_amount)::float as revenue
          from document d
          join document_line dl on dl.document_id = d.id
          join item i on i.id = dl.item_id left join item p on p.id = i.parent_item_id
         where d.company_id = ${co} and d.doc_type = 'SALES_INVOICE' and d.status = 'POSTED'
           and d.posting_date between ${today}::date - 29 and ${today}::date ${at} and i.tracks_serial
         group by 1 having sum(dl.base_qty) > 0 order by 2 desc, 3 desc limit 5`,
    sql`select d.id, d.doc_no, to_char(d.posting_date, 'YYYY-MM-DD') as date, bp.name as customer,
               bp.code = 'WALKIN' as walk_in, d.gross_total::float as total,
               (select coalesce(sum(dl.base_qty), 0)::int from document_line dl where dl.document_id = d.id) as items,
               coalesce(o.outstanding, 0)::float as outstanding, d.reversed_by_document_id is not null as voided
          from document d
          join business_partner bp on bp.id = d.partner_id
          left join v_open_item o on o.document_id = d.id
         where d.company_id = ${co} and d.doc_type = 'SALES_INVOICE' and d.status = 'POSTED'
           and d.reverses_document_id is null ${at}
         order by d.posting_date desc, d.posted_at desc limit 10`,
    sql`select coalesce(sum(outstanding), 0)::float as owed, count(distinct partner_id)::int as customers
          from v_open_item where company_id = ${co} and doc_type = 'SALES_INVOICE' and outstanding > 0.005
           ${locs ? sql`and document_id in (select id from document where location_id = any(${locs}))` : sql``}`,
  ]);
  return {
    today,
    kpi: kpi as { sales: number; revenue: number; cost: number; phones: number },
    takings: (takings as unknown as { id: string; name: string; revenue: string | number; receipts: number }[])
      .map((t) => ({ ...t, revenue: Number(t.revenue) })),
    week: week as unknown as { day: string; revenue: number }[],
    top: top as unknown as { model: string; sold: number; revenue: number }[],
    recent: recent as unknown as RecentSale[],
    ar: ar as { owed: number; customers: number },
  };
}

export type OpenBill = { id: string; doc_no: string; supplier: string; due_date: string | null; outstanding: number; gross: number };
export type RecentBill = { id: string; doc_no: string; date: string; supplier: string; items: number; total: number; voided: boolean };

/**
 * `payables` and `stock` follow the reader's permissions: what is owed to
 * suppliers is accounting's (as the Payables page is), low stock inventory's.
 */
export async function purchasesOverview(co: string, locs: string[] | null, see: { payables: boolean; stock: boolean }) {
  const today = yangonToday();
  const monthStart = `${today.slice(0, 7)}-01`;
  const at = locs ? sql`and d.location_id = any(${locs})` : sql``;
  const [[month], top, recent, open, due, low] = await Promise.all([
    sql`select count(*) filter (where d.reverses_document_id is null and d.reversed_by_document_id is null)::int as invoices,
               coalesce(sum(d.net_total), 0)::float as spend
          from document d
         where d.company_id = ${co} and d.doc_type = 'PURCHASE_INVOICE' and d.status = 'POSTED'
           and d.posting_date between ${monthStart}::date and ${today}::date ${at}`,
    sql`select bp.id, bp.name, sum(d.net_total)::float as spend, count(*)::int as invoices
          from document d join business_partner bp on bp.id = d.partner_id
         where d.company_id = ${co} and d.doc_type = 'PURCHASE_INVOICE' and d.status = 'POSTED'
           and d.posting_date between ${monthStart}::date and ${today}::date ${at}
         group by 1, 2 having sum(d.net_total) > 0 order by 3 desc limit 5`,
    sql`select d.id, d.doc_no, to_char(d.posting_date, 'YYYY-MM-DD') as date, bp.name as supplier, d.gross_total::float as total,
               (select coalesce(sum(dl.base_qty), 0)::int from document_line dl where dl.document_id = d.id) as items,
               d.reversed_by_document_id is not null as voided
          from document d join business_partner bp on bp.id = d.partner_id
         where d.company_id = ${co} and d.doc_type = 'PURCHASE_INVOICE' and d.status = 'POSTED'
           and d.reverses_document_id is null ${at}
         order by d.posting_date desc, d.posted_at desc limit 10`,
    // Every open bill once: the totals, the overdue part and the list all
    // come from it, so the open-item view is read a single time.
    // ponytail: fine for hundreds of open bills; page it if a shop carries thousands.
    see.payables ? sql`
      select document_id as id, doc_no, partner_name as supplier, to_char(due_date, 'YYYY-MM-DD') as due_date,
             outstanding::float as outstanding, gross_total::float as gross
        from v_open_item where company_id = ${co} and doc_type = 'PURCHASE_INVOICE' and outstanding > 0.005
         ${locs ? sql`and document_id in (select id from document where location_id = any(${locs}))` : sql``}
       order by due_date nulls last, posting_date` : Promise.resolve([]),
    see.payables ? getDueWithin(co, "PURCHASE_INVOICE", 7, locs) : Promise.resolve({ total: 0, invoices: 0 }),
    // Phones that sell and are nearly out: two or fewer left, sold in 60 days.
    see.stock ? sql`
      select s.item_name as name, count(*) filter (where s.status = 'IN_STOCK')::int as left_,
             count(*) filter (where s.status = 'SOLD' and s.out_date > ${today}::date - 60)::int as sold_60
        from v_stock_serial s where s.company_id = ${co} ${locs ? sql`and s.location_id = any(${locs})` : sql``}
       group by 1
      having count(*) filter (where s.status = 'IN_STOCK') <= 2
         and count(*) filter (where s.status = 'SOLD' and s.out_date > ${today}::date - 60) > 0
       order by 2, 3 desc limit 8` : Promise.resolve([]),
  ]);
  const bills = open as unknown as OpenBill[];
  const openById = new Map(bills.map((b) => [b.id, b]));
  return {
    today,
    month: month as { invoices: number; spend: number },
    top: top as unknown as { id: string; name: string; spend: number; invoices: number }[],
    recent: (recent as unknown as RecentBill[]).map((r) => ({ ...r, outstanding: openById.get(r.id)?.outstanding ?? 0 })),
    payables: {
      owed: bills.reduce((t, b) => t + b.outstanding, 0),
      invoices: bills.length,
      overdue: bills.filter((b) => b.due_date && b.due_date < today).reduce((t, b) => t + b.outstanding, 0),
      due,
      unpaid: bills.slice(0, 10),
    },
    low: low as unknown as { name: string; left_: number; sold_60: number }[],
  };
}

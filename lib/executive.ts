import { sql } from "./db";

/**
 * The Executive dashboard's figures (Management Reports add-on).
 *
 * Profit comes from the general ledger, the same source as the income
 * statement, so the two never disagree: revenue, cost of sales and expenses by
 * month and branch in one query. Balances are read as they stand now. Months
 * are whole calendar months, so a period is a set of months and the previous
 * period is the same number of months just before it.
 */
export type Pl = { rev: number; cogs: number; exp: number };
const zero = (): Pl => ({ rev: 0, cogs: 0, exp: 0 });
const add = (a: Pl, b: Pl) => { a.rev += b.rev; a.cogs += b.cogs; a.exp += b.exp; };

const monthKey = (iso: string) => iso.slice(0, 7);
function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  while (d.toISOString().slice(0, 10) < to) { out.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() + 1); }
  return out;
}
const shift = (iso: string, months: number) => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + months); return d.toISOString().slice(0, 10);
};

export async function executiveData(co: string, from: string, to: string) {
  const span = monthsBetween(from, to).length;
  const prevFrom = shift(from, -span);
  const trendFrom = shift(to, -12) < prevFrom ? shift(to, -12) : prevFrom;

  const [plRows, bal, stockRows, branchRows, expRows, hourRows, revRows] = await Promise.all([
    sql`
      select to_char(date_trunc('month', je.entry_date), 'YYYY-MM') as m,
             coalesce(w.parent_id, w.id) as branch,
             sum(case when a.account_type = 'REVENUE' then -jl.base_amount else 0 end)::float as rev,
             sum(case when a.account_type = 'COGS' then jl.base_amount else 0 end)::float as cogs,
             sum(case when a.account_type = 'EXPENSE' then jl.base_amount else 0 end)::float as exp
        from journal_line jl
        join journal_entry je on je.id = jl.journal_entry_id
        join account a on a.id = jl.account_id
        left join location w on w.id = jl.location_id
       where jl.company_id = ${co}
         and a.account_type in ('REVENUE', 'COGS', 'EXPENSE')
         and je.entry_date >= ${trendFrom}::date and je.entry_date < ${to}::date
       group by 1, 2`,
    /* What stands today. Open invoices both ways in one pass over
       v_open_item, each figure a filter on it, rather than five subqueries
       that each walked the view again. */
    sql`
      select
        (select coalesce(sum(jl.base_amount), 0) from journal_line jl join account a on a.id = jl.account_id
          where jl.company_id = ${co} and a.is_cash_account)::float as cash,
        coalesce(sum(o.outstanding) filter (where o.doc_type = 'SALES_INVOICE'), 0)::float as ar,
        coalesce(sum(o.outstanding) filter (where o.doc_type = 'SALES_INVOICE' and o.days_overdue > 0), 0)::float as ar_overdue,
        (count(*) filter (where o.doc_type = 'SALES_INVOICE' and o.days_overdue > 0))::int as ar_overdue_n,
        coalesce(sum(o.outstanding) filter (where o.doc_type = 'PURCHASE_INVOICE'), 0)::float as ap,
        coalesce(sum(o.outstanding) filter (where o.doc_type = 'PURCHASE_INVOICE' and o.due_date <= fn_shop_today() + 7), 0)::float as ap_due7
        from v_open_item o
       where o.company_id = ${co} and o.doc_type in ('SALES_INVOICE', 'PURCHASE_INVOICE') and o.outstanding > 0`,
    // Stock by branch and the lines below zero, in one pass over the stock view.
    sql`
      select coalesce(l.parent_id, l.id) as branch, sum(v.value_on_hand)::float as value,
             (count(*) filter (where v.qty_on_hand < 0))::int as negative
        from v_stock_on_hand v join location l on l.id = v.location_id
       where v.company_id = ${co}
       group by 1`,
    sql`select id, code, name from location where company_id = ${co} and parent_id is null and is_active order by code`,
    sql`
      select a.code, a.name, sum(jl.base_amount)::float as amount
        from journal_line jl
        join journal_entry je on je.id = jl.journal_entry_id
        join account a on a.id = jl.account_id
       where jl.company_id = ${co} and a.account_type = 'EXPENSE'
         and je.entry_date >= ${from}::date and je.entry_date < ${to}::date
       group by a.code, a.name
      having sum(jl.base_amount) <> 0
       order by 3 desc limit 6`,
    /* When the shop is busy: sales by weekday and hour, in the shop's own
       clock. Reads the (company, doc_type, posting_date) index; one row per
       hour of the week, at most 168. */
    sql`
      select extract(isodow from t)::int as dow, extract(hour from t)::int as hour,
             count(*)::int as sales, coalesce(sum(gross_total), 0)::float as amount
        from (select d.gross_total,
                     coalesce(d.posted_at, d.created_at) at time zone coalesce(c.timezone, 'Asia/Yangon') as t
                from document d join company c on c.id = d.company_id
               where d.company_id = ${co} and d.doc_type = 'SALES_INVOICE' and d.status = 'POSTED'
                 and d.posting_date >= ${from}::date and d.posting_date < ${to}::date) x
       group by 1, 2`,
    // Where revenue came from, by account, for the income flow.
    sql`
      select a.code, a.name, -sum(jl.base_amount)::float as amount
        from journal_line jl
        join journal_entry je on je.id = jl.journal_entry_id
        join account a on a.id = jl.account_id
       where jl.company_id = ${co} and a.account_type = 'REVENUE'
         and je.entry_date >= ${from}::date and je.entry_date < ${to}::date
       group by a.code, a.name
      having sum(jl.base_amount) <> 0
       order by 3 desc`,
  ]);

  const rows = plRows as unknown as { m: string; branch: string | null; rev: number; cogs: number; exp: number }[];
  const inPeriod = (m: string, f: string, t: string) => m >= monthKey(f) && m < monthKey(t);
  const now = zero(), before = zero();
  const byMonth = new Map<string, Pl>(), byBranch = new Map<string, Pl>();
  for (const r of rows) {
    if (inPeriod(r.m, from, to)) { add(now, r); const b = byBranch.get(r.branch ?? "") ?? zero(); add(b, r); byBranch.set(r.branch ?? "", b); }
    if (inPeriod(r.m, prevFrom, from)) add(before, r);
    const m = byMonth.get(r.m) ?? zero(); add(m, r); byMonth.set(r.m, m);
  }
  const trend = monthsBetween(shift(to, -12), to).map((m) => ({ month: m, ...(byMonth.get(m) ?? zero()) }));

  const b = (bal as unknown as Record<string, number>[])[0];
  const stockList = stockRows as unknown as { branch: string; value: number; negative: number }[];
  const stockBy = new Map(stockList.map((r) => [r.branch, r.value]));
  const negativeLines = stockList.reduce((t, r) => t + r.negative, 0);
  const stock = [...stockBy.values()].reduce((t, v) => t + v, 0);
  const branches = (branchRows as unknown as { id: string; code: string; name: string }[]).map((br) => ({
    ...br, pl: byBranch.get(br.id) ?? zero(), stock: stockBy.get(br.id) ?? 0,
  }));
  const unassigned = byBranch.get("") ?? null;

  /* Working capital in days, on the last three months' pace: how long a sale
     waits to be paid (receivables), stock waits to be sold (inventory), and
     the company waits to pay its suppliers (payables). */
  const last3 = trend.slice(-3).reduce((t, m) => { add(t, m); return t; }, zero());
  const perDay = (v: number) => v / 90;
  const days = (bal: number, flow: number) => (perDay(flow) > 0 ? bal / perDay(flow) : null);
  const dso = days(b.ar, last3.rev), dio = days(stock, last3.cogs), dpo = days(b.ap, last3.cogs);
  const ccc = dso != null && dio != null && dpo != null ? dso + dio - dpo : null;

  return {
    now, before, trend, branches, unassigned, stock,
    cash: b.cash, ar: b.ar, arOverdue: b.ar_overdue, arOverdueN: b.ar_overdue_n,
    ap: b.ap, apDue7: b.ap_due7, negativeLines,
    expenses: expRows as unknown as { code: string; name: string; amount: number }[],
    revenueBy: revRows as unknown as { code: string; name: string; amount: number }[],
    hours: hourRows as unknown as { dow: number; hour: number; sales: number; amount: number }[],
    days: { dso, dio, dpo, ccc },
  };
}

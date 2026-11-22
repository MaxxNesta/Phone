import { sql } from "./db";

/**
 * Statement of changes in equity, period by period through one fiscal year:
 * for each of the company's own fiscal periods, the balance on its first day,
 * what moved it, and the balance on its last day, in four columns (capital,
 * accumulated profit/(loss), other changes, total).
 *
 * Periods are the company's, not calendar months: a year that starts on
 * 1 April runs April to March; one that starts on 29 August runs 29 August
 * to 28 September, and so on. Every journal entry is already tied to its
 * fiscal period, so a period's movement is exact whatever the start day.
 *
 * Read from the ledger, never stored. Profit is counted from the income and
 * expense accounts as it is earned, so a year-end close (which only moves
 * that profit into retained earnings) is left out, or it would count twice.
 *
 * Which column an equity account feeds is decided by its role, not its code:
 * the retained-earnings account is accumulated profit, opening-balance
 * equity is "other changes", an account named "drawing" is drawings, and
 * every other equity account is capital. Exchange gain and loss are part of
 * profit but shown on their own row, as owners read them apart.
 */
export type EquityMonth = {
  /** The period's first and last day (YYYY-MM-DD). */
  start: string;
  end: string;
  opening: Cols;
  profit: number;
  fx: number;
  /** Entries made straight to retained earnings: a prior-year correction, a dividend. */
  retained: number;
  capitalIn: number;
  drawings: number;
  other: number;
  closing: Cols;
};
export type Cols = { capital: number; accumulated: number; other: number; total: number };

/**
 * One fiscal year's periods that have begun by `through` (YYYY-MM-DD): the
 * whole year for a past one, up to the current period for the year in progress.
 */
export async function equityStatement(companyId: string, fiscalYearId: string, through: string) {
  const periods = (await sql`
    select id, start_date::text as s, end_date::text as e from fiscal_period
     where company_id = ${companyId} and fiscal_year_id = ${fiscalYearId} and start_date <= ${through}::date
     order by start_date`) as unknown as { id: string; s: string; e: string }[];
  if (periods.length === 0) return [];
  const yearStart = periods[0].s;
  const end = periods[periods.length - 1].e;

  const rows = await sql`
    with roles as (
      select role, account_id from system_account where company_id = ${companyId}
    ),
    lines as (
      select case when je.entry_date < ${yearStart}::date then null else je.fiscal_period_id end as p,
             a.account_type, a.id, a.name, -l.base_amount as amt
        from journal_line l
        join journal_entry je on je.id = l.journal_entry_id
        join account a on a.id = l.account_id
       where je.company_id = ${companyId} and je.entry_date <= ${end}::date
         and a.account_type in ('REVENUE', 'COGS', 'EXPENSE', 'EQUITY')
         and not exists (select 1 from document y where y.journal_entry_id = je.id and y.doc_type = 'YEAR_END_CLOSE')
    )
    select p::text as p,
      coalesce(sum(amt) filter (where account_type in ('REVENUE','COGS','EXPENSE')
        and id not in (select account_id from roles where role in ('FX_GAIN','FX_LOSS','FX_UNREALISED_GAIN','FX_UNREALISED_LOSS'))), 0)::float as profit,
      coalesce(sum(amt) filter (where account_type in ('REVENUE','COGS','EXPENSE')
        and id in (select account_id from roles where role in ('FX_GAIN','FX_LOSS','FX_UNREALISED_GAIN','FX_UNREALISED_LOSS'))), 0)::float as fx,
      coalesce(sum(amt) filter (where account_type = 'EQUITY' and name ilike '%drawing%'), 0)::float as drawings,
      coalesce(sum(amt) filter (where account_type = 'EQUITY' and name not ilike '%drawing%'
        and id in (select account_id from roles where role = 'RETAINED_EARNINGS')), 0)::float as retained,
      coalesce(sum(amt) filter (where account_type = 'EQUITY' and name not ilike '%drawing%'
        and id in (select account_id from roles where role = 'OPENING_BALANCE_EQUITY')), 0)::float as other,
      coalesce(sum(amt) filter (where account_type = 'EQUITY' and name not ilike '%drawing%'
        and id not in (select account_id from roles where role in ('RETAINED_EARNINGS', 'OPENING_BALANCE_EQUITY'))), 0)::float as capital
      from lines group by p`;

  const by = new Map(rows.map((r) => [r.p as string | null, r]));
  const z = { profit: 0, fx: 0, drawings: 0, retained: 0, other: 0, capital: 0 };
  const before = { ...z, ...(by.get(null) ?? {}) } as typeof z;
  let bal: Cols = {
    capital: before.capital,
    // Profit earned before the year, plus what retained earnings holds itself.
    accumulated: before.profit + before.fx + before.retained + before.drawings,
    other: before.other,
    total: 0,
  };
  bal.total = bal.capital + bal.accumulated + bal.other;
  const out: EquityMonth[] = [];
  for (const per of periods) {
    const r = { ...z, ...(by.get(per.id) ?? {}) } as typeof z;
    const opening = bal;
    const closing: Cols = {
      capital: opening.capital + r.capital,
      // Drawings reduce what the owners have earned and left in.
      accumulated: opening.accumulated + r.profit + r.fx + r.retained + r.drawings,
      other: opening.other + r.other,
      total: 0,
    };
    closing.total = closing.capital + closing.accumulated + closing.other;
    out.push({ start: per.s, end: per.e, opening, profit: r.profit, fx: r.fx, retained: r.retained,
      capitalIn: r.capital, drawings: r.drawings, other: r.other, closing });
    bal = closing;
  }
  return out;
}

import { sql } from "./db";

/**
 * Statement of changes in equity, month by month through one calendar year:
 * for each month, the balance on its first day, what moved it, and the
 * balance on its last day, in four columns (capital, accumulated
 * profit/(loss), other changes, total).
 *
 * Always the calendar year, 1 January to 31 December, in calendar months
 * (owner's decision, 2026-11-22), whatever day a company's fiscal year
 * starts on: one standard period for every company.
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
 * One calendar year's months that have begun by `through` (YYYY-MM-DD): all
 * twelve for a past year, up to the current month for the year in progress.
 */
export async function equityStatement(companyId: string, year: number, through: string) {
  const last = through.slice(0, 4) === String(year) ? Number(through.slice(5, 7)) : 12;
  const periods = Array.from({ length: last }, (_, k) => {
    const s = new Date(Date.UTC(year, k, 1)).toISOString().slice(0, 10);
    const e = new Date(Date.UTC(year, k + 1, 0)).toISOString().slice(0, 10);
    return { id: s, s, e };
  });
  const yearStart = periods[0].s;
  const end = periods[periods.length - 1].e;

  const rows = await sql`
    with roles as (
      select role, account_id from system_account where company_id = ${companyId}
    ),
    lines as (
      select case when je.entry_date < ${yearStart}::date then null
                  else date_trunc('month', je.entry_date)::date end as p,
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

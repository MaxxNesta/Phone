import type { TransactionSql } from "postgres";
import { sql } from "./db";

/**
 * Financial ratios, read straight off the ledger.
 *
 * Every figure is a running total of journal lines up to a date: a balance
 * is the total at the date, a flow (revenue, expenses) is the total at the
 * end of a window less the total at its start. So the period, the one it is
 * compared with and each month of the trend all come from one pass over the
 * ledger, however many there are.
 *
 * Where each figure lives in the chart:
 *   current assets      under 13          current liabilities  under 21
 *   cash and bank       cash or bank accounts under 13
 *   receivable / stock / payable          the AR, inventory and AP control accounts
 *   debt                under 23 (long-term liabilities) — the loans
 *   net sales           revenue under 41 and 43, other incomes (413) left out
 *   interest            Finance Costs (67), kept out of operating expenses
 *   equity              assets less liabilities, so this year's unclosed profit counts
 * Year-end closing entries are left out of every flow: closing a year empties
 * revenue and expenses into retained earnings, and the period would read nil.
 */

type Sql = typeof sql | TransactionSql;

const KEYS = ["ca", "cash", "ar", "inv", "cl", "ap", "debt", "assets", "liab",
  "sales", "otherInc", "cogs", "opex", "interest", "collected", "billedAp"] as const;
type Key = (typeof KEYS)[number];
type Totals = Record<Key, number>;

/** One window of the ledger, and every ratio worked from it. */
export type RatioWindow = {
  from: string; to: string; days: number;
  // Balances at the window's end.
  currentAssets: number; cash: number; receivable: number; inventory: number; otherCurrentAssets: number;
  currentLiabilities: number; payable: number; otherCurrentLiabilities: number;
  totalAssets: number; totalLiabilities: number; equity: number; debt: number;
  workingCapital: number;
  // Flows within the window.
  netSales: number; cogs: number; grossProfit: number; operatingExpenses: number;
  operatingProfit: number; interest: number; otherIncome: number; netProfit: number;
  collected: number; creditPurchases: number;
  // Averages of the opening and closing balance.
  avgReceivable: number; avgPayable: number; avgAssets: number; avgEquity: number; avgCapital: number;
  ratios: Record<RatioKey, number | null>;
};

export type RatioKey =
  | "current" | "quick" | "cash" | "absolute"
  | "receivableTurnover" | "debtorsTurnover" | "creditorsTurnover"
  | "grossMargin" | "operatingMargin" | "netMargin" | "roa" | "roe" | "roi"
  | "debtToEquity" | "debtToAssets" | "interestCover" | "liabilitiesToEquity" | "financialLeverage" | "operatingLeverage";

const div = (a: number, b: number) => (Math.abs(b) > 0.0001 ? a / b : null);
const pct = (a: number, b: number) => { const r = div(a, b); return r === null ? null : r * 100; };

async function totalsAt(db: Sql, companyId: string, dates: string[], branchId: string | null) {
  const last = dates.reduce((m, d) => (d > m ? d : m));
  const rows = await db`
    with recursive up(leaf, id, parent_id, code) as (
      select id, id, parent_id, code from account where company_id = ${companyId}
      union all
      select up.leaf, p.id, p.parent_id, p.code from account p join up on p.id = up.parent_id
    ),
    path as (select leaf as id, array_agg(code) as codes from up group by leaf),
    role as (
      select account_id, array_agg(distinct role) as roles from account_determination
       where company_id = ${companyId} and role in ('INVENTORY', 'AR_CONTROL', 'AP_CONTROL')
       group by account_id
    ),
    acct as (
      select a.id, a.account_type as t, p.codes, coalesce(r.roles, '{}') as roles,
             a.is_cash_account or a.is_bank_account as money
        from account a join path p on p.id = a.id left join role r on r.account_id = a.id
       where a.company_id = ${companyId}
    ),
    closes as (
      select distinct journal_entry_id from document
       where company_id = ${companyId} and doc_type = 'YEAR_END_CLOSE' and journal_entry_id is not null
    ),
    -- A branch is its own lines and its warehouses'.
    here as (select id from location where company_id = ${companyId} and (id = ${branchId} or parent_id = ${branchId})),
    daily as (
      select je.entry_date as d,
        coalesce(sum(jl.base_amount) filter (where '13' = any(x.codes)), 0) as ca,
        coalesce(sum(jl.base_amount) filter (where '13' = any(x.codes) and x.money), 0) as cash,
        coalesce(sum(jl.base_amount) filter (where 'AR_CONTROL' = any(x.roles)), 0) as ar,
        coalesce(sum(jl.base_amount) filter (where 'INVENTORY' = any(x.roles)), 0) as inv,
       -coalesce(sum(jl.base_amount) filter (where '21' = any(x.codes)), 0) as cl,
       -coalesce(sum(jl.base_amount) filter (where 'AP_CONTROL' = any(x.roles)), 0) as ap,
       -coalesce(sum(jl.base_amount) filter (where '23' = any(x.codes)), 0) as debt,
        coalesce(sum(jl.base_amount) filter (where x.t = 'ASSET'), 0) as assets,
       -coalesce(sum(jl.base_amount) filter (where x.t = 'LIABILITY'), 0) as liab,
       -coalesce(sum(jl.base_amount) filter (where yc.journal_entry_id is null and x.t = 'REVENUE'
                   and ('41' = any(x.codes) or '43' = any(x.codes)) and not '413' = any(x.codes)), 0) as sales,
       -coalesce(sum(jl.base_amount) filter (where yc.journal_entry_id is null and x.t = 'REVENUE'
                   and not (('41' = any(x.codes) or '43' = any(x.codes)) and not '413' = any(x.codes))), 0) as other_inc,
        coalesce(sum(jl.base_amount) filter (where yc.journal_entry_id is null and x.t = 'COGS'), 0) as cogs,
        coalesce(sum(jl.base_amount) filter (where yc.journal_entry_id is null and x.t = 'EXPENSE' and not '67' = any(x.codes)), 0) as opex,
        coalesce(sum(jl.base_amount) filter (where yc.journal_entry_id is null and x.t = 'EXPENSE' and '67' = any(x.codes)), 0) as interest,
        -- Money in from customers, and what suppliers billed: the turnovers' numerators.
       -coalesce(sum(jl.base_amount) filter (where 'AR_CONTROL' = any(x.roles) and jl.base_amount < 0
                   and je.source_type = 'CUSTOMER_RECEIPT'), 0) as collected,
       -coalesce(sum(jl.base_amount) filter (where 'AP_CONTROL' = any(x.roles) and jl.base_amount < 0
                   and je.source_type = 'PURCHASE_INVOICE'), 0) as billed_ap
        from journal_line jl
        join journal_entry je on je.id = jl.journal_entry_id
        join acct x on x.id = jl.account_id
        left join closes yc on yc.journal_entry_id = je.id
       where jl.company_id = ${companyId} and je.entry_date < ${last}::date
         and (${branchId}::uuid is null or jl.location_id in (select id from here))
       group by je.entry_date
    )
    select to_char(b.on_date, 'YYYY-MM-DD') as on_date,
           coalesce(sum(ca), 0)::float as ca, coalesce(sum(cash), 0)::float as cash,
           coalesce(sum(ar), 0)::float as ar, coalesce(sum(inv), 0)::float as inv,
           coalesce(sum(cl), 0)::float as cl, coalesce(sum(ap), 0)::float as ap,
           coalesce(sum(debt), 0)::float as debt, coalesce(sum(assets), 0)::float as assets,
           coalesce(sum(liab), 0)::float as liab, coalesce(sum(sales), 0)::float as sales,
           coalesce(sum(other_inc), 0)::float as "otherInc", coalesce(sum(cogs), 0)::float as cogs,
           coalesce(sum(opex), 0)::float as opex, coalesce(sum(interest), 0)::float as interest, coalesce(sum(collected), 0)::float as collected,
           coalesce(sum(billed_ap), 0)::float as "billedAp"
      from unnest(${[...new Set(dates)]}::date[]) as b(on_date)
      left join daily on daily.d < b.on_date
     group by b.on_date`;
  const at = new Map<string, Totals>();
  for (const r of rows) at.set(r.on_date as string, r as unknown as Totals);
  return at;
}

function windowOf(at: Map<string, Totals>, from: string, to: string): RatioWindow {
  const o = at.get(from)!, c = at.get(to)!;
  const flow = (k: Key) => c[k] - o[k];
  const avg = (k: Key) => (o[k] + c[k]) / 2;
  const days = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000));

  const netSales = flow("sales"), cogs = flow("cogs"), opex = flow("opex"), otherIncome = flow("otherInc");
  const interest = flow("interest");
  const grossProfit = netSales - cogs;
  const operatingProfit = grossProfit - opex;
  const netProfit = operatingProfit - interest + otherIncome;
  const equity = c.assets - c.liab;
  const avgEquity = (o.assets - o.liab + equity) / 2;
  const avgAssets = avg("assets");
  const avgCapital = avgEquity + avg("debt");
  const avgReceivable = avg("ar"), avgPayable = avg("ap");

  return {
    from, to, days,
    currentAssets: c.ca, cash: c.cash, receivable: c.ar, inventory: c.inv,
    otherCurrentAssets: c.ca - c.cash - c.ar - c.inv,
    currentLiabilities: c.cl, payable: c.ap, otherCurrentLiabilities: c.cl - c.ap,
    totalAssets: c.assets, totalLiabilities: c.liab, equity, debt: c.debt,
    workingCapital: c.ca - c.cl,
    netSales, cogs, grossProfit, operatingExpenses: opex, operatingProfit, interest, otherIncome, netProfit,
    collected: flow("collected"), creditPurchases: flow("billedAp"),
    avgReceivable, avgPayable, avgAssets, avgEquity, avgCapital,
    ratios: {
      current: div(c.ca, c.cl),
      quick: div(c.ca - c.inv, c.cl),
      cash: div(c.cash, c.cl),
      // No short-term investments in the chart, so cash and bank are the
      // whole of it; an investment account under 13 would join here.
      absolute: div(c.cash, c.cl),
      receivableTurnover: div(netSales, avgReceivable),
      debtorsTurnover: div(flow("collected"), avgReceivable),
      creditorsTurnover: div(flow("billedAp"), avgPayable),
      grossMargin: pct(grossProfit, netSales),
      operatingMargin: pct(operatingProfit, netSales),
      netMargin: pct(netProfit, netSales),
      roa: pct(netProfit, avgAssets),
      roe: pct(netProfit, avgEquity),
      roi: pct(netProfit, avgCapital),
      debtToEquity: div(c.debt, equity),
      debtToAssets: div(c.debt, c.assets),
      // Operating profit is before interest: what there is to pay it from.
      interestCover: div(operatingProfit, interest),
      liabilitiesToEquity: div(c.liab, equity),
      financialLeverage: div(avgAssets, avgEquity),
      // Cost of sales taken as the variable cost, expenses as the fixed:
      // how far operating profit moves for a move in sales.
      operatingLeverage: div(grossProfit, operatingProfit),
    },
  };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export type Compare = "previous" | "year";

/**
 * The period, what it is compared with, and one point per month — each
 * month from the period's start to that month's end, so a line shows where
 * the year stood rather than how one month swung.
 */
export async function getFinancialRatios(companyId: string, opts: {
  from: string; to: string; compare: Compare; branchId: string | null;
}, db: Sql = sql) {
  const { from, to } = opts;
  const span = new Date(to).getTime() - new Date(from).getTime();
  const [prevFrom, prevTo] = opts.compare === "year"
    ? [from, to].map((d) => { const x = new Date(d); x.setUTCFullYear(x.getUTCFullYear() - 1); return iso(x); })
    : [iso(new Date(new Date(from).getTime() - span)), from];

  const ends: string[] = [];
  const f = new Date(from);
  for (let m = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 1)); iso(m) < to; m.setUTCMonth(m.getUTCMonth() + 1)) {
    ends.push(iso(m));
  }
  ends.push(to);

  const at = await totalsAt(db, companyId, [from, to, prevFrom, prevTo, ...ends], opts.branchId);
  const trend = ends.map((e) => {
    const w = windowOf(at, from, e);
    const label = new Date(new Date(e).getTime() - 86_400_000)
      .toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
    return { label, ...w.ratios, workingCapital: w.workingCapital };
  });
  return { current: windowOf(at, from, to), previous: windowOf(at, prevFrom, prevTo), trend };
}

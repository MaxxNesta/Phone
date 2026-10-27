import { sql } from "./db";
import { loadSchedules, thisMonth, type LoadedAsset } from "./fa-schedule";
import { addMonths, sum, toUnits, type Month } from "./fa-engine";

/**
 * What can stop a month posting, found before anyone tries: a category whose
 * accounts are inactive or not postable, and a run that failed. Read by the
 * Overview, the calendar and the posting run alike.
 */
export async function faExceptions(co: string) {
  const [mapping, failed] = await Promise.all([
    sql`select c.id, c.name,
               array_remove(array[
                 case when not (a.is_active and a.is_postable) then a.code end,
                 case when not (x.is_active and x.is_postable) then x.code end,
                 case when not (e.is_active and e.is_postable) then e.code end], null) as bad
          from fa_category c join account a on a.id = c.asset_account_id
          join account x on x.id = c.accum_account_id join account e on e.id = c.expense_account_id
         where c.company_id = ${co}
           and not (a.is_active and a.is_postable and x.is_active and x.is_postable and e.is_active and e.is_postable)
           and exists (select 1 from fixed_asset f where f.category_id = c.id and f.status in ('ACTIVE', 'INACTIVE'))`,
    sql`select r.id, to_char(r.period_month, 'YYYY-MM') as month, b.name as branch, r.error
          from fa_run r join location b on b.id = r.branch_id
         where r.company_id = ${co} and r.status = 'FAILED'
           and not exists (select 1 from fa_run ok where ok.company_id = r.company_id and ok.branch_id = r.branch_id
                             and ok.period_month = r.period_month and ok.status = 'POSTED')`,
  ]);
  return {
    mapping: mapping as unknown as { id: string; name: string; bad: string[] }[],
    failed: failed as unknown as { id: string; month: string; branch: string; error: string | null }[],
  };
}

/** What an asset is worth to the ledger today: cost less everything posted. */
export const posted = (a: LoadedAsset) => sum(a.rows.filter((r) => r.state === "POSTED").map((r) => r.amount));
/** Depreciation that should be on the ledger by now and is not (this month included). */
export const pending = (a: LoadedAsset, upTo: Month) =>
  a.status === "ACTIVE" ? sum(a.rows.filter((r) => r.state === "PLANNED" && r.month <= upTo).map((r) => r.amount)) : 0n;

export async function faOverview(co: string, branches: string[] | null) {
  const now = thisMonth();
  const [assets, exceptions, counts] = await Promise.all([
    loadSchedules(co, { branches }),
    faExceptions(co),
    sql`select count(*)::int as total, count(*) filter (where status = 'ACTIVE')::int as active,
               count(*) filter (where status = 'DISPOSED')::int as disposed,
               count(*) filter (where status = 'DRAFT')::int as draft,
               coalesce(sum(acquisition_cost) filter (where status not in ('DISPOSED', 'DRAFT')), 0)::text as cost
          from fixed_asset where company_id = ${co} ${branches ? sql`and branch_id = any(${branches})` : sql``}`,
  ]);
  const held = assets.filter((a) => a.status !== "DISPOSED");
  const accumulated = sum(held.map(posted));
  const cost = toUnits(counts[0].cost);
  const monthOf = (m: Month) => sum(held.filter((a) => a.status === "ACTIVE")
    .map((a) => a.rows.find((r) => r.month === m)?.amount ?? 0n));
  const pend = held.map((a) => ({ a, v: pending(a, now) })).filter((x) => x.v > 0n);

  // Twelve months to this one: what was posted, and what the plan says for months still open.
  const trend = Array.from({ length: 12 }, (_, k) => addMonths(now, k - 11)).map((m) => {
    let p = 0n, plan = 0n;
    for (const a of held) {
      const r = a.rows.find((x) => x.month === m);
      if (!r) continue;
      if (r.state === "POSTED") p += r.amount; else if (a.status === "ACTIVE") plan += r.amount;
    }
    return { month: m, posted: p, planned: plan };
  });

  // By category: assets, cost, accumulated and net book value.
  const byCat = new Map<string, { name: string; assetClass: string; n: number; cost: bigint; accumulated: bigint }>();
  for (const a of held) {
    const c = byCat.get(a.categoryId) ?? { name: a.category, assetClass: a.assetClass, n: 0, cost: 0n, accumulated: 0n };
    c.n++; c.cost += a.engine.cost; c.accumulated += posted(a);
    byCat.set(a.categoryId, c);
  }

  return {
    now,
    counts: counts[0] as { total: number; active: number; disposed: number; draft: number },
    cost, accumulated, nbv: cost - accumulated,
    thisMonth: monthOf(now),
    pending: { amount: sum(pend.map((x) => x.v)), assets: pend.length },
    exceptions,
    exceptionCount: exceptions.mapping.length + exceptions.failed.length,
    trend,
    categories: [...byCat.values()].sort((x, y) => (y.cost > x.cost ? 1 : -1)),
  };
}

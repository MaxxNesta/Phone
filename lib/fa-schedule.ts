import { sql } from "./db";
import { schedule, toUnits, monthOf, type Convention, type EngineAsset, type ScheduleRow, type Month } from "./fa-engine";

/**
 * Schedules from the database: each asset's record, its changes of estimate
 * and what the ledger already carries for it, handed to the engine. The
 * calendar, the asset page and the posting run all read through here.
 */

export type LoadedAsset = {
  id: string; code: string; name: string; status: string;
  branchId: string; branch: string;
  /** Where its depreciation posts: the assigned branch unless the asset says otherwise. */
  postBranchId: string; postBranch: string;
  categoryId: string; category: string; assetClass: string;
  accumAccountId: string; expenseAccountId: string;
  inService: string | null; disposedOn: string | null;
  engine: EngineAsset;
  rows: ScheduleRow[];
};

export async function loadSchedules(co: string, f: { branches?: string[] | null; assetId?: string; categoryId?: string } = {}): Promise<LoadedAsset[]> {
  const [setting] = await sql`select start_convention from fa_setting where company_id = ${co}`;
  const fallback = (setting?.start_convention ?? "NEXT_MONTH") as Convention;
  const assets = await sql`
    select f.id, f.code, f.name, f.status, f.branch_id, b.name as branch,
           coalesce(f.posting_branch_id, f.branch_id) as post_branch_id, coalesce(pb.name, b.name) as post_branch, f.category_id, c.name as category, c.asset_class,
           c.accum_account_id, c.expense_account_id,
           to_char(f.in_service_date, 'YYYY-MM-DD') as in_service, to_char(f.disposed_on, 'YYYY-MM-DD') as disposed_on,
           f.acquisition_cost::text as cost, f.residual_value::text as residual, f.useful_life_months, f.start_convention
      from fixed_asset f join fa_category c on c.id = f.category_id join location b on b.id = f.branch_id
      left join location pb on pb.id = f.posting_branch_id
     where f.company_id = ${co} and f.status <> 'DRAFT'
       -- Seen by whoever sees the branch it is used at or the branch it posts to.
       ${f.branches ? sql`and (f.branch_id = any(${f.branches}) or coalesce(f.posting_branch_id, f.branch_id) = any(${f.branches}))` : sql``}
       ${f.assetId ? sql`and f.id = ${f.assetId}` : sql``}
       ${f.categoryId ? sql`and f.category_id = ${f.categoryId}` : sql``}
     order by f.code`;
  if (assets.length === 0) return [];
  const ids = (assets as any[]).map((a) => a.id);
  const [estimates, posted] = await Promise.all([
    sql`select asset_id, to_char(effective_month, 'YYYY-MM') as m, useful_life_months, residual_value::text as residual
          from fa_estimate_change where asset_id = any(${ids})`,
    // Runs (posted), linked history and corrections, added up per month.
    sql`select asset_id, to_char(period_month, 'YYYY-MM') as m, sum(amount)::text as amount,
               bool_or(source = 'OPENING') as opening
          from fa_depreciation where asset_id = any(${ids}) and journal_line_id is not null
         group by 1, 2`,
  ]);
  const openingBy = new Map((posted as any[]).filter((p) => p.opening).map((p) => [p.asset_id as string, p.m as Month]));
  const estBy = new Map<string, { from: Month; lifeMonths: number; residual: bigint }[]>();
  for (const e of estimates as any[]) estBy.set(e.asset_id, [...(estBy.get(e.asset_id) ?? []),
    { from: e.m, lifeMonths: e.useful_life_months, residual: toUnits(e.residual) }]);
  const postedBy = new Map<string, Map<Month, bigint>>();
  for (const p of posted as any[]) {
    const m = postedBy.get(p.asset_id) ?? new Map<Month, bigint>();
    m.set(p.m, toUnits(p.amount));
    postedBy.set(p.asset_id, m);
  }
  return (assets as any[]).map((a) => {
    const engine: EngineAsset = {
      cost: toUnits(a.cost), residual: toUnits(a.residual), lifeMonths: a.useful_life_months,
      inService: a.in_service, convention: (a.start_convention ?? fallback) as Convention, disposedOn: a.disposed_on,
    };
    return {
      id: a.id, code: a.code, name: a.name, status: a.status, branchId: a.branch_id, branch: a.branch,
      postBranchId: a.post_branch_id, postBranch: a.post_branch,
      categoryId: a.category_id, category: a.category, assetClass: a.asset_class,
      accumAccountId: a.accum_account_id, expenseAccountId: a.expense_account_id,
      inService: a.in_service, disposedOn: a.disposed_on, engine,
      rows: schedule(engine, { estimates: estBy.get(a.id), posted: postedBy.get(a.id), openingThrough: openingBy.get(a.id) }),
    };
  });
}

/** The current month in Yangon, "YYYY-MM". */
export const thisMonth = () => monthOf(new Date(Date.now() + 6.5 * 3600_000).toISOString().slice(0, 10));

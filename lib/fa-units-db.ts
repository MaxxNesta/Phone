import type { TransactionSql } from "postgres";
import { sql } from "./db";
import { unitPlan } from "./fa-units";

/**
 * A group's units kept in step with its code, cost and quantity while nothing
 * pins them: no depreciation posted and no units split off. After that the
 * units are history and change only by a split.
 */
export async function syncUnits(tx: TransactionSql, co: string, assetIds: string[]) {
  if (assetIds.length === 0) return;
  const assets = await tx`
    select f.id, f.code, f.acquisition_cost::text as cost, f.quantity::float as quantity
      from fixed_asset f
     where f.company_id = ${co} and f.id = any(${assetIds})
       and not exists (select 1 from fa_depreciation d where d.asset_id = f.id and d.journal_line_id is not null)
       and not exists (select 1 from fixed_asset c where c.parent_asset_id = f.id)`;
  if (assets.length === 0) return;
  const ids = (assets as any[]).map((a) => a.id);
  await tx`delete from fa_unit where asset_id = any(${ids})`;
  const rows = (assets as any[]).flatMap((a) => unitPlan(a.code, a.cost, a.quantity)
    .map((u) => ({ company_id: co, asset_id: a.id, seq: u.seq, code: u.code, cost: u.cost })));
  if (rows.length) await tx`insert into fa_unit ${tx(rows)}`;
}

export type FaUnit = { id: string; asset_id: string; seq: number; code: string; cost: string };

/** The units of some assets, in order: one query for any number of assets. */
export async function unitsOf(assetIds: string[]): Promise<FaUnit[]> {
  if (assetIds.length === 0) return [];
  return (await sql`select id, asset_id, seq, code, cost::text from fa_unit where asset_id = any(${assetIds}) order by asset_id, seq`) as unknown as FaUnit[];
}

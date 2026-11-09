import type { TransactionSql } from "postgres";
import { sql } from "./db";
import { toUnits, fromUnits } from "./fa-engine";
import { shareOut } from "./fa-units";

/**
 * Some of a group's units, split into an asset of their own, so the ordinary
 * transfer or disposal can move them. Nothing touches the ledger here: the
 * group and the split part together are exactly what the group was.
 *
 *   cost          the units' own costs
 *   residual, opening figure, posted depreciation, journal links
 *                 the units' share of each, to the cent, the group keeping the rest
 *   estimates     copied, residual shared the same way
 *   units         move with their codes
 *
 * Choosing every unit splits nothing: the asset itself is returned.
 */
export async function splitUnits(tx: TransactionSql, co: string, userId: string, assetId: string, unitIds: string[]): Promise<string> {
  const [a] = await tx`select * , acquisition_cost::text as cost_t, residual_value::text as residual_t, opening_accumulated::text as opening_t
                         from fixed_asset where id = ${assetId} and company_id = ${co} for update`;
  if (!a) throw new Error("That asset is not in this company.");
  const units = await tx`select id, code, cost::text from fa_unit where asset_id = ${assetId} order by seq`;
  const picked = (units as any[]).filter((u) => unitIds.includes(u.id));
  if (picked.length !== unitIds.length) throw new Error("A chosen unit is not one of this asset's.");
  if (picked.length === 0) throw new Error("Choose the units.");
  if (picked.length === units.length) return assetId;
  const [draft] = await tx`select 1 from fa_depreciation where asset_id = ${assetId} and journal_line_id is null limit 1`;
  if (draft) throw new Error("A depreciation draft is waiting for this asset; post or discard it first.");

  const cost = toUnits(a.cost_t);
  const part = picked.reduce((s: bigint, u: any) => s + toUnits(u.cost), 0n);
  const rest = cost - part;
  /** The split part's share of an amount, to the cent; the group keeps the rest. */
  const share = (v: bigint) => shareOut(v, [rest, part])[1];
  const residual = share(toUnits(a.residual_t));
  const opening = a.opening_t ? share(toUnits(a.opening_t)) : null;
  const [n] = await tx`select count(*)::int as n from fixed_asset where parent_asset_id = ${assetId}`;
  const code = picked.length === 1 ? picked[0].code : `${a.code}-S${Number(n.n) + 1}`;

  const [child] = await tx`
    insert into fixed_asset (company_id, code, name, category_id, branch_id, posting_branch_id, site, serial_no, supplier_id,
                             acquisition_date, in_service_date, acquisition_cost, residual_value, useful_life_months, method,
                             start_convention, status, notes, created_by, quantity, depreciation_start, opening_accumulated,
                             opening_through, source_ref, parent_asset_id)
    values (${co}, ${code}, ${a.name}, ${a.category_id}, ${a.branch_id}, ${a.posting_branch_id}, ${a.site}, ${a.serial_no}, ${a.supplier_id},
            ${a.acquisition_date}, ${a.in_service_date}, ${fromUnits(part)}, ${fromUnits(residual)}, ${a.useful_life_months}, ${a.method},
            ${a.start_convention}, ${a.status}, ${a.notes}, ${userId}, ${picked.length}, ${a.depreciation_start},
            ${opening === null ? null : fromUnits(opening)}, ${a.opening_through}, ${a.source_ref}, ${assetId})
    returning id`;
  await tx`update fixed_asset set acquisition_cost = ${fromUnits(rest)}, residual_value = ${fromUnits(toUnits(a.residual_t) - residual)},
             quantity = quantity - ${picked.length},
             opening_accumulated = ${opening === null ? null : fromUnits(toUnits(a.opening_t) - opening)}, updated_at = now()
           where id = ${assetId}`;
  await tx`update fa_unit set asset_id = ${child.id} where id = any(${unitIds})`;

  // Posted depreciation and journal links: each row's share moves, in one statement each way.
  const deps = await tx`select id, amount::text from fa_depreciation where asset_id = ${assetId} and journal_line_id is not null`;
  if (deps.length) {
    // The one edit a posted row allows, for this transaction only (migration 0184).
    await tx`select set_config('fa.split', 'on', true)`;
    const parts = (deps as any[]).map((d) => ({ id: d.id as string, part: share(toUnits(d.amount)) }));
    await tx`insert into fa_depreciation (company_id, asset_id, period_month, source, amount, run_id, journal_line_id, is_link, note, created_by)
             select d.company_id, ${child.id}, d.period_month, d.source, v.part, d.run_id, d.journal_line_id, d.is_link, 'Split from ' || ${a.code}, ${userId}
               from fa_depreciation d join (select unnest(${parts.map((p) => p.id)}::uuid[]) as id, unnest(${parts.map((p) => fromUnits(p.part))}::numeric[]) as part) v on v.id = d.id`;
    await tx`update fa_depreciation d set amount = d.amount - v.part
               from (select unnest(${parts.map((p) => p.id)}::uuid[]) as id, unnest(${parts.map((p) => fromUnits(p.part))}::numeric[]) as part) v
              where d.id = v.id`;
  }
  const links = await tx`select id, amount::text from fa_journal_link where asset_id = ${assetId}`;
  if (links.length) {
    const parts = (links as any[]).map((l) => ({ id: l.id as string, part: share(toUnits(l.amount)) })).filter((p) => p.part > 0n);
    if (parts.length) {
      await tx`insert into fa_journal_link (company_id, asset_id, journal_line_id, kind, amount, note, created_by)
               select k.company_id, ${child.id}, k.journal_line_id, k.kind, v.part, coalesce(k.note, '') || ' (split)', ${userId}
                 from fa_journal_link k join (select unnest(${parts.map((p) => p.id)}::uuid[]) as id, unnest(${parts.map((p) => fromUnits(p.part))}::numeric[]) as part) v on v.id = k.id`;
      await tx`update fa_journal_link k set amount = k.amount - v.part
                 from (select unnest(${parts.map((p) => p.id)}::uuid[]) as id, unnest(${parts.map((p) => fromUnits(p.part))}::numeric[]) as part) v
                where k.id = v.id`;
    }
  }
  const est = await tx`select effective_month, useful_life_months, residual_value::text as residual, reason from fa_estimate_change where asset_id = ${assetId}`;
  if (est.length) {
    await tx`insert into fa_estimate_change ${tx((est as any[]).map((e) => ({ company_id: co, asset_id: child.id, effective_month: e.effective_month,
      useful_life_months: e.useful_life_months, residual_value: fromUnits(share(toUnits(e.residual))), reason: e.reason, created_by: userId })))}`;
    for (const e of est as any[]) await tx`update fa_estimate_change set residual_value = residual_value - ${fromUnits(share(toUnits(e.residual)))}
                                             where asset_id = ${assetId} and effective_month = ${e.effective_month}`;
  }
  const detail = { units: picked.map((u: any) => u.code), cost: fromUnits(part), from: a.code, to: code };
  await tx`insert into fa_event ${tx([
    { company_id: co, asset_id: assetId, event_type: "SPLIT", event_date: new Date().toISOString().slice(0, 10), created_by: userId, detail: tx.json(detail) },
    { company_id: co, asset_id: child.id, event_type: "SPLIT", event_date: new Date().toISOString().slice(0, 10), created_by: userId, detail: tx.json(detail) },
  ])}`;
  return child.id as string;
}

/** What a split part would be, worked out inside a transaction that is then undone. */
export async function trySplit<T>(co: string, userId: string, assetId: string, unitIds: string[], fn: (tx: TransactionSql, id: string) => Promise<T>): Promise<T> {
  class Undo extends Error { constructor(public value: T) { super("undo"); } }
  try {
    await sql.begin(async (tx) => { const id = await splitUnits(tx, co, userId, assetId, unitIds); throw new Undo(await fn(tx, id)); });
  } catch (e) {
    if (e instanceof Undo) return e.value;
    throw e;
  }
  throw new Error("unreachable");
}

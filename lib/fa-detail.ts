import { sql } from "./db";
import { assetList } from "./fixed-assets";
import { loadSchedules } from "./fa-schedule";
import { toUnits } from "./fa-engine";
import type { DetailEvent, DetailJournal, DetailUnit } from "@/components/asset-detail";

/**
 * Everything the asset page and the unit page show, read once: the asset,
 * its schedule, its journals, its history and its units, the units split off
 * from it included (at the branch and status of the asset they now belong to).
 */
export async function loadAssetDetail(co: string, seen: string[] | null, id: string) {
  const [[a], [s], journals, events, units] = await Promise.all([
    assetList(co, seen, id),
    loadSchedules(co, { branches: seen, assetId: id }),
    sql`select to_char(d.period_month, 'YYYY-MM') as m, d.source, d.is_link, doc.id as doc_id, doc.doc_no
          from fa_depreciation d join journal_line jl on jl.id = d.journal_line_id
          join journal_entry je on je.id = jl.journal_entry_id left join document doc on doc.id = je.source_id
         where d.asset_id = ${id} order by d.period_month, d.created_at`,
    sql`select e.event_type, to_char(e.event_date, 'YYYY-MM-DD') as date, e.detail, u.name as by,
               fb.name as from_branch, tb.name as to_branch
          from fa_event e left join app_user u on u.id = e.created_by
          left join location fb on fb.id = e.from_branch_id left join location tb on tb.id = e.to_branch_id
         where e.asset_id = ${id} order by e.event_date desc, e.created_at desc`,
    sql`select u.id, u.code, u.cost::text as cost, u.asset_id, f.status, b.name as branch
          from fa_unit u join fixed_asset f on f.id = u.asset_id join location b on b.id = f.branch_id
         where u.asset_id = ${id} or u.asset_id in (select c.id from fixed_asset c where c.parent_asset_id = ${id})
         order by u.code`,
  ]);
  if (!a) return null;
  return {
    a: { ...a, heading: s?.heading },
    rows: s?.rows ?? [],
    cost: s?.engine.cost ?? 0n,
    journals: journals as unknown as DetailJournal[],
    events: events as unknown as DetailEvent[],
    units: (units as any[]).map((u): DetailUnit => ({ id: u.id, code: u.code, cost: toUnits(u.cost), assetId: u.asset_id, branch: u.branch, status: u.status })),
  };
}

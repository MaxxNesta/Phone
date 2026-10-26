import { sql } from "./db";

import { AGING_DEFAULTS, PACE_DEFAULTS, bucketOf, paceOf, type AgingRules, type PaceRules, type Pace } from "./aging-rules";
export * from "./aging-rules";

export async function agingSettings(co: string) {
  const rows = await sql`select item_group_id, thresholds, labels, pace_fast_days, pace_slow_days
                           from inventory_aging_setting where company_id = ${co}`;
  const base = (rows as any[]).find((r) => !r.item_group_id);
  const rules: AgingRules = base
    ? { thresholds: base.thresholds.map(Number), labels: base.labels } : AGING_DEFAULTS;
  const pace: PaceRules = base ? { fastDays: base.pace_fast_days, slowDays: base.pace_slow_days } : PACE_DEFAULTS;
  const byGroup = new Map<string, AgingRules["thresholds"]>(
    (rows as any[]).filter((r) => r.item_group_id).map((r) => [r.item_group_id, r.thresholds.map(Number)]));
  return { rules, pace, byGroup };
}

/**
 * Stock on hand by variant and branch, each unit's age from the day its lot
 * was received, sorted into the shop's four buckets (by its top category's
 * cut-offs when it has its own), with what sold in the last 30 and 90 days.
 */
export async function agingReport(co: string, locs: string[] | null, f: { q?: string; groupId?: string; branchId?: string }) {
  const settings = await agingSettings(co);
  const like = f.q ? `%${f.q.trim()}%` : null;
  const [held, sold] = await Promise.all([
    sql`
      select l.item_id, coalesce(br.id, loc.id) as branch_id, coalesce(br.name, loc.name) as branch,
             ((now() at time zone 'Asia/Yangon')::date - (l.received_date at time zone 'Asia/Yangon')::date)::int as age,
             sum(l.qty_remaining)::float as qty, sum(l.qty_remaining * l.unit_cost)::float as value
        from v_stock_lot_open l
        join location loc on loc.id = l.location_id
        left join location br on br.id = loc.parent_id
       where l.company_id = ${co}
         ${locs ? sql`and l.location_id = any(${locs})` : sql``}
         ${f.branchId ? sql`and coalesce(br.id, loc.id) = ${f.branchId}` : sql``}
       group by 1, 2, 3, 4`,
    sql`
      select sm.item_id, coalesce(br.id, loc.id) as branch_id,
             sum(-sm.qty) filter (where sm.movement_date > current_date - 30)::float as sold_30,
             sum(-sm.qty)::float as sold_90
        from stock_movement sm join document d on d.id = sm.document_id
        join location loc on loc.id = sm.location_id left join location br on br.id = loc.parent_id
       where sm.company_id = ${co} and d.status = 'POSTED' and sm.kind is null
         and d.doc_type in ('SALES_INVOICE', 'DELIVERY', 'SALES_RETURN')
         and sm.movement_date > current_date - 90
         ${locs ? sql`and sm.location_id = any(${locs})` : sql``}
       group by 1, 2`,
  ]);
  const ids = [...new Set((held as any[]).map((h) => h.item_id))];
  const items = ids.length ? await sql`
    select i.id, i.code, i.name, coalesce(p.name, i.name) as model, b.name as brand,
           coalesce(gp.id, g.id) as top_id, coalesce(gp.name, g.name) as category,
           case when i.photo_updated_at is not null
                  then '/items/' || i.id || '/photo?v=' || to_char(i.photo_updated_at, 'YYYYMMDDHH24MISSMS')
                when p.photo_updated_at is not null
                  then '/items/' || p.id || '/photo?v=' || to_char(p.photo_updated_at, 'YYYYMMDDHH24MISSMS') end as photo,
           (select string_agg(o.name, ' · ' order by coalesce(iva.sort_order, 0), a.name)
              from item_variant_option ivo join variant_option o on o.id = ivo.option_id
              join variant_attribute a on a.id = o.attribute_id
              left join item_variant_attribute iva on iva.item_id = i.parent_item_id and iva.attribute_id = a.id
             where ivo.item_id = i.id) as variant
      from item i left join item p on p.id = i.parent_item_id
      left join brand b on b.id = coalesce(p.brand_id, i.brand_id)
      join item_group g on g.id = i.item_group_id left join item_group gp on gp.id = g.parent_id
     where i.id = any(${ids})
       and (${like}::text is null or i.name ilike ${like} or i.code ilike ${like} or p.name ilike ${like})
       and (${f.groupId ?? null}::uuid is null or g.id = ${f.groupId ?? null} or g.parent_id = ${f.groupId ?? null})` : [];
  const itemBy = new Map((items as any[]).map((i) => [i.id as string, i]));
  const soldBy = new Map((sold as any[]).map((s) => [`${s.item_id}|${s.branch_id}`, s]));

  type Row = { key: string; id: string; code: string; name: string; model: string; variant: string | null;
    brand: string | null; category: string; photo: string | null; branch: string; units: number; value: number;
    units4: number[]; value4: number[]; ageSum: number; avgAge: number; oldest: number;
    sold30: number; sold90: number; pace: Pace; cover: number | null; thresholds: AgingRules["thresholds"] };
  const rows = new Map<string, Row>();
  for (const h of held as any[]) {
    const it = itemBy.get(h.item_id);
    if (!it) continue;
    const key = `${h.item_id}|${h.branch_id}`;
    const t = settings.byGroup.get(it.top_id) ?? settings.rules.thresholds;
    let r = rows.get(key);
    if (!r) {
      r = { key, id: it.id, code: it.code, name: it.name, model: it.model, variant: it.variant, brand: it.brand,
            category: it.category, photo: it.photo, branch: h.branch, units: 0, value: 0, units4: [0, 0, 0, 0],
            value4: [0, 0, 0, 0], ageSum: 0, avgAge: 0, oldest: 0, sold30: 0, sold90: 0, pace: "NONE", cover: null, thresholds: t };
      rows.set(key, r);
    }
    const b = bucketOf(h.age, t);
    r.units += h.qty; r.value += h.value; r.units4[b] += h.qty; r.value4[b] += h.value;
    r.ageSum += h.age * h.qty; r.oldest = Math.max(r.oldest, h.age);
  }
  const out = [...rows.values()].map((r) => {
    const s = soldBy.get(r.key);
    const sold30 = Math.max(0, Number(s?.sold_30 ?? 0)), sold90 = Math.max(0, Number(s?.sold_90 ?? 0));
    return { ...r, avgAge: r.units ? Math.round(r.ageSum / r.units) : 0, sold30, sold90, ...paceOf(r.units, sold90, settings.pace) };
  }).sort((a, b) => b.value - a.value || b.units - a.units);
  return { rows: out, ...settings };
}

import { sql } from "./db";

/** Display status: a draft whose allocation is current reads as Calculated. */
export const LC_STATUS: Record<string, string> = {
  DRAFT: "Draft", CALCULATED: "Calculated", POSTED: "Posted", REVERSED: "Reversed",
};

const statusExpr = sql`case when d.status = 'DRAFT' and lc.calculated_at is not null then 'CALCULATED' else d.status end`;

/** Landed costs a person may see: every one, or those touching their branch's receipts. */
export async function listLandedCosts(companyId: string, locs: string[] | null) {
  return sql`
    select d.id, d.doc_no, d.doc_date::text as doc_date, ${statusExpr} as status,
           d.gross_total::float as total, d.currency, lc.shipment_ref, lc.carrier_ref,
           u.name as posted_by,
           coalesce(string_agg(distinct g.doc_no, ', '), '') as receipts,
           coalesce(string_agg(distinct p.name, ', '), '') as suppliers,
           coalesce(string_agg(distinct l.name, ', '), '') as warehouses,
           coalesce((select string_agg(distinct pp.name, ', ') from landed_cost_charge c
                       join business_partner pp on pp.id = c.partner_id where c.landed_cost_id = d.id), '') as payees,
           array_agg(distinct g.id) filter (where g.id is not null) as receipt_ids
      from document d
      join landed_cost lc on lc.document_id = d.id
      left join landed_cost_receipt r on r.landed_cost_id = d.id
      left join document g on g.id = r.receipt_id
      left join business_partner p on p.id = g.partner_id
      left join location l on l.id = g.location_id
      left join app_user u on u.id = d.posted_by_id
     where d.company_id = ${companyId} and d.doc_type = 'LANDED_COST'
       and d.status <> 'CANCELLED' and d.reverses_document_id is null
       ${locs ? sql`and (g.location_id is null or g.location_id = any(${locs}))` : sql``}
     group by d.id, d.doc_no, d.doc_date, d.status, lc.calculated_at, d.gross_total, d.currency,
              lc.shipment_ref, lc.carrier_ref, u.name
     order by d.doc_date desc, d.doc_no desc`;
}

/** Posted goods receipts to choose from, newest first. */
export async function postedReceipts(companyId: string, locs: string[] | null) {
  return sql`
    select d.id, d.doc_no, d.doc_date::text as doc_date, p.name as supplier, l.name as warehouse,
           (select count(*)::int from stock_serial s join stock_movement sm on sm.id = s.stock_movement_id
             where sm.document_id = d.id) as phones,
           (select count(*)::int from landed_cost_receipt r join document x on x.id = r.landed_cost_id
             where r.receipt_id = d.id and x.status = 'POSTED') as landed_costs
      from document d
      left join business_partner p on p.id = d.partner_id
      left join location l on l.id = d.location_id
     where d.company_id = ${companyId} and d.doc_type = 'GOODS_RECEIPT'
       and d.status = 'POSTED' and d.reverses_document_id is null
       ${locs ? sql`and d.location_id = any(${locs})` : sql``}
     order by d.doc_date desc, d.doc_no desc
     limit 300`;
}

/** Everything the landed cost page shows. */
export async function getLandedCost(companyId: string, id: string) {
  const [head] = await sql`
    select d.id, d.doc_no, d.doc_date::text as doc_date, d.status as doc_status, ${statusExpr} as status,
           d.memo as notes, d.gross_total::float as total, d.location_id, d.reversed_by_document_id,
           d.journal_entry_id, je.entry_no,
           rv.doc_no as reversal_no, rv.journal_entry_id as reversal_entry_id,
           lc.template_id, lc.shipment_ref, lc.carrier_ref,
           lc.calculated_at, cu.name as calculated_by, lc.excluded_ack_at, au.name as excluded_ack_by,
           d.created_at, cr.name as created_by, d.posted_at, pu.name as posted_by,
           lc.reversed_at, ru.name as reversed_by, lc.reversal_reason
      from document d
      join landed_cost lc on lc.document_id = d.id
      left join journal_entry je on je.id = d.journal_entry_id
      left join document rv on rv.id = d.reversed_by_document_id
      left join app_user cu on cu.id = lc.calculated_by
      left join app_user au on au.id = lc.excluded_ack_by
      left join app_user cr on cr.id = d.created_by_id
      left join app_user pu on pu.id = d.posted_by_id
      left join app_user ru on ru.id = lc.reversed_by
     where d.id = ${id} and d.company_id = ${companyId} and d.doc_type = 'LANDED_COST'`;
  if (!head) return null;

  const receipts = await sql`
    select g.id, g.doc_no, g.doc_date::text as doc_date, g.location_id, p.name as supplier, l.name as warehouse,
           (select count(*)::int from stock_serial s join stock_movement sm on sm.id = s.stock_movement_id where sm.document_id = g.id) as phones,
           (select coalesce(sum(total_cost), 0)::float from stock_movement sm where sm.document_id = g.id and sm.qty > 0) as original_value,
           (select coalesce(string_agg(x.doc_no, ', '), '') from landed_cost_receipt r2 join document x on x.id = r2.landed_cost_id
             where r2.receipt_id = g.id and x.status = 'POSTED' and x.id <> ${id}) as earlier
      from landed_cost_receipt r
      join document g on g.id = r.receipt_id
      left join business_partner p on p.id = g.partner_id
      left join location l on l.id = g.location_id
     where r.landed_cost_id = ${id}
     order by g.doc_no`;

  const charges = await sql`
    select c.id, c.line_no, c.cost_type_id, t.name as cost_type, c.partner_id, bp.name as payee,
           c.source_journal_line_id, je.entry_no as source_entry_no, src.doc_no as source_doc_no,
           c.description, c.currency, c.exchange_rate::float as exchange_rate, c.rate_date::text as rate_date,
           ru.name as rate_entered_by, c.fc_amount::float as fc_amount, c.base_amount::float as base_amount,
           c.method, c.clearing_account_id, a.code || ' ' || a.name as clearing_account, c.reference,
           coalesce((select json_agg(json_build_object('itemId', m.item_id, 'amount', m.amount::float))
                       from landed_cost_manual m where m.charge_id = c.id), '[]'::json) as manual
      from landed_cost_charge c
      join landed_cost_type t on t.id = c.cost_type_id
      join account a on a.id = c.clearing_account_id
      left join business_partner bp on bp.id = c.partner_id
      left join journal_line jl on jl.id = c.source_journal_line_id
      left join journal_entry je on je.id = jl.journal_entry_id
      left join document src on src.id = je.source_id
      left join app_user ru on ru.id = c.rate_entered_by
     where c.landed_cost_id = ${id}
     order by c.line_no`;

  // Per phone: what it cost to buy, this landed cost's share, and where it is now.
  const phones = await sql`
    select a.serial_id, s.serial_no, a.item_id, i.name as item_name, g.doc_no as receipt_no,
           max(a.original_cost)::float as original_cost, sum(a.amount)::float as allocated,
           v.status, v.location_name, v.unit_cost::float as current_cost,
           (select p.treatment from landed_cost_posting p where p.landed_cost_id = ${id}
             and p.document_id = ${id} and p.serial_id = a.serial_id limit 1) as treatment
      from landed_cost_allocation a
      join stock_serial s on s.id = a.serial_id
      join item i on i.id = a.item_id
      join document g on g.id = a.receipt_id
      join v_stock_serial v on v.serial_id = a.serial_id
     where a.landed_cost_id = ${id}
     group by a.serial_id, s.serial_no, a.item_id, i.name, g.doc_no, v.status, v.location_name, v.unit_cost
     order by i.name, g.doc_no, s.serial_no`;

  // Before calculating, the phones the receipts brought in, with no share yet.
  const eligible = await sql`
    select s.id as serial_id, s.serial_no, s.item_id, i.name as item_name, g.doc_no as receipt_no
      from landed_cost_receipt r
      join stock_movement sm on sm.document_id = r.receipt_id
      join stock_serial s on s.stock_movement_id = sm.id
      join item i on i.id = s.item_id
      join document g on g.id = r.receipt_id
     where r.landed_cost_id = ${id}
     order by i.name, s.serial_no`;

  const excluded = await sql`
    select g.doc_no as receipt_no, dl.line_no, i.name as item_name, dl.base_qty::float as qty, dl.net_amount::float as value
      from landed_cost_receipt r
      join document g on g.id = r.receipt_id
      join document_line dl on dl.document_id = g.id
      join item i on i.id = dl.item_id
     where r.landed_cost_id = ${id} and not coalesce(i.tracks_serial, false)
     order by g.doc_no, dl.line_no`;

  const history = await sql`
    select h.action, h.reason, h.acted_at, u.name as by
      from document_history h left join app_user u on u.id = h.acted_by
     where h.document_id = ${id} order by h.acted_at`;

  return { head, receipts, charges, phones, eligible, excluded, history };
}

/** Debits to a clearing account no landed cost has spread yet: bills to link. */
export async function clearingSources(companyId: string, exceptLandedCostId?: string) {
  return sql`
    select jl.id, je.entry_no, je.entry_date::text as entry_date, src.doc_no, src.doc_type,
           jl.currency, jl.amount::float as fc_amount, jl.base_amount::float as base_amount,
           jl.exchange_rate::float as exchange_rate, bp.name as partner, coalesce(je.memo, '') as memo
      from journal_line jl
      join journal_entry je on je.id = jl.journal_entry_id
      left join document src on src.id = je.source_id
      left join business_partner bp on bp.id = jl.partner_id
     where jl.company_id = ${companyId} and jl.base_amount > 0
       and jl.account_id in (
             select account_id from system_account where company_id = ${companyId} and role = 'LANDED_COST_CLEARING'
             union select clearing_account_id from landed_cost_type where company_id = ${companyId} and clearing_account_id is not null)
       and (src.id is null or (src.status = 'POSTED' and src.reverses_document_id is null))
       and coalesce(src.doc_type, '') <> 'LANDED_COST'
       and not exists (select 1 from landed_cost_charge c where c.source_journal_line_id = jl.id and c.is_active
                         and c.landed_cost_id is distinct from ${exceptLandedCostId ?? null})
     order by je.entry_date desc
     limit 200`;
}

export async function landedCostTypes(companyId: string, activeOnly = false) {
  return sql`
    select t.id, t.code, t.name, t.default_method, t.clearing_account_id, t.default_partner_id,
           t.default_currency, t.is_active, a.code || ' ' || a.name as clearing_account, p.name as default_partner
      from landed_cost_type t
      left join account a on a.id = t.clearing_account_id
      left join business_partner p on p.id = t.default_partner_id
     where t.company_id = ${companyId} ${activeOnly ? sql`and t.is_active` : sql``}
     order by t.name`;
}

export async function landedCostTemplates(companyId: string, activeOnly = false) {
  return sql`
    select t.id, t.name, t.is_active,
           coalesce((select json_agg(json_build_object('costTypeId', l.cost_type_id, 'method', l.method, 'name', ty.name)
                                     order by l.line_no)
                       from landed_cost_template_line l join landed_cost_type ty on ty.id = l.cost_type_id
                      where l.template_id = t.id), '[]'::json) as lines
      from landed_cost_template t
     where t.company_id = ${companyId} ${activeOnly ? sql`and t.is_active` : sql``}
     order by t.name`;
}

/** A goods receipt's value before and after its landed costs. */
export async function receiptLandedSummary(companyId: string, receiptId: string) {
  const [r] = await sql`
    select (select coalesce(sum(total_cost), 0)::float from stock_movement where document_id = ${receiptId} and qty > 0) as original,
           (select count(distinct r.landed_cost_id)::int from landed_cost_receipt r join document d on d.id = r.landed_cost_id
             where r.receipt_id = ${receiptId} and d.status in ('DRAFT', 'POSTED', 'REVERSED') and d.reverses_document_id is null
               and d.company_id = ${companyId}) as count`;
  // Net of reversals: each posting row is one phone's amount, once.
  const [added] = await sql`
    select coalesce(sum(p.amount), 0)::float as v
      from landed_cost_posting p
     where p.serial_id in (select s.id from stock_serial s join stock_movement sm on sm.id = s.stock_movement_id
                            where sm.document_id = ${receiptId})`;
  return { original: r.original, added: added.v, final: r.original + added.v, count: r.count };
}

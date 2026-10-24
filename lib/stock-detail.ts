"use server";

import { requirePermission, can } from "./auth";
import { sql } from "./db";
import { seenLocations } from "./branch-scope";

/**
 * What the Stock page loads when one of a row's tabs is opened: the units on
 * the shelf by IMEI or serial, and the item's latest movements. Asked for one
 * item at a time, so the page itself stays one read; limited to the
 * warehouses the person may see.
 */
async function scope(itemId: string) {
  const user = await requirePermission("inventory.view");
  const [i] = await sql`select id from item where id = ${itemId} and company_id = ${user.companyId}`;
  if (!i) throw new Error("That item is not in this company.");
  return { co: user.companyId, locs: await seenLocations(), seeCost: can(user, "cost.view") };
}

export type StockUnit = {
  id: string; imei: string; imei2: string | null; location: string | null; status: string;
  receivedOn: string | null; receivedId: string | null; receivedDate: string | null; unitCost: number | null;
};

/** The units of this item still in the shop's hands: on the shelf or held. */
export async function stockUnits(itemId: string): Promise<StockUnit[]> {
  const { co, locs, seeCost } = await scope(itemId);
  const rows = await sql`
    select serial_id, imei, imei2, location_name, status, received_on, received_document_id,
           to_char(received_date, 'YYYY-MM-DD') as received_date, unit_cost
      from v_stock_serial
     where company_id = ${co} and item_id = ${itemId}
       and status not in ('SOLD', 'RETURNED_TO_SUPPLIER', 'WRITTEN_OFF', 'ISSUED')
       ${locs ? sql`and location_id = any(${locs})` : sql``}
     order by received_date desc nulls last, imei
     limit 500`;
  return (rows as any[]).map((r) => ({
    id: r.serial_id, imei: r.imei, imei2: r.imei2, location: r.location_name, status: r.status,
    receivedOn: r.received_on, receivedId: r.received_document_id, receivedDate: r.received_date,
    unitCost: seeCost && r.unit_cost != null ? Number(r.unit_cost) : null,
  }));
}

export type StockMove = {
  id: string; date: string; docType: string | null; docNo: string | null; documentId: string | null;
  location: string; qty: number;
};

/** The item's last twenty movements, newest first. */
export async function stockMoves(itemId: string): Promise<StockMove[]> {
  const { co, locs } = await scope(itemId);
  const rows = await sql`
    select sm.id, to_char(sm.created_at, 'YYYY-MM-DD HH24:MI') as date, d.doc_type, d.doc_no, d.id as document_id,
           l.name as location, sm.qty::float as qty
      from stock_movement sm
      join location l on l.id = sm.location_id
      left join document d on d.id = sm.document_id
     where sm.company_id = ${co} and sm.item_id = ${itemId} and sm.qty <> 0 and sm.kind is null
       ${locs ? sql`and sm.location_id = any(${locs})` : sql``}
     order by sm.created_at desc
     limit 20`;
  return (rows as any[]).map((r) => ({
    id: r.id, date: r.date, docType: r.doc_type, docNo: r.doc_no, documentId: r.document_id,
    location: r.location, qty: Number(r.qty),
  }));
}

export type StockCost = {
  receiptId: string; receiptNo: string | null; receiptDate: string;
  currency: string; rate: number;
  /** In the receipt's currency; the same as unitCost when that is kyat. */
  fcUnitPrice: number;
  unitCost: number;
  /** Each charge spread onto one unit of this receipt, by cost type. */
  landed: { type: string; perUnit: number }[];
  totalUnitCost: number;
};

/**
 * What one unit of the latest receipt cost: the supplier's price in its own
 * currency, the rate it came in at, and the landed costs posted against that
 * receipt, per unit. Receipt prices are stored in kyat, so the foreign price
 * is the stored one over the rate.
 */
export async function stockCost(itemId: string): Promise<StockCost | null> {
  const { co, seeCost } = await scope(itemId);
  if (!seeCost) return null;
  const [r] = await sql`
    select d.id, d.doc_no, to_char(d.doc_date, 'YYYY-MM-DD') as doc_date, d.currency, d.exchange_rate::float as rate,
           (sum(dl.net_amount) / nullif(sum(dl.base_qty), 0))::float as unit_cost
      from document_line dl
      join document d on d.id = dl.document_id
     where d.company_id = ${co} and dl.item_id = ${itemId}
       and d.doc_type = 'GOODS_RECEIPT' and d.status = 'POSTED' and dl.base_qty > 0
     group by d.id
     order by d.doc_date desc, d.created_at desc
     limit 1`;
  if (!r) return null;
  const landed = await sql`
    select t.name as type, (sum(a.amount) / nullif(u.n, 0))::float as per_unit
      from landed_cost_allocation a
      join landed_cost_charge ch on ch.id = a.charge_id and ch.is_active
      join landed_cost_type t on t.id = ch.cost_type_id
      join document ld on ld.id = a.landed_cost_id and ld.status = 'POSTED'
      cross join (select count(distinct serial_id) as n from landed_cost_allocation x
                    join document xd on xd.id = x.landed_cost_id and xd.status = 'POSTED'
                   where x.receipt_id = ${r.id} and x.item_id = ${itemId}) u
     where a.receipt_id = ${r.id} and a.item_id = ${itemId}
     group by t.name, u.n
     order by t.name`;
  const unitCost = Number(r.unit_cost ?? 0);
  const rate = Number(r.rate) || 1;
  const rows = (landed as any[]).map((l) => ({ type: l.type as string, perUnit: Number(l.per_unit ?? 0) }));
  return {
    receiptId: r.id, receiptNo: r.doc_no, receiptDate: r.doc_date, currency: r.currency, rate,
    fcUnitPrice: unitCost / rate, unitCost, landed: rows,
    totalUnitCost: unitCost + rows.reduce((s, l) => s + l.perUnit, 0),
  };
}

export type ReorderChoice = { id: string; name: string; category: string; variants: { id: string; parts: { a: string; o: string }[] }[] };

/**
 * What a reorder point can be set on: every model with its variants, and
 * every plain stocked item. Asked when the form opens, not sent with the
 * page — a catalogue of 1,500 variants was most of the Stock page's weight.
 */
export async function reorderChoices(): Promise<ReorderChoice[]> {
  const user = await requirePermission("inventory.view");
  const rows = await sql`
    select i.id, i.name, coalesce(pg.name, g.name) as category,
           coalesce((select json_agg(json_build_object('id', k.id, 'parts',
                      coalesce((select json_agg(json_build_object('a', a.name, 'o', o.name)
                                                order by coalesce(iva.sort_order, 0), a.name)
                                  from item_variant_option ivo
                                  join variant_option o on o.id = ivo.option_id
                                  join variant_attribute a on a.id = o.attribute_id
                                  left join item_variant_attribute iva on iva.item_id = i.id and iva.attribute_id = a.id
                                 where ivo.item_id = k.id), '[]'::json)) order by k.code)
                       from item k where k.parent_item_id = i.id), '[]'::json) as variants
      from item i
      join item_group g on g.id = i.item_group_id
      left join item_group pg on pg.id = g.parent_id
     where i.company_id = ${user.companyId} and i.is_active and i.parent_item_id is null
       and (i.is_stocked or exists (select 1 from item k where k.parent_item_id = i.id))
     order by i.name`;
  return rows as unknown as ReorderChoice[];
}

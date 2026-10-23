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

"use server";

import { requirePermission, can } from "./auth";
import { sql } from "./db";
import { seenLocations } from "./branch-scope";
import { serialDetail } from "./phone";

/**
 * Everything the IMEI drawer shows for one unit, read in one call when the
 * drawer opens: the unit, what it cost and where each part of that came from,
 * what its variant sells at, and what has happened to it.
 *
 * Read only. Costs come from the unit's own layer (v_stock_serial.unit_cost,
 * which already carries posted landed costs and bill corrections); the parts
 * shown beside it are the receipt line, the landed-cost allocations to this
 * unit, and whatever is left — nothing is recalculated here.
 */
export async function imeiDrawer(serialId: string) {
  const user = await requirePermission("inventory.view");
  const d = await serialDetail(user.companyId, serialId);
  const seen = await seenLocations();
  if (!d || (seen && !seen.includes((d.unit as any).location_id))) throw new Error("That unit is not one you can see.");
  const u: any = d.unit;
  const seeCost = can(user, "cost.view");

  const [extra] = await sql`
    select i.code as item_code, i.name as item_name, i.parent_item_id, i.identity,
           coalesce(p.name, i.name) as model,
           case when i.photo_updated_at is not null
                  then '/items/' || i.id || '/photo?v=' || to_char(i.photo_updated_at, 'YYYYMMDDHH24MISSMS')
                when p.photo_updated_at is not null
                  then '/items/' || p.id || '/photo?v=' || to_char(p.photo_updated_at, 'YYYYMMDDHH24MISSMS')
           end as photo,
           (select json_agg(json_build_object('a', a.name, 'o', o.name) order by coalesce(iva.sort_order, 0), a.name)
              from item_variant_option ivo
              join variant_option o on o.id = ivo.option_id
              join variant_attribute a on a.id = o.attribute_id
              left join item_variant_attribute iva on iva.item_id = i.parent_item_id and iva.attribute_id = a.id
             where ivo.item_id = i.id) as parts
      from item i left join item p on p.id = i.parent_item_id
     where i.id = ${u.item_id}`;

  // Price levels: what this variant sells at now, Retail first.
  const prices = await sql`
    select pl.id, pl.code, pl.name,
           (select ip.price::float from item_price ip
             where ip.item_id = ${u.item_id} and ip.price_level_id = pl.id and ip.valid_from <= current_date
             order by ip.valid_from desc limit 1) as price
      from price_level pl
     where pl.company_id = ${user.companyId}
     order by (pl.code = 'RETAIL') desc, pl.sort_order, pl.code`;
  const retail = (prices as any[]).find((p) => p.code === "RETAIL" && p.price != null) ?? (prices as any[]).find((p) => p.price != null);

  let cost: null | {
    currency: string; rate: number; fcPrice: number | null; purchase: number | null;
    landed: { type: string; amount: number; docId: string; docNo: string | null; date: string; method: string }[];
    other: number; total: number; receipt: { id: string; no: string | null; date: string | null; type: string; supplier: string | null } | null;
    invoices: { id: string; no: string | null; date: string; amount: number | null }[];
  } = null;

  if (seeCost) {
    const [line] = await sql`
      select d.id, d.doc_no, d.doc_type, to_char(d.doc_date, 'YYYY-MM-DD') as doc_date, d.currency,
             d.exchange_rate::float as rate, dl.id as line_id, dl.unit_price::float as unit_price, bp.name as supplier
        from stock_serial s
        join stock_movement m on m.id = s.stock_movement_id
        left join document d on d.id = m.document_id
        left join document_line dl on dl.id = m.document_line_id
        left join business_partner bp on bp.id = d.partner_id
       where s.id = ${serialId}`;
    const landed = await sql`
      select t.name as type, sum(a.amount)::float as amount, ld.id as doc_id, ld.doc_no,
             to_char(ld.doc_date, 'YYYY-MM-DD') as date, ch.method
        from landed_cost_allocation a
        join landed_cost_charge ch on ch.id = a.charge_id and ch.is_active
        join landed_cost_type t on t.id = ch.cost_type_id
        join document ld on ld.id = a.landed_cost_id and ld.status = 'POSTED'
       where a.serial_id = ${serialId}
       group by t.name, ld.id, ld.doc_no, ld.doc_date, ch.method
       order by ld.doc_date, t.name`;
    // The supplier's bill for this receipt: received against it, or billed from it.
    const invoices = line?.id ? await sql`
      select distinct pi.id, pi.doc_no, to_char(pi.doc_date, 'YYYY-MM-DD') as date,
             (select pl.unit_price::float from document_line pl
               where pl.document_id = pi.id and pl.item_id = ${u.item_id} limit 1) as amount
        from document pi
       where pi.doc_type = 'PURCHASE_INVOICE' and pi.status = 'POSTED' and pi.company_id = ${user.companyId}
         and (pi.id = (select source_document_id from document where id = ${line.id})
              or pi.source_document_id = ${line.id}
              or exists (select 1 from document_line pl where pl.document_id = pi.id and pl.source_line_id = ${line.line_id}))` : [];
    const purchase = line?.unit_price ?? null;
    const landedSum = (landed as any[]).reduce((s, l) => s + Number(l.amount), 0);
    const total = Number(u.unit_cost ?? 0);
    const rate = Number(line?.rate ?? 1) || 1;
    cost = {
      currency: line?.currency ?? "MMK", rate,
      fcPrice: purchase != null ? purchase / rate : null, purchase,
      landed: (landed as any[]).map((l) => ({ type: l.type, amount: Number(l.amount), docId: l.doc_id, docNo: l.doc_no, date: l.date, method: l.method })),
      // A bill that disagreed with its receipt, or anything else posted onto the layer.
      other: purchase != null ? Math.round((total - purchase - landedSum) * 100) / 100 : 0,
      total,
      receipt: line?.id ? { id: line.id, no: line.doc_no, date: line.doc_date, type: line.doc_type, supplier: line.supplier } : null,
      invoices: (invoices as any[]).map((i) => ({ id: i.id, no: i.doc_no, date: i.date, amount: i.amount })),
    };
  }

  // What happened, oldest first: the unit's own events, then each price change of its variant.
  const priceRows = await sql`
    select pl.name as level, ip.price::float as price, to_char(ip.valid_from, 'YYYY-MM-DD') as date
      from item_price ip join price_level pl on pl.id = ip.price_level_id
     where ip.item_id = ${u.item_id}
     order by pl.name, ip.valid_from`;
  const priceEvents: { at: string; kind: string; title: string; detail: string }[] = [];
  let lastLevel = "", last: number | null = null;
  for (const r of priceRows as any[]) {
    if (r.level !== lastLevel) { lastLevel = r.level; last = null; }
    priceEvents.push({ at: r.date, kind: "PRICE", title: `${r.level} price ${last === null ? "set" : "updated"}`,
      detail: last === null ? `${fmt(r.price)} MMK` : `From ${fmt(last)} to ${fmt(r.price)} MMK` });
    last = Number(r.price);
  }
  const activity = [
    ...(d.events as any[]).map((e) => ({
      at: new Date(e.created_at).toISOString(), kind: e.event as string, voided: e.status === "REVERSED",
      docId: e.document_id as string | null, docNo: e.doc_no as string | null,
      detail: [e.partner_name, [e.from_location, e.to_location].filter(Boolean).join(" → "), e.note,
               e.acted_by ? `by ${e.acted_by}` : null].filter(Boolean).join(" · "),
    })),
    ...priceEvents.map((p) => ({ at: p.at, kind: p.kind, voided: false, docId: null, docNo: null, detail: p.detail, title: p.title })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return {
    unit: {
      id: u.serial_id as string, imei: u.imei as string, imei2: u.imei2 as string | null, deviceSerial: u.device_serial as string | null,
      status: u.status as string, holdKind: u.hold_kind as string | null, wasReturned: !!u.was_returned,
      location: u.location_name as string | null, supplier: u.supplier_name as string | null,
      customer: u.customer_name as string | null, outDocId: u.out_document_id as string | null, outDocNo: u.out_doc_no as string | null,
      warrantyExpiry: u.warranty_expiry ? String(u.warranty_expiry).slice(0, 10) : null,
      supplierWarrantyExpiry: u.supplier_warranty_months ? String(u.supplier_warranty_expiry).slice(0, 10) : null,
      brand: u.brand_name as string | null, notes: u.notes as string | null,
      itemCode: extra.item_code as string, itemName: extra.item_name as string, model: extra.model as string,
      parentId: extra.parent_item_id as string | null, itemId: u.item_id as string, identity: extra.identity as string,
      photo: extra.photo as string | null, parts: (extra.parts ?? []) as { a: string; o: string }[],
    },
    unitCost: seeCost ? Number(u.unit_cost ?? 0) : null,
    price: retail?.price ?? null, priceLevel: retail?.name ?? null,
    prices: (prices as any[]).map((p) => ({ id: p.id, code: p.code, name: p.name, price: p.price })),
    cost, activity,
    canEditPrices: can(user, "items.manage"),
    canHold: can(user, "inventory.manage"),
  };
}

export type ImeiDrawerData = Awaited<ReturnType<typeof imeiDrawer>>;

function fmt(n: number) { return Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }); }

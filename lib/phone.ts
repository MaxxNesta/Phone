import { lowStockToday } from "./replenish-data";
import { cache } from "react";
import { sql } from "./db";
import { getBrandsInUse } from "./queries";
import { SHELF_LIMIT } from "./pos-facets";

// Read side of phone retail: what the POS searches, the serial stock views,
// warranty lookup, the phone reports and the dashboard figures. Everything
// here reads posted documents and the views of migration 0117 — nothing is
// stored that a movement could disagree with.
//
// Cost is returned by every query and stripped by the caller when the viewer
// lacks cost.view (see stripCost), so one query serves both audiences and
// the stripping happens on the server.

export function stripCost<T extends Record<string, unknown>>(rows: T[], allowed: boolean): T[] {
  if (allowed) return rows;
  const COST = /cost|margin|profit|value/i;
  return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !COST.test(k))) as T);
}

/** Variant label ("256 GB / Black") per item, in attribute order. */
const VARIANT_LABEL = sql`
  (select string_agg(o.name, ' / ' order by a.sort_order, a.name)
     from item_variant_option ivo
     join variant_option o on o.id = ivo.option_id
     join variant_attribute a on a.id = o.attribute_id
    where ivo.item_id = i.id)`;

/** The option an item has for an attribute whose name matches. */
const optionMatching = (re: string) => sql`
  (select o.name from item_variant_option ivo
     join variant_option o on o.id = ivo.option_id
     join variant_attribute a on a.id = o.attribute_id
    where ivo.item_id = i.id and (a.name ~* ${re} or a.code ~* ${re}) limit 1)`;
const STORAGE_RE = "storage|capacity|rom|memory";
const COLOUR_RE = "colou?r";

// The till's price: the RETAIL level, or where a shop named its levels
// otherwise (S1, S2…) the first one — the same rule the price guard and the
// invoice default use (lib/actions.ts), so the till and the guard agree.
const RETAIL_PRICE = sql`
  (select ip.price from item_price ip
     join price_level pl on pl.id = ip.price_level_id
    where ip.item_id = i.id and ip.valid_from <= fn_shop_today()
      and pl.id = (select l.id from price_level l where l.company_id = i.company_id
                    order by (l.code = 'RETAIL') desc, l.sort_order, l.code limit 1)
    order by ip.valid_from desc limit 1)`;

// ----------------------------------------------------------------- POS ----

export type SellableItem = {
  id: string; code: string; name: string; barcode: string | null;
  model: string; brand: string | null; variant: string | null;
  tracks_serial: boolean; on_hand: number; price: number | null; warranty_months: number | null;
  photo: string | null;
  /** False for a service or charge (Error Fee): no stock, never out. */
  is_stocked: boolean;
  /** Its type — iPhone, Mac, Accessories: the top category. */
  type: string | null;
  /** Its own category, which a quantity discount band can be scoped to. */
  item_group_id: string | null;
  /** Its options by attribute name — { Storage: "256 GB", Colour: "Black" }. */
  opts: Record<string, string> | null;
  /** Part numbers, as typed and normalised (0213), for the till's search. */
  parts: string[] | null;
  /** Its stock unit and the packs it sells in (a can, a foot). Empty for a phone. */
  base_uom_id: string; uom_code: string;
  packs: { uomId: string; code: string; factor: number; price: number | null; barcode: string | null; whole: boolean }[];
  /** The stock unit takes whole numbers only. */
  whole: boolean;
};

export type ScannedUnit = {
  serial_id: string; imei: string; imei2: string | null; item_id: string; item_name: string;
  status: string; location_id: string; location_name: string; unit_cost: number;
};

/**
 * What the till finds for whatever was typed or scanned: the exact unit when
 * it is an IMEI or maker's serial, and the products when it is a barcode,
 * a code, a model or a brand.
 */
export async function posSearch(companyId: string, locationId: string, q: string) {
  const term = q.trim();
  if (!term) return { units: [] as ScannedUnit[], items: await sellable(companyId, locationId, null) };

  const units = await sql<ScannedUnit[]>`
    select serial_id, imei, imei2, item_id, item_name, status, location_id,
           location_name, unit_cost::float
      from v_stock_serial
     where company_id = ${companyId}
       and (imei = ${term} or imei2 = ${term} or device_serial = ${term})`;
  return { units, items: await sellable(companyId, locationId, term) };
}

async function sellable(companyId: string, locationId: string, term: string | null) {
  const like = term ? `%${term}%` : null;
  return sql<SellableItem[]>`
    select i.id, i.code, i.name, i.barcode, coalesce(p.name, i.name) as model, i.item_group_id,
           b.name as brand, ${VARIANT_LABEL} as variant, i.tracks_serial, i.is_stocked,
           fn_qty_on_hand(${companyId}, i.id, ${locationId})::float as on_hand,
           ${RETAIL_PRICE}::float as price, i.warranty_months,
           (select t.name from item_group g join item_group t on t.id = coalesce(g.parent_id, g.id)
             where g.id = i.item_group_id) as type,
           (select json_object_agg(a.name, o.name order by a.sort_order)
              from item_variant_option ivo
              join variant_option o on o.id = ivo.option_id
              join variant_attribute a on a.id = o.attribute_id
             where ivo.item_id = i.id) as opts,
           (select array_agg(x) from item_part_number pn, unnest(array[pn.part_no, lower(pn.norm)]) x
             where pn.item_id = i.id) as parts,
           i.base_uom_id, (select u.code from uom u where u.id = i.base_uom_id) as uom_code,
           coalesce((select json_agg(json_build_object('uomId', iu.uom_id, 'code', pu.code, 'factor', iu.factor::float,
                                                      'price', iu.sale_price::float, 'barcode', iu.barcode, 'whole', pu.whole_numbers)
                                     order by iu.standard, iu.factor desc)
                       from v_item_pack iu join uom pu on pu.id = iu.uom_id where iu.item_id = i.id), '[]'::json) as packs,
           (select bu.whole_numbers from uom bu where bu.id = i.base_uom_id) as whole,
           case when i.photo_updated_at is not null
                  then '/items/' || i.id || '/photo?v=' || to_char(i.photo_updated_at, 'YYYYMMDDHH24MISSMS')
                when p.photo_updated_at is not null
                  then '/items/' || p.id || '/photo?v=' || to_char(p.photo_updated_at, 'YYYYMMDDHH24MISSMS')
           end as photo
      from item i
      left join item p on p.id = i.parent_item_id
      left join brand b on b.id = coalesce(p.brand_id, i.brand_id)
     -- Services (not stocked) are sold here too: an Error Fee has no shelf.
     where i.company_id = ${companyId} and i.is_active
       -- A product with variants is a heading, not something on a shelf.
       and not exists (select 1 from item c where c.parent_item_id = i.id)
       and (${like}::text is null
            or i.barcode = ${term}
            or exists (select 1 from item_uom pb where pb.item_id = i.id and pb.barcode = ${term})
            or i.code ilike ${like} or i.name ilike ${like}
            or p.name ilike ${like} or b.name ilike ${like}
            or exists (select 1 from item_part_number pn where pn.item_id = i.id
                          and length(regexp_replace(${term}::text, '[^A-Za-z0-9]', '', 'g')) >= 3
                          and pn.norm like '%' || upper(regexp_replace(${term}::text, '[^A-Za-z0-9]', '', 'g')) || '%'))
     order by (i.barcode = ${term}) desc nulls last,
              (not i.is_stocked or fn_qty_on_hand(${companyId}, i.id, ${locationId}) > 0) desc,
              coalesce(p.name, i.name), i.name
     limit ${term ? SEARCH_LIMIT : SHELF_LIMIT}`;
}

/** A typed search is narrower than the shelf, and stays short. */
const SEARCH_LIMIT = 120;

/** The units of one variant on the shelf here — what the cashier picks from. */
export async function unitsOnShelf(companyId: string, itemId: string, locationId: string) {
  return sql<ScannedUnit[]>`
    select serial_id, imei, imei2, item_id, item_name, status, location_id,
           location_name, unit_cost::float
      from v_stock_serial
     where company_id = ${companyId} and item_id = ${itemId}
       and location_id = ${locationId} and status = 'IN_STOCK'
     order by received_date, imei`;
}

// ---------------------------------------------------------- phone stock ----

export type PhoneStockFilter = {
  q?: string; locationId?: string; brand?: string; model?: string;
  storage?: string; colour?: string; status?: string; supplierId?: string;
  /** New stock, or secondhand (bought back or traded in, 0209). */
  condition?: "NEW" | "USED";
  /** The locations the reader may see (seenLocations); null for every one. */
  locs?: string[] | null;
};

/**
 * One page of units, paged in SQL: `total` is how many match the filters,
 * whatever the page. Size 0 returns every match (capped), for callers that
 * still need the list whole.
 */
export async function phoneStock(companyId: string, f: PhoneStockFilter & { page?: number; size?: number } = {}) {
  const like = f.q ? `%${f.q.trim()}%` : null;
  const size = f.size ?? 0;
  const offset = size > 0 ? (Math.max(1, f.page ?? 1) - 1) * size : 0;
  const rows = await sql`
    select v.serial_id, v.imei, v.imei2, v.device_serial, v.item_id, v.item_name, v.model_name,
           i.code as item_code, count(*) over ()::int as total_count,
           case when i.photo_updated_at is not null
                  then '/items/' || i.id || '/photo?v=' || to_char(i.photo_updated_at, 'YYYYMMDDHH24MISSMS')
                when p.photo_updated_at is not null
                  then '/items/' || p.id || '/photo?v=' || to_char(p.photo_updated_at, 'YYYYMMDDHH24MISSMS')
           end as photo,
           v.brand_name, ${optionMatching(STORAGE_RE)} as storage, ${optionMatching(COLOUR_RE)} as colour,
           v.location_id, v.location_name, br.name as branch_name,
           v.unit_cost::float as unit_cost, ${RETAIL_PRICE}::float as price,
           -- In stock but in a quarantine bin (0218): defective, held apart, not for sale.
           case when v.status = 'IN_STOCK' and loc.is_quarantine then 'QUARANTINE' when v.status = 'IN_STOCK' and loc.is_transit then 'OUT_FOR_DELIVERY' else v.status end as status, v.received_date, (fn_shop_today() - v.received_date) as age_days,
           v.supplier_name, v.customer_name, v.out_doc_no, v.out_date, v.warranty_expiry,
           v.was_returned, v.was_transferred, v.secondhand_grade
      from v_stock_serial v
      join item i on i.id = v.item_id
      left join item p on p.id = i.parent_item_id
      left join location loc on loc.id = v.location_id
      left join location br on br.id = coalesce(loc.parent_id, loc.id)
     where v.company_id = ${companyId}
       and (${like}::text is null or v.imei ilike ${like} or v.imei2 ilike ${like} or i.code ilike ${like}
            or v.device_serial ilike ${like} or v.item_name ilike ${like} or v.model_name ilike ${like})
       and (${f.locationId ?? null}::uuid is null or v.location_id = ${f.locationId ?? null}
            or loc.parent_id = ${f.locationId ?? null})
       ${f.locs ? sql`and v.location_id = any(${f.locs})` : sql``}
       and (${f.brand ?? null}::text is null or v.brand_name = ${f.brand ?? null})
       and (${f.model ?? null}::text is null or v.model_name = ${f.model ?? null})
       and (${f.storage ?? null}::text is null or ${optionMatching(STORAGE_RE)} = ${f.storage ?? null})
       and (${f.colour ?? null}::text is null or ${optionMatching(COLOUR_RE)} = ${f.colour ?? null})
       and (${f.status ?? null}::text is null or case when v.status = 'IN_STOCK' and loc.is_quarantine then 'QUARANTINE' when v.status = 'IN_STOCK' and loc.is_transit then 'OUT_FOR_DELIVERY' else v.status end = ${f.status ?? null})
       and (${f.supplierId ?? null}::uuid is null or v.supplier_id = ${f.supplierId ?? null})
       and (${f.condition ?? null}::text is null or (${f.condition ?? null} = 'USED') = (v.secondhand_grade is not null))
     order by case when v.status = 'IN_STOCK' and loc.is_quarantine then 'QUARANTINE' when v.status = 'IN_STOCK' and loc.is_transit then 'OUT_FOR_DELIVERY' else v.status end = 'IN_STOCK' desc, v.model_name, v.item_name, v.received_date, v.imei
     limit ${size > 0 ? size : 500} offset ${offset}`;
  return Object.assign(rows, { total: rows.length ? Number((rows[0] as any).total_count) : 0 });
}

/**
 * The phone-stock filters and KPI tiles, from one statement. v_stock_serial
 * derives each unit's status row by row, and the filters and the tiles used
 * to ask it five separate times — five scans and five connections for one
 * page. Here it is read once (the CTE is materialised because it is used more
 * than once) and every list is aggregated from that single read. Each list
 * keeps the order and the null handling of the query it replaced.
 * Once per request, so phoneStockFacets and serialKpis share it.
 */
const phoneStockOverview = cache(async (companyId: string) => {
  const [r] = await sql`
    with v as materialized (
      -- Defective units in a quarantine bin (0218) are their own status here:
      -- not "in stock" for selling, still stock for value.
      select v.brand_name, v.model_name, v.supplier_id, v.supplier_name,
             case when v.status = 'IN_STOCK' and loc.is_quarantine then 'QUARANTINE' when v.status = 'IN_STOCK' and loc.is_transit then 'OUT_FOR_DELIVERY' else v.status end as status,
             v.received_date, v.out_date, v.unit_cost, v.secondhand_grade is not null as used
        from v_stock_serial v left join location loc on loc.id = v.location_id
       where v.company_id = ${companyId}
    ), opt as (
      select ${optionMatching(STORAGE_RE)} as storage, ${optionMatching(COLOUR_RE)} as colour
        from item i where i.company_id = ${companyId} and i.tracks_serial
    )
    select
      coalesce((select array_agg(x order by x) from (select distinct brand_name as x from v where brand_name is not null) s), '{}') as brands,
      coalesce((select array_agg(x order by x) from (select distinct model_name as x from v) s), '{}') as models,
      coalesce((select array_agg(x order by x) from (select distinct storage as x from opt where storage is not null) s), '{}') as storages,
      coalesce((select array_agg(x order by x) from (select distinct colour as x from opt where colour is not null) s), '{}') as colours,
      coalesce((select json_agg(json_build_object('id', id, 'name', name) order by name)
                  from (select distinct supplier_id as id, supplier_name as name from v where supplier_id is not null) s), '[]') as suppliers,
      coalesce((select json_agg(json_build_object('id', id, 'name', name, 'parent_id', parent_id,
                                                  'is_stock_location', is_stock_location) order by code)
                  from location where company_id = ${companyId} and is_active), '[]') as locations,
      (select count(*) filter (where status = 'IN_STOCK') from v)::int as available,
      (select count(*) filter (where status = 'IN_STOCK' and received_date > fn_shop_today() - 7) from v)::int as received_week,
      (select count(*) from v)::int as total,
      (select count(*) filter (where status = 'SOLD') from v)::int as sold,
      (select count(*) filter (where status = 'RESERVED') from v)::int as reserved,
      (select count(*) filter (where status = 'REPAIR') from v)::int as repair,
      (select count(*) filter (where status = 'QUARANTINE') from v)::int as quarantine,
      (select count(*) filter (where status = 'SOLD' and out_date >= date_trunc('month', fn_shop_today())) from v)::int as sold_month,
      (select count(*) filter (where status = 'SOLD' and out_date >= date_trunc('month', fn_shop_today()) - interval '1 month'
                                 and out_date < date_trunc('month', fn_shop_today())) from v)::int as sold_last_month,
      (select coalesce(sum(unit_cost) filter (where status in ('IN_STOCK', 'RESERVED', 'REPAIR', 'QUARANTINE', 'OUT_FOR_DELIVERY')), 0) from v)::float as value,
      (select count(*) filter (where status = 'IN_STOCK' and used) from v)::int as available_used,
      (select coalesce(sum(unit_cost) filter (where status in ('IN_STOCK', 'RESERVED', 'REPAIR', 'QUARANTINE', 'OUT_FOR_DELIVERY') and used), 0) from v)::float as value_used`;
  return r;
});

/** The choices the phone-stock filters offer, from what is actually held. */
export async function phoneStockFacets(companyId: string) {
  const r = await phoneStockOverview(companyId);
  return { brands: r.brands as string[], models: r.models as string[], storages: r.storages as string[],
           colours: r.colours as string[], suppliers: r.suppliers as any[], locations: r.locations as any[] };
}

/** Everything that happened to one unit, newest last. */
export async function serialDetail(companyId: string, serialId: string) {
  const [unit] = await sql`
    select v.*, ${optionMatching(STORAGE_RE)} as storage, ${optionMatching(COLOUR_RE)} as colour,
           (select l.is_quarantine from location l where l.id = v.location_id) as in_quarantine,
           (select l.is_transit from location l where l.id = v.location_id) as in_transit,
           (v.received_date + make_interval(months => coalesce(v.supplier_warranty_months, 0)))::date
             as supplier_warranty_expiry
      from v_stock_serial v join item i on i.id = v.item_id
     where v.company_id = ${companyId} and v.serial_id = ${serialId}`;
  if (!unit) return null;
  // Defective, held in a quarantine bin: its own status, as on the list (0218).
  if (unit.status === "IN_STOCK" && unit.in_quarantine) unit.status = "QUARANTINE";
  if (unit.status === "IN_STOCK" && unit.in_transit) unit.status = "OUT_FOR_DELIVERY";
  const events = await sql`
    select e.event, e.created_at, e.note, d.id as document_id, d.doc_no, d.doc_type, d.status,
           d.partner_id, bp.name as partner_name,
           fl.name as from_location, tl.name as to_location, u.name as acted_by
      from stock_serial_event e
      left join document d on d.id = e.document_id
      left join business_partner bp on bp.id = d.partner_id
      left join location fl on fl.id = e.from_location_id
      left join location tl on tl.id = e.to_location_id
      left join app_user u on u.id = e.acted_by
     where e.serial_id = ${serialId}
     order by e.created_at, e.id`;
  const holds = await sql`
    select kind, note, created_at, released_at from stock_serial_hold
     where serial_id = ${serialId} order by created_at`;
  return { unit, events, holds };
}

/** Every handset a document touched: received, sold, returned or moved by it. */
export async function serialsOnDocument(documentId: string) {
  // The handsets a document is about, and which of its lines each belongs
  // to (line_id), so a page can list each line's own IMEIs under it.
  //
  // Stock often moves on a different document from the one a person looks
  // at: an invoice billed from a delivery, a bill matched to a receipt, a
  // delivery made later for an invoice, a counter sale's own delivery. So
  // the handsets are read from this document and from the ones its lines
  // are tied to either way (a line that names one of these lines, or a line
  // one of these names), plus any composed for it. Each unit is placed on
  // the line that moved it if that line is this document's; otherwise on
  // this document's line it answers, by those same ties. Null where nothing
  // ties it, and the caller falls back to the item.
  return sql`
    with mine as (
      select id, source_line_id from document_line where document_id = ${documentId}::uuid
    ),
    composed as (
      select id from document where lifecycle_owner_id = ${documentId}::uuid
    ),
    -- A document composed for this one (a bill's own receipt, a counter
    -- sale's delivery) is made from these lines in order and names none of
    -- them: its n-th line of an item answers this one's n-th line of it.
    composed_map as (
      select c.id as composed_line, m.id as my_line
        from (select dl.id, dl.item_id, row_number() over (partition by dl.document_id, dl.item_id order by dl.line_no) rn
                from document_line dl where dl.document_id in (select id from composed)) c
        join (select id, item_id, row_number() over (partition by item_id order by line_no) rn
                from document_line where document_id = ${documentId}::uuid) m
          on m.item_id = c.item_id and m.rn = c.rn
    ),
    related as (
      select ${documentId}::uuid as id
      union select id from composed
      union select dl.document_id from document_line dl where dl.source_line_id in (select id from mine)
      union select dl.document_id from document_line dl where dl.id in (select source_line_id from mine)
    ),
    moved as (
      select distinct on (s.id) s.id as serial_id, s.serial_no as imei, s.imei2, s.device_serial, i.code as item_code,
             i.identity, s.item_id, e.event, e.document_id,
             -- The line that moved it: a receipt's through the layer its line
             -- made, an issue's through the movement that took it.
             (select sm.document_line_id from stock_movement sm
               where sm.document_id = e.document_id
                 and sm.id = coalesce(
                       (select si.stock_movement_id from stock_serial_issue si
                          join stock_movement m on m.id = si.stock_movement_id
                         where si.serial_id = s.id and m.document_id = e.document_id
                         limit 1),
                       (select l.stock_movement_id from stock_lot l where l.id = e.lot_id))
               limit 1) as moved_on
        from stock_serial_event e
        join stock_serial s on s.id = e.serial_id
        join item i on i.id = s.item_id
       where e.document_id in (select id from related)
       order by s.id, (e.document_id = ${documentId}::uuid) desc, e.created_at
    )
    , placed as (
      select m.*,
             coalesce(
               (select id from mine where id = m.moved_on),
               (select dl.source_line_id from document_line dl
                 where dl.id = m.moved_on and dl.source_line_id in (select id from mine)),
               (select id from mine where source_line_id = m.moved_on limit 1),
               (select my_line from composed_map where composed_line = m.moved_on)) as line_id
        from moved m
    )
    -- A unit read off a document this one is only tied to (the receipt a
    -- return names, say) belongs here only if it ties to one of these lines:
    -- the receipt's other units are not this return's.
    --
    -- A document that moved handsets itself (a return, a write-off, a
    -- delivery) lists only those: a write-off of one phone against a receipt
    -- line of five is about that one, not the five the line received.
    select serial_id, imei, imei2, device_serial, item_code, identity, item_id, event, line_id
      from placed
     where (line_id is not null
        or document_id = ${documentId}::uuid
        or document_id in (select id from composed))
       and (document_id = ${documentId}::uuid
        or document_id in (select id from composed)
        or not exists (select 1 from stock_serial_event own where own.document_id = ${documentId}::uuid))`;
}

/**
 * A document's handsets grouped under its lines (serialsOnDocument): each
 * unit on the line it is tied to, else on the first line of its item; any
 * whose item is not on the lines at all are returned apart.
 */
export function serialsByLine<T extends { line_id: string | null; item_id: string }>(
  serials: T[], lines: { id: string; item_id: string | null }[],
): { byLine: Map<string, T[]>; leftover: T[] } {
  const ids = new Set(lines.map((l) => String(l.id)));
  const byLine = new Map<string, T[]>();
  const leftover: T[] = [];
  for (const sr of serials) {
    const own = sr.line_id && ids.has(String(sr.line_id)) ? String(sr.line_id)
      : lines.find((l) => l.item_id === sr.item_id)?.id;
    if (!own) { leftover.push(sr); continue; }
    byLine.set(String(own), [...(byLine.get(String(own)) ?? []), sr]);
  }
  return { byLine, leftover };
}

/** IMEI, maker's serial, invoice number or customer name. */
export async function warrantyLookup(companyId: string, q: string, locs: string[] | null = null) {
  const term = q.trim();
  if (!term) return [];
  const like = `%${term}%`;
  return sql`
    select v.serial_id, v.imei, v.imei2, v.device_serial, v.item_name, v.model_name, v.brand_name,
           v.status, v.customer_name, v.out_doc_no, v.out_document_id, v.out_date,
           v.warranty_months, v.warranty_expiry,
           case when v.warranty_expiry is null then null
                when v.warranty_expiry < fn_shop_today() then 'EXPIRED'
                when v.warranty_expiry < fn_shop_today() + 30 then 'ENDING'
                else 'ACTIVE' end as warranty_state,
           v.supplier_name, v.received_date, v.supplier_warranty_months
      from v_stock_serial v
     where v.company_id = ${companyId}
       ${locs ? sql`and v.location_id = any(${locs})` : sql``}
       and (v.imei = ${term} or v.imei2 = ${term} or v.device_serial = ${term}
            or v.out_doc_no ilike ${like} or v.customer_name ilike ${like})
     order by v.out_date desc nulls last
     limit 100`;
}

/** Sold units whose customer warranty ends within `days`. */
export async function warrantiesEnding(companyId: string, days = 30, locs: string[] | null = null) {
  return sql`
    select serial_id, imei, item_name, customer_name, out_doc_no, out_document_id, warranty_expiry
      from v_stock_serial
     where company_id = ${companyId} and status = 'SOLD'
       ${locs ? sql`and location_id = any(${locs})` : sql``}
       and warranty_expiry between fn_shop_today() and fn_shop_today() + ${days}::int
     order by warranty_expiry
     limit 200`;
}

// -------------------------------------------------------------- reports ----

export const SALES_DIMENSIONS = {
  model: "Model", brand: "Brand", variant: "Variant", storage: "Storage", colour: "Colour",
  imei: "IMEI", salesperson: "Salesperson", customer: "Customer", branch: "Branch", day: "Day",
} as const;
export type SalesDimension = keyof typeof SALES_DIMENSIONS;

/**
 * Sales and margin from posted documents: revenue is what invoice lines
 * earned (net of discount, before tax), cost of sales is what their claims
 * carried — the same cost the invoice posted. Customer returns subtract at
 * the price and cost they came back at. Voided invoices drop out because
 * they are REVERSED; their reversal carries no lines.
 */
export async function phoneSales(companyId: string, from: string, to: string,
                                 by: SalesDimension, phonesOnly: boolean,
                                 locs: string[] | null = null) {
  const key = {
    model: sql`coalesce(p.name, i.name)`,
    brand: sql`coalesce(b.name, '—')`,
    variant: sql`i.name`,
    storage: sql`coalesce(${optionMatching(STORAGE_RE)}, '—')`,
    colour: sql`coalesce(${optionMatching(COLOUR_RE)}, '—')`,
    imei: sql`coalesce(u.serial_no, '(not serialized)')`,
    salesperson: sql`coalesce(sm.name, '—')`,
    customer: sql`bp.name`,
    branch: sql`coalesce(br.name, loc.name)`,
    day: sql`to_char(u.posting_date, 'YYYY-MM-DD')`,
  }[by];

  return sql`
    with lines as (
      -- Sales: one row per unit for named units, one per line otherwise.
      select d.id as doc_id, d.posting_date, d.partner_id, d.salesman_id, d.location_id,
             dl.item_id, s.serial_no,
             case when s.id is null then dl.base_qty else 1 end as qty,
             case when s.id is null then coalesce(dl.revenue_amount, dl.net_amount)
                  else coalesce(dl.revenue_amount, dl.net_amount) / nullif(dl.base_qty, 0) end as revenue,
             case when s.id is null
                  then coalesce((select sum(a.qty * a.unit_cost) from sales_cost_allocation a
                                  where a.invoice_line_id = dl.id), 0)
                  else coalesce(c.unit_cost, 0) end as cost
        from document d
        join document_line dl on dl.document_id = d.id
        left join stock_movement sm on sm.document_line_id = dl.id and sm.qty < 0
        left join stock_serial_issue si on si.stock_movement_id = sm.id
        left join stock_serial s on s.id = si.serial_id
        left join stock_lot_consumption c on c.id = si.consumption_id
       where d.company_id = ${companyId} and d.doc_type = 'SALES_INVOICE' and d.status = 'POSTED'
         ${locs ? sql`and d.location_id = any(${locs})` : sql``}
         and d.posting_date between ${from}::date and ${to}::date
         and dl.foc_reason_id is null
      union all
      -- Customer returns, negative, at the price and cost they came back at.
      select d.id, d.posting_date, d.partner_id, src.salesman_id, d.location_id,
             dl.item_id, null, -dl.base_qty, -dl.net_amount,
             -coalesce((select sum(m.total_cost) from stock_movement m
                         where m.document_line_id = dl.id), 0)
        from document d
        join document_line dl on dl.document_id = d.id
        left join document src on src.id = d.source_document_id
       where d.company_id = ${companyId} and d.doc_type = 'SALES_RETURN' and d.status = 'POSTED'
         ${locs ? sql`and d.location_id = any(${locs})` : sql``}
         and d.posting_date between ${from}::date and ${to}::date
    )
    select ${key} as key,
           sum(u.qty)::float as units,
           round(sum(u.revenue), 2)::float as revenue,
           round(sum(u.cost), 2)::float as cost,
           round(sum(u.revenue) - sum(u.cost), 2)::float as gross_profit,
           case when sum(u.revenue) <> 0
                then round(100 * (sum(u.revenue) - sum(u.cost)) / sum(u.revenue), 1)::float end as margin_pct
      from lines u
      join item i on i.id = u.item_id
      left join item p on p.id = i.parent_item_id
      left join brand b on b.id = coalesce(p.brand_id, i.brand_id)
      left join business_partner bp on bp.id = u.partner_id
      left join salesman sm on sm.id = u.salesman_id
      left join location loc on loc.id = u.location_id
      left join location br on br.id = loc.parent_id
     where (${!phonesOnly} or i.tracks_serial)
     group by 1
     order by revenue desc nulls last`;
}

/** Phones held, by model and branch, with age and how fast each model sells. */
export async function phoneStockSummary(companyId: string, locs: string[] | null = null) {
  return sql`
    with held as (
      select v.model_name, v.brand_name, coalesce(br.name, loc.name) as branch,
             count(*)::int as units, sum(v.unit_cost)::float as value,
             round(avg(fn_shop_today() - v.received_date))::int as avg_age,
             max(fn_shop_today() - v.received_date)::int as oldest,
             count(*) filter (where fn_shop_today() - v.received_date <= 30)::int as d0_30,
             count(*) filter (where fn_shop_today() - v.received_date between 31 and 60)::int as d31_60,
             count(*) filter (where fn_shop_today() - v.received_date between 61 and 90)::int as d61_90,
             count(*) filter (where fn_shop_today() - v.received_date > 90)::int as d90
        from v_stock_serial v
        left join location loc on loc.id = v.location_id
        left join location br on br.id = loc.parent_id
       where v.company_id = ${companyId} and v.status = 'IN_STOCK'
         ${locs ? sql`and v.location_id = any(${locs})` : sql``}
       group by 1, 2, 3
    ),
    sold as (
      select model_name, count(*) filter (where out_date > fn_shop_today() - 30)::int as sold_30,
             count(*) filter (where out_date > fn_shop_today() - 90)::int as sold_90
        from v_stock_serial
       where company_id = ${companyId} and status = 'SOLD'
         ${locs ? sql`and location_id = any(${locs})` : sql``}
       group by 1
    )
    select h.*, coalesce(s.sold_30, 0) as sold_30, coalesce(s.sold_90, 0) as sold_90
      from held h left join sold s on s.model_name = h.model_name
     order by h.model_name, h.branch`;
}

// ------------------------------------------------------------ dashboard ----

export async function retailDashboard(companyId: string, locs: string[] | null = null, serials = true) {
  // Someone who sees only their own branch gets its figures only (seenLocations).
  // col is one of three fixed column names, never input.
  const at = (col: "location_id" | "d.location_id" | "s.location_id") =>
    locs ? sql`and ${sql.unsafe(col)} = any(${locs})` : sql``; // nosemgrep: sql-unsafe-dynamic
  const range = (from: ReturnType<typeof sql>, to: ReturnType<typeof sql> = sql`fn_shop_today()`) =>
    saleRows(companyId, from, to, locs);
  // What "sold" counts: phones where IMEI is on, every unit where it is off.
  const sold = serials ? sql`r.phones` : sql`r.units`;
  const [[today], [yesterday], [month], [stock], [ar], [aged], low, week, topModels, aging, recent, ending, bad] =
    await Promise.all([
      sql`select coalesce(sum(r.revenue), 0)::float as revenue, coalesce(sum(r.cost), 0)::float as cost,
                 coalesce(sum(${sold}), 0)::int as phones from (${range(sql`fn_shop_today()`)}) r`,
      sql`select coalesce(sum(r.revenue), 0)::float as revenue, coalesce(sum(${sold}), 0)::int as phones
            from (${range(sql`fn_shop_today() - 1`, sql`fn_shop_today() - 1`)}) r`,
      sql`select coalesce(sum(r.revenue), 0)::float as revenue, coalesce(sum(r.cost), 0)::float as cost
            from (${range(sql`date_trunc('month', fn_shop_today())::date`)}) r`,
      sql`select coalesce(sum(value_on_hand), 0)::float as value from v_stock_on_hand
           where company_id = ${companyId} ${at("location_id")}`,
      sql`select coalesce(sum(outstanding), 0)::float as owed, count(distinct partner_id)::int as customers
            from v_open_item where company_id = ${companyId} and doc_type = 'SALES_INVOICE'
             and outstanding > 0.005
             ${locs ? sql`and document_id in (select id from document where location_id = any(${locs}))` : sql``}`,
      // Aged stock: phones by unit where IMEI is on; otherwise the quantity
      // still sitting in FIFO lots received over 90 days ago (any product).
      serials
        ? sql`select count(*)::int as n from v_stock_serial
               where company_id = ${companyId} and status = 'IN_STOCK' and received_date < fn_shop_today() - 90
                 ${at("location_id")}`
        : sql`select coalesce(sum(qty_remaining), 0)::int as n from v_stock_lot_open
               where company_id = ${companyId} and qty_remaining > 0
                 and (received_date at time zone 'Asia/Yangon')::date < fn_shop_today() - 90
                 ${at("location_id")}`,
      // At or under the reorder point: the Stock page's list, worst first.
      lowStockToday(companyId).then((r) => r.rows.slice(0, 5)),
      sql`select to_char(d, 'YYYY-MM-DD') as day, to_char(d, 'Dy') as label,
                 coalesce((select sum(r.revenue) from (${range(sql`fn_shop_today() - 6`)}) r
                            where r.posting_date = d), 0)::float as revenue
            from generate_series(fn_shop_today() - 6, fn_shop_today(), interval '1 day') d order by d`,
      sql`select coalesce(p.name, i.name) as model, sum(${sold})::int as sold, sum(r.revenue)::float as revenue
            from (${range(sql`fn_shop_today() - 30`)}) r
            join item i on i.id = r.item_id left join item p on p.id = i.parent_item_id
           where (i.tracks_serial or not ${serials}) group by 1 having sum(${sold}) > 0 order by 2 desc, 3 desc limit 5`,
      sql`select case when fn_shop_today() - received_date <= 30 then '0–30 days'
                      when fn_shop_today() - received_date <= 60 then '31–60 days'
                      when fn_shop_today() - received_date <= 90 then '61–90 days'
                      else 'Over 90 days' end as label, count(*)::int as value
            from v_stock_serial where company_id = ${companyId} and status = 'IN_STOCK' ${at("location_id")}
           group by 1 order by min(fn_shop_today() - received_date)`,
      sql`select d.id, d.doc_no, d.gross_total::float as total, bp.code as partner_code, bp.name as customer,
                 (select i.name from document_line dl join item i on i.id = dl.item_id
                   where dl.document_id = d.id order by dl.net_amount desc limit 1) as item,
                 coalesce(o.outstanding, 0)::float as outstanding
            from document d
            join business_partner bp on bp.id = d.partner_id
            left join v_open_item o on o.document_id = d.id
           where d.company_id = ${companyId} and d.doc_type = 'SALES_INVOICE' and d.status = 'POSTED'
             -- A void's reversal is bookkeeping, not a sale.
             and d.reverses_document_id is null ${at("d.location_id")}
           order by d.posted_at desc limit 5`,
      sql`select count(*)::int as n from v_stock_serial
           where company_id = ${companyId} and status = 'SOLD'
             and warranty_expiry between fn_shop_today() and fn_shop_today() + 30 ${at("location_id")}`,
      // A serial and the stock it belongs to disagreeing is a bug, not a
      // business event; it is shown so somebody notices.
      sql`select i.name, q.on_hand::float, coalesce(s.n, 0)::int as serials
            from item i
            cross join lateral (select sum(fn_qty_on_hand(${companyId}, i.id, l.id)) as on_hand
                                  from location l where l.company_id = ${companyId} and l.is_stock_location) q
            left join (select item_id, count(*) n from v_stock_serial
                        where company_id = ${companyId} and status in ('IN_STOCK', 'RESERVED', 'REPAIR')
                        group by 1) s on s.item_id = i.id
           where i.company_id = ${companyId} and i.tracks_serial and coalesce(q.on_hand, 0) <> coalesce(s.n, 0)`,
    ]);
  return { today, yesterday, month, stock, ar, aged: aged.n as number, low, week, topModels, aging,
           recent, ending: ending[0]?.n ?? 0, bad };
}

/** Posted retail sale lines in a window: revenue, the cost they carried, phones sold. */
function saleRows(companyId: string, from: ReturnType<typeof sql>, to: ReturnType<typeof sql>,
                  locs: string[] | null = null) {
  return sql`
    select d.posting_date, dl.item_id, coalesce(dl.revenue_amount, dl.net_amount) as revenue,
           coalesce((select sum(a.qty * a.unit_cost) from sales_cost_allocation a
                      where a.invoice_line_id = dl.id), 0) as cost,
           case when i.tracks_serial then dl.base_qty else 0 end as phones,
           dl.base_qty as units
      from document d
      join document_line dl on dl.document_id = d.id
      join item i on i.id = dl.item_id
     where d.company_id = ${companyId} and d.doc_type = 'SALES_INVOICE' and d.status = 'POSTED'
       and d.posting_date between ${from} and ${to}
       ${locs ? sql`and d.location_id = any(${locs})` : sql``}`;
}

/** The IMEI page's tiles: units by status, sales this month, value on hand. */
export async function serialKpis(companyId: string) {
  const r = await phoneStockOverview(companyId);
  return { available: r.available as number, received_week: r.received_week as number,
           total: r.total as number, sold: r.sold as number,
           reserved: r.reserved as number, repair: r.repair as number, quarantine: r.quarantine as number, sold_month: r.sold_month as number,
           sold_last_month: r.sold_last_month as number, value: r.value as number,
           // New and secondhand on the shelf, counted and valued apart (0211).
           available_used: r.available_used as number, value_used: r.value_used as number };
}

/**
 * Stock per product variant across locations, for Inventory → Summary.
 * Reserved is the held handsets (reserve and repair); available is what can
 * be sold today. Low means at or under its reorder point — the calculated
 * one the Stock page lists (lib/replenish-data lowStockToday).
 */
export async function inventorySummary(companyId: string, f: {
  q?: string; groupId?: string; locationId?: string; status?: string;
  /** The model (parent product) — every storage and colour of it. */
  modelId?: string;
  /** Variant options the item must have, one per attribute: 256 GB, Black. */
  optionIds?: string[];
  brandId?: string;
  /** The locations the reader may see (seenLocations); null for every one. */
  locs?: string[] | null;
  /**
   * One row per physical configuration: variants kept under two codes for
   * the same thing (42MM / Black and 42 / Black) are added up once, under
   * the lower code. Each unit of stock sits on exactly one item, so the sum
   * never counts a unit twice.
   */
  combine?: boolean;
}) {
  const like = f.q ? `%${f.q.trim()}%` : null;
  const opts = f.optionIds ?? [];
  const locs = f.locs ?? null;
  const locations = await sql`
    select id, name from location where company_id = ${companyId} and is_stock_location and is_active
     and (${f.locationId ?? null}::uuid is null or id = ${f.locationId ?? null})
     ${locs ? sql`and id = any(${locs})` : sql``} order by code`;
  const rows = await sql`
    with qty as (
      select item_id, location_id, qty_on_hand::float as qty, value_on_hand::float as value, is_quarantine
        from v_stock_on_hand where company_id = ${companyId}
         and (${f.locationId ?? null}::uuid is null or location_id = ${f.locationId ?? null})
         ${locs ? sql`and location_id = any(${locs})` : sql``}
    ),
    per as (
      -- Defective units in a quarantine bin (0218): stock, not available.
      select item_id, sum(qty) as qty, sum(value) as value,
             coalesce(sum(qty) filter (where is_quarantine), 0) as quarantine,
             jsonb_object_agg(location_id, qty) as by_loc
        from qty group by item_id
    )
    select i.id, i.code, i.name, coalesce(p.id, i.id) as model_id, coalesce(p.name, i.name) as model, ${VARIANT_LABEL} as variant,
           vp.canonical_item_id, coalesce(vp.members, 1)::int as members,
           g.name as category, coalesce(gp.name, g.name) as top_category, b.name as brand, i.tracks_serial, i.identity,
           coalesce(per.qty, 0) as qty, coalesce(per.value, 0) as value, coalesce(per.quarantine, 0)::float as quarantine, per.by_loc,
           -- company_id first so stock_serial(company_id, item_id) is used per row.
           (select count(*)::int from stock_serial_hold h join stock_serial s on s.id = h.serial_id
             where s.company_id = i.company_id and s.item_id = i.id and h.released_at is null) as reserved,
           case when coalesce(per.qty, 0) > 0 then per.value / per.qty end as avg_cost,
           (select sum(r.min_qty)::float from item_reorder r
             where r.company_id = i.company_id and r.item_id = i.id) as min_qty,
           ${RETAIL_PRICE}::float as price,
           case when i.photo_updated_at is not null
                  then '/items/' || i.id || '/photo?v=' || to_char(i.photo_updated_at, 'YYYYMMDDHH24MISSMS')
                when p.photo_updated_at is not null
                  then '/items/' || p.id || '/photo?v=' || to_char(p.photo_updated_at, 'YYYYMMDDHH24MISSMS')
           end as photo
      from item i
      left join item p on p.id = i.parent_item_id
      left join brand b on b.id = coalesce(p.brand_id, i.brand_id)
      left join item_group g on g.id = i.item_group_id
      left join item_group gp on gp.id = g.parent_id
      left join per on per.item_id = i.id
      left join v_item_physical vp on vp.item_id = i.id
     where i.company_id = ${companyId} and i.is_active and i.is_stocked
       and not exists (select 1 from item c where c.parent_item_id = i.id)
       and (${like}::text is null or i.name ilike ${like} or i.code ilike ${like}
            or p.name ilike ${like} or i.barcode = ${f.q ?? null})
       and (${f.groupId ?? null}::uuid is null or i.item_group_id = ${f.groupId ?? null}
            or g.parent_id = ${f.groupId ?? null})
       and (${f.modelId ?? null}::uuid is null or coalesce(p.id, i.id) = ${f.modelId ?? null})
       and (${f.brandId ?? null}::uuid is null or b.id = ${f.brandId ?? null})
       ${opts.length ? sql`and (select count(*) from item_variant_option v
                                 where v.item_id = i.id and v.option_id in ${sql(opts)}) = ${opts.length}` : sql``}
     -- What is on the shelf first, then the rest of the catalogue.
     order by coalesce(per.qty, 0) > 0 desc, coalesce(p.name, i.name), i.name
     -- ponytail: whole catalogue in one read; paginate in SQL past ~5k variants.
     limit 5000`;
  const merged = f.combine ? combinePhysical(rows as any[]) : (rows as any[]).map((r) => ({ ...r, codes: [r.code] }));
  /* Low is the calculated reorder point — the one rule the Stock page, the
     dashboard and Replenishment use — read once per request (lowStockToday). */
  const { byCode } = await lowStockToday(companyId);
  const withStatus = merged.map((r: any) => {
    const available = Number(r.qty) - Number(r.reserved) - Number(r.quarantine ?? 0);
    const flagged = (r.codes as string[]).filter((c) => byCode.has(c));
    const reorderAt = flagged.length ? flagged.reduce((t, c) => t + (byCode.get(c) ?? 0), 0) : null;
    return { ...r, available, reorder_at: reorderAt,
             status: Number(r.qty) <= 0 ? "OUT" : flagged.length ? "LOW" : "HEALTHY" };
  });
  return {
    locations,
    rows: f.status ? withStatus.filter((r) => r.status === f.status) : withStatus,
  };
}

/**
 * Variant rows added up to their product model: iPhone 18 Pro Max once, not
 * once per storage and colour. A model is low when any variant of it is, out
 * only when all are, so the figure shown is the one that needs acting on.
 */
export function foldToModels(rows: any[]) {
  const at = new Map<string, any>();
  for (const r of rows) {
    const m = at.get(r.model_id);
    if (!m) {
      at.set(r.model_id, { ...r, id: r.model_id, name: r.model, variant: null, codes: [r.code], variants: 1,
        qty: Number(r.qty), value: Number(r.value), reserved: Number(r.reserved), available: Number(r.available),
        min_qty: r.min_qty != null ? Number(r.min_qty) : null });
      continue;
    }
    m.codes.push(r.code); m.variants++;
    m.qty += Number(r.qty); m.value += Number(r.value); m.reserved += Number(r.reserved); m.available += Number(r.available);
    if (r.min_qty != null) m.min_qty = (m.min_qty ?? 0) + Number(r.min_qty);
    m.tracks_serial = m.tracks_serial || r.tracks_serial;
    m.photo = m.photo ?? r.photo;
    // LOW outranks HEALTHY outranks OUT.
    const rank = { OUT: 0, HEALTHY: 1, LOW: 2 } as Record<string, number>;
    if (rank[r.status] > rank[m.status]) m.status = r.status;
  }
  return [...at.values()].map((m) => ({ ...m, avg_cost: m.qty > 0 ? m.value / m.qty : null }));
}

/**
 * Rows of one physical configuration folded into the first of them (the
 * canonical, lowest code): quantities, values, holds and per-warehouse counts
 * added, average cost recomputed from the sums, every code kept.
 */
function combinePhysical(rows: any[]) {
  const out: any[] = [];
  const at = new Map<string, any>();
  for (const r of rows) {
    const key = Number(r.members) > 1 && r.canonical_item_id ? String(r.canonical_item_id) : `self:${r.id}`;
    const into = at.get(key);
    if (!into) {
      const row = { ...r, codes: [r.code], by_loc: { ...(r.by_loc ?? {}) } };
      at.set(key, row);
      out.push(row);
      continue;
    }
    into.codes.push(r.code);
    into.qty = Number(into.qty) + Number(r.qty);
    into.value = Number(into.value) + Number(r.value);
    into.reserved = Number(into.reserved) + Number(r.reserved);
    if (r.min_qty != null) into.min_qty = Number(into.min_qty ?? 0) + Number(r.min_qty);
    for (const [loc, q] of Object.entries(r.by_loc ?? {})) into.by_loc[loc] = Number(into.by_loc[loc] ?? 0) + Number(q);
    // The canonical one names the row, whichever of the pair was read first.
    if (r.id === r.canonical_item_id) Object.assign(into, { id: r.id, name: r.name, variant: r.variant, photo: r.photo ?? into.photo, price: r.price });
  }
  for (const r of out) {
    r.codes.sort();
    r.avg_cost = Number(r.qty) > 0 ? Number(r.value) / Number(r.qty) : null;
  }
  return out;
}

export type CatalogFacets = {
  /** Brands in use; one or none means the brand filter is not shown. */
  brands: { id: string; name: string }[];
  models: { id: string; name: string }[];
  attributes: { id: string; name: string; options: { id: string; name: string }[] }[];
};

/**
 * What a category's products can be told apart by: its models, and the
 * attributes its variants actually use (an iPhone has storage and SIM, a
 * Mac a chip) with the options in use. Nothing until a category is chosen.
 */
export async function catalogFacets(companyId: string, groupId?: string, brandId?: string): Promise<CatalogFacets> {
  const brands = (await getBrandsInUse(companyId)).map((b) => ({ id: b.id, name: b.name }));
  if (!groupId) return { brands, models: [], attributes: [] };
  const inGroup = sql`(i.item_group_id = ${groupId} or g.parent_id = ${groupId})`;
  const ofBrand = brandId && brands.some((b) => b.id === brandId)
    ? sql`and coalesce(p.brand_id, i.brand_id) = ${brandId}` : sql``;
  const [models, opts] = await Promise.all([
    sql<{ id: string; name: string }[]>`
      select distinct coalesce(p.id, i.id) as id, coalesce(p.name, i.name) as name
        from item i
        left join item p on p.id = i.parent_item_id
        join item_group g on g.id = i.item_group_id
       where i.company_id = ${companyId} and i.is_active and i.is_stocked and ${inGroup} ${ofBrand}
         and not exists (select 1 from item c where c.parent_item_id = i.id)
       order by 2`,
    sql<{ attr_id: string; attr: string; id: string; name: string }[]>`
      select a.id as attr_id, a.name as attr, o.id, o.name
        from item i
        join item_group g on g.id = i.item_group_id
        join item_variant_option ivo on ivo.item_id = i.id
        join variant_option o on o.id = ivo.option_id
        join variant_attribute a on a.id = o.attribute_id
       where i.company_id = ${companyId} and i.is_active and ${inGroup}
       group by a.id, a.name, a.sort_order, o.id, o.name, o.sort_order
       order by a.sort_order, a.name, o.sort_order, o.name`,
  ]);
  const attributes: CatalogFacets["attributes"] = [];
  for (const r of opts) {
    let a = attributes.find((x) => x.id === r.attr_id);
    if (!a) attributes.push(a = { id: r.attr_id, name: r.attr, options: [] });
    a.options.push({ id: r.id, name: r.name });
  }
  return { brands, models: [...models], attributes };
}

/** The last stock movements, newest first, for the summary page. */
export async function recentMovements(companyId: string, limit = 8, locs: string[] | null = null) {
  return sql`
    select sm.id, sm.created_at, sm.qty::float, i.name as item, d.doc_type, d.doc_no, d.id as document_id,
           l.name as location, d.memo, u.name as user_name,
           (select l2.name from stock_movement o join location l2 on l2.id = o.location_id
             where o.document_id = sm.document_id and o.document_line_id = sm.document_line_id
               and o.id <> sm.id limit 1) as other_location
      from stock_movement sm
      join item i on i.id = sm.item_id
      join location l on l.id = sm.location_id
      left join document d on d.id = sm.document_id
      left join app_user u on u.id = coalesce(d.posted_by_id, d.created_by_id)
     where sm.company_id = ${companyId} and sm.qty <> 0 and sm.kind is null
       -- A transfer is two movements; show the leg that left. Someone who sees
       -- one branch sees the leg at their branch, arriving or leaving.
       ${locs ? sql`and sm.location_id = any(${locs})` : sql`and not (d.doc_type = 'STOCK_TRANSFER' and sm.qty > 0)`}
     order by sm.created_at desc limit ${limit}`;
}

/**
 * One phone's journey for anyone who can see the document it was on: what it
 * is, where it came from, where it went. Physical facts only — no cost,
 * margin or purchase amount; those stay in the inventory module's panel,
 * behind its own permission. Landed-cost events are bookkeeping on its cost,
 * not movements of the phone, so they are left out too.
 */
export async function serialJourney(companyId: string, serialId: string) {
  const [unit] = await sql`
    select v.serial_id, v.item_id, v.imei, v.imei2, v.device_serial, v.was_returned, v.hold_kind,
           -- Defective, held in a quarantine bin: its own status, as on the list (0218).
           case when v.status = 'IN_STOCK' and (select l.is_quarantine from location l where l.id = v.location_id)
                then 'QUARANTINE'
                when v.status = 'IN_STOCK' and (select l.is_transit from location l where l.id = v.location_id)
                then 'OUT_FOR_DELIVERY' else v.status end as status,
           v.item_name, v.model_name, v.brand_name, v.location_id, v.location_name, v.notes,
           v.supplier_id, v.supplier_name, v.received_document_id, v.received_on, v.received_date,
           v.supplier_warranty_months,
           (v.received_date + make_interval(months => coalesce(v.supplier_warranty_months, 0)))::date as supplier_warranty_expiry,
           v.out_document_id, v.out_doc_no, v.out_date, v.customer_id, v.customer_name,
           v.warranty_months, v.warranty_expiry,
           (select json_agg(o.name order by a.sort_order)
              from item_variant_option ivo
              join variant_option o on o.id = ivo.option_id
              join variant_attribute a on a.id = o.attribute_id
             where ivo.item_id = i.id) as options,
           case when i.photo_updated_at is not null
                  then '/items/' || i.id || '/photo?v=' || to_char(i.photo_updated_at, 'YYYYMMDDHH24MISSMS')
                when p.photo_updated_at is not null
                  then '/items/' || p.id || '/photo?v=' || to_char(p.photo_updated_at, 'YYYYMMDDHH24MISSMS')
           end as photo,
           -- The bill behind the receipt: the one it came in with, the one it was received against, or one billing its lines.
           (select json_build_object('id', b.id, 'no', b.doc_no) from document b, document gr
             where gr.id = v.received_document_id and b.doc_type = 'PURCHASE_INVOICE' and b.status = 'POSTED'
               and (b.id = gr.lifecycle_owner_id or b.id = gr.source_document_id
                    or exists (select 1 from document_line bl join document_line gl on gl.id = bl.source_line_id
                                where bl.document_id = b.id and gl.document_id = gr.id))
             order by b.doc_date limit 1) as bill,
           -- The sales invoice: the document that took it out, or the invoice that delivery belongs to.
           (select json_build_object('id', s.id, 'no', s.doc_no) from document o, document s
             where o.id = v.out_document_id and s.doc_type = 'SALES_INVOICE'
               and (s.id = o.id or s.id = o.lifecycle_owner_id or s.id = o.source_document_id)
             limit 1) as invoice
      from v_stock_serial v
      join item i on i.id = v.item_id
      left join item p on p.id = i.parent_item_id
     where v.company_id = ${companyId} and v.serial_id = ${serialId}`;
  if (!unit) return null;
  const events = await sql`
    select e.event, e.created_at, e.note, d.id as document_id, d.doc_no, d.doc_type, d.status,
           to_char(coalesce(d.doc_date, e.created_at::date), 'YYYY-MM-DD') as doc_date,
           d.partner_id, bp.name as partner_name,
           fl.name as from_location, tl.name as to_location, u.name as acted_by
      from stock_serial_event e
      left join document d on d.id = e.document_id
      left join business_partner bp on bp.id = d.partner_id
      left join location fl on fl.id = e.from_location_id
      left join location tl on tl.id = e.to_location_id
      left join app_user u on u.id = e.acted_by
     where e.serial_id = ${serialId} and e.event not in ('LANDED_COST', 'COST_LAYER_SPLIT')
     order by e.created_at, e.id`;
  const holds = await sql`
    select kind, note, created_at, released_at from stock_serial_hold
     where serial_id = ${serialId} order by created_at`;
  return { unit, events, holds };
}

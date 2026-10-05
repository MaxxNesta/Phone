import { sql } from "./db";

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

const RETAIL_PRICE = sql`
  (select ip.price from item_price ip
     join price_level pl on pl.id = ip.price_level_id
    where ip.item_id = i.id and pl.code = 'RETAIL' and ip.valid_from <= current_date
    order by ip.valid_from desc limit 1)`;

// ----------------------------------------------------------------- POS ----

export type SellableItem = {
  id: string; code: string; name: string; barcode: string | null;
  model: string; brand: string | null; variant: string | null;
  tracks_serial: boolean; on_hand: number; price: number | null; warranty_months: number | null;
  photo: string | null;
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
    select i.id, i.code, i.name, i.barcode, coalesce(p.name, i.name) as model,
           b.name as brand, ${VARIANT_LABEL} as variant, i.tracks_serial,
           fn_qty_on_hand(${companyId}, i.id, ${locationId})::float as on_hand,
           ${RETAIL_PRICE}::float as price, i.warranty_months,
           case when i.photo_updated_at is not null
                  then '/items/' || i.id || '/photo?v=' || to_char(i.photo_updated_at, 'YYYYMMDDHH24MISSMS')
                when p.photo_updated_at is not null
                  then '/items/' || p.id || '/photo?v=' || to_char(p.photo_updated_at, 'YYYYMMDDHH24MISSMS')
           end as photo
      from item i
      left join item p on p.id = i.parent_item_id
      left join brand b on b.id = coalesce(p.brand_id, i.brand_id)
     where i.company_id = ${companyId} and i.is_active and i.is_stocked
       -- A product with variants is a heading, not something on a shelf.
       and not exists (select 1 from item c where c.parent_item_id = i.id)
       and (${like}::text is null
            or i.barcode = ${term}
            or i.code ilike ${like} or i.name ilike ${like}
            or p.name ilike ${like} or b.name ilike ${like})
     order by (i.barcode = ${term}) desc nulls last,
              fn_qty_on_hand(${companyId}, i.id, ${locationId}) > 0 desc,
              coalesce(p.name, i.name), i.name
     limit 60`;
}

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
};

export async function phoneStock(companyId: string, f: PhoneStockFilter) {
  const like = f.q ? `%${f.q.trim()}%` : null;
  return sql`
    select v.serial_id, v.imei, v.imei2, v.device_serial, v.item_id, v.item_name, v.model_name,
           v.brand_name, ${optionMatching(STORAGE_RE)} as storage, ${optionMatching(COLOUR_RE)} as colour,
           v.location_id, v.location_name, br.name as branch_name,
           v.unit_cost::float as unit_cost, ${RETAIL_PRICE}::float as price,
           v.status, v.received_date, (current_date - v.received_date) as age_days,
           v.supplier_name, v.customer_name, v.out_doc_no, v.out_date, v.warranty_expiry,
           v.was_returned, v.was_transferred
      from v_stock_serial v
      join item i on i.id = v.item_id
      left join location loc on loc.id = v.location_id
      left join location br on br.id = coalesce(loc.parent_id, loc.id)
     where v.company_id = ${companyId}
       and (${like}::text is null or v.imei ilike ${like} or v.imei2 ilike ${like}
            or v.device_serial ilike ${like} or v.item_name ilike ${like} or v.model_name ilike ${like})
       and (${f.locationId ?? null}::uuid is null or v.location_id = ${f.locationId ?? null}
            or loc.parent_id = ${f.locationId ?? null})
       and (${f.brand ?? null}::text is null or v.brand_name = ${f.brand ?? null})
       and (${f.model ?? null}::text is null or v.model_name = ${f.model ?? null})
       and (${f.storage ?? null}::text is null or ${optionMatching(STORAGE_RE)} = ${f.storage ?? null})
       and (${f.colour ?? null}::text is null or ${optionMatching(COLOUR_RE)} = ${f.colour ?? null})
       and (${f.status ?? null}::text is null or v.status = ${f.status ?? null})
       and (${f.supplierId ?? null}::uuid is null or v.supplier_id = ${f.supplierId ?? null})
     order by v.status = 'IN_STOCK' desc, v.model_name, v.item_name, v.received_date
     limit 500`;
}

/** The choices the phone-stock filters offer, from what is actually held. */
export async function phoneStockFacets(companyId: string) {
  const [brands, models, storages, colours, suppliers, locations] = await Promise.all([
    sql`select distinct brand_name as v from v_stock_serial where company_id = ${companyId} and brand_name is not null order by 1`,
    sql`select distinct model_name as v from v_stock_serial where company_id = ${companyId} order by 1`,
    sql`select distinct ${optionMatching(STORAGE_RE)} as v from item i
         where i.company_id = ${companyId} and i.tracks_serial and ${optionMatching(STORAGE_RE)} is not null order by 1`,
    sql`select distinct ${optionMatching(COLOUR_RE)} as v from item i
         where i.company_id = ${companyId} and i.tracks_serial and ${optionMatching(COLOUR_RE)} is not null order by 1`,
    sql`select distinct supplier_id as id, supplier_name as name from v_stock_serial
         where company_id = ${companyId} and supplier_id is not null order by 2`,
    sql`select id, name, parent_id, is_stock_location from location
         where company_id = ${companyId} and is_active order by code`,
  ]);
  const vals = (rows: any[]) => rows.map((r) => r.v as string);
  return { brands: vals(brands), models: vals(models), storages: vals(storages),
           colours: vals(colours), suppliers, locations };
}

/** Everything that happened to one unit, newest last. */
export async function serialDetail(companyId: string, serialId: string) {
  const [unit] = await sql`
    select v.*, ${optionMatching(STORAGE_RE)} as storage, ${optionMatching(COLOUR_RE)} as colour,
           (v.received_date + make_interval(months => coalesce(v.supplier_warranty_months, 0)))::date
             as supplier_warranty_expiry
      from v_stock_serial v join item i on i.id = v.item_id
     where v.company_id = ${companyId} and v.serial_id = ${serialId}`;
  if (!unit) return null;
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

/** IMEI, maker's serial, invoice number or customer name. */
export async function warrantyLookup(companyId: string, q: string) {
  const term = q.trim();
  if (!term) return [];
  const like = `%${term}%`;
  return sql`
    select v.serial_id, v.imei, v.imei2, v.device_serial, v.item_name, v.model_name, v.brand_name,
           v.status, v.customer_name, v.out_doc_no, v.out_document_id, v.out_date,
           v.warranty_months, v.warranty_expiry,
           case when v.warranty_expiry is null then null
                when v.warranty_expiry < current_date then 'EXPIRED'
                when v.warranty_expiry < current_date + 30 then 'ENDING'
                else 'ACTIVE' end as warranty_state,
           v.supplier_name, v.received_date, v.supplier_warranty_months
      from v_stock_serial v
     where v.company_id = ${companyId}
       and (v.imei = ${term} or v.imei2 = ${term} or v.device_serial = ${term}
            or v.out_doc_no ilike ${like} or v.customer_name ilike ${like})
     order by v.out_date desc nulls last
     limit 100`;
}

/** Sold units whose customer warranty ends within `days`. */
export async function warrantiesEnding(companyId: string, days = 30) {
  return sql`
    select serial_id, imei, item_name, customer_name, out_doc_no, out_document_id, warranty_expiry
      from v_stock_serial
     where company_id = ${companyId} and status = 'SOLD'
       and warranty_expiry between current_date and current_date + ${days}::int
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
                                 by: SalesDimension, phonesOnly: boolean) {
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
             case when s.id is null then dl.net_amount
                  else dl.net_amount / nullif(dl.base_qty, 0) end as revenue,
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
export async function phoneStockSummary(companyId: string) {
  return sql`
    with held as (
      select v.model_name, v.brand_name, coalesce(br.name, loc.name) as branch,
             count(*)::int as units, sum(v.unit_cost)::float as value,
             round(avg(current_date - v.received_date))::int as avg_age,
             max(current_date - v.received_date)::int as oldest,
             count(*) filter (where current_date - v.received_date <= 30)::int as d0_30,
             count(*) filter (where current_date - v.received_date between 31 and 60)::int as d31_60,
             count(*) filter (where current_date - v.received_date between 61 and 90)::int as d61_90,
             count(*) filter (where current_date - v.received_date > 90)::int as d90
        from v_stock_serial v
        left join location loc on loc.id = v.location_id
        left join location br on br.id = loc.parent_id
       where v.company_id = ${companyId} and v.status = 'IN_STOCK'
       group by 1, 2, 3
    ),
    sold as (
      select model_name, count(*) filter (where out_date > current_date - 30)::int as sold_30,
             count(*) filter (where out_date > current_date - 90)::int as sold_90
        from v_stock_serial
       where company_id = ${companyId} and status = 'SOLD'
       group by 1
    )
    select h.*, coalesce(s.sold_30, 0) as sold_30, coalesce(s.sold_90, 0) as sold_90
      from held h left join sold s on s.model_name = h.model_name
     order by h.model_name, h.branch`;
}

// ------------------------------------------------------------ dashboard ----

export async function retailDashboard(companyId: string) {
  const range = (from: ReturnType<typeof sql>, to: ReturnType<typeof sql> = sql`current_date`) =>
    saleRows(companyId, from, to);
  const [[today], [yesterday], [month], [stock], [ar], [aged], low, week, topModels, aging, recent, ending, bad] =
    await Promise.all([
      sql`select coalesce(sum(r.revenue), 0)::float as revenue, coalesce(sum(r.cost), 0)::float as cost,
                 coalesce(sum(r.phones), 0)::int as phones from (${range(sql`current_date`)}) r`,
      sql`select coalesce(sum(r.revenue), 0)::float as revenue, coalesce(sum(r.phones), 0)::int as phones
            from (${range(sql`current_date - 1`, sql`current_date - 1`)}) r`,
      sql`select coalesce(sum(r.revenue), 0)::float as revenue, coalesce(sum(r.cost), 0)::float as cost
            from (${range(sql`date_trunc('month', current_date)::date`)}) r`,
      sql`select coalesce(sum(value_on_hand), 0)::float as value from v_stock_on_hand
           where company_id = ${companyId}`,
      sql`select coalesce(sum(outstanding), 0)::float as owed, count(distinct partner_id)::int as customers
            from v_open_item where company_id = ${companyId} and doc_type = 'SALES_INVOICE'
             and outstanding > 0.005`,
      sql`select count(*)::int as n from v_stock_serial
           where company_id = ${companyId} and status = 'IN_STOCK' and received_date < current_date - 90`,
      // Variants that sell and are nearly out: two or fewer left, sold in 60 days.
      sql`select s.item_name as name, count(*) filter (where s.status = 'IN_STOCK')::int as left_,
                 count(*) filter (where s.status = 'SOLD' and s.out_date > current_date - 60)::int as sold_60
            from v_stock_serial s where s.company_id = ${companyId}
           group by 1
          having count(*) filter (where s.status = 'IN_STOCK') <= 2
             and count(*) filter (where s.status = 'SOLD' and s.out_date > current_date - 60) > 0
           order by 2, 3 desc limit 6`,
      sql`select to_char(d, 'YYYY-MM-DD') as day, to_char(d, 'Dy') as label,
                 coalesce((select sum(r.revenue) from (${range(sql`current_date - 6`)}) r
                            where r.posting_date = d), 0)::float as revenue
            from generate_series(current_date - 6, current_date, interval '1 day') d order by d`,
      sql`select coalesce(p.name, i.name) as model, sum(r.phones)::int as sold, sum(r.revenue)::float as revenue
            from (${range(sql`current_date - 30`)}) r
            join item i on i.id = r.item_id left join item p on p.id = i.parent_item_id
           where i.tracks_serial group by 1 order by 2 desc, 3 desc limit 5`,
      sql`select case when current_date - received_date <= 30 then '0–30 days'
                      when current_date - received_date <= 60 then '31–60 days'
                      when current_date - received_date <= 90 then '61–90 days'
                      else 'Over 90 days' end as label, count(*)::int as value
            from v_stock_serial where company_id = ${companyId} and status = 'IN_STOCK'
           group by 1 order by min(current_date - received_date)`,
      sql`select d.id, d.doc_no, d.gross_total::float as total, bp.code as partner_code, bp.name as customer,
                 (select i.name from document_line dl join item i on i.id = dl.item_id
                   where dl.document_id = d.id order by dl.net_amount desc limit 1) as item,
                 coalesce(o.outstanding, 0)::float as outstanding
            from document d
            join business_partner bp on bp.id = d.partner_id
            left join v_open_item o on o.document_id = d.id
           where d.company_id = ${companyId} and d.doc_type = 'SALES_INVOICE' and d.status = 'POSTED'
             -- A void's reversal is bookkeeping, not a sale.
             and d.reverses_document_id is null
           order by d.posted_at desc limit 6`,
      sql`select count(*)::int as n from v_stock_serial
           where company_id = ${companyId} and status = 'SOLD'
             and warranty_expiry between current_date and current_date + 30`,
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
function saleRows(companyId: string, from: ReturnType<typeof sql>, to: ReturnType<typeof sql>) {
  return sql`
    select d.posting_date, dl.item_id, dl.net_amount as revenue,
           coalesce((select sum(a.qty * a.unit_cost) from sales_cost_allocation a
                      where a.invoice_line_id = dl.id), 0) as cost,
           case when i.tracks_serial then dl.base_qty else 0 end as phones
      from document d
      join document_line dl on dl.document_id = d.id
      join item i on i.id = dl.item_id
     where d.company_id = ${companyId} and d.doc_type = 'SALES_INVOICE' and d.status = 'POSTED'
       and d.posting_date between ${from} and ${to}`;
}

/** The four figures over the IMEI / Serial list. */
export async function serialKpis(companyId: string) {
  const [k] = await sql`
    select count(*) filter (where status = 'IN_STOCK')::int as available,
           count(*) filter (where status = 'IN_STOCK' and received_date > current_date - 7)::int as received_week,
           count(*) filter (where status = 'RESERVED')::int as reserved,
           count(*) filter (where status = 'REPAIR')::int as repair,
           count(*) filter (where status = 'SOLD' and out_date >= date_trunc('month', current_date))::int as sold_month,
           count(*) filter (where status = 'SOLD' and out_date >= date_trunc('month', current_date) - interval '1 month'
                              and out_date < date_trunc('month', current_date))::int as sold_last_month,
           coalesce(sum(unit_cost) filter (where status in ('IN_STOCK', 'RESERVED', 'REPAIR')), 0)::float as value
      from v_stock_serial where company_id = ${companyId}`;
  return k;
}

/**
 * Stock per product variant across locations, for Inventory → Summary.
 * Reserved is the held handsets (reserve and repair); available is what can
 * be sold today. Low means at or under the item's reorder minimum, summed
 * over locations, or two or fewer phones of a variant that has sold.
 */
export async function inventorySummary(companyId: string, f: {
  q?: string; groupId?: string; brand?: string; locationId?: string; status?: string;
}) {
  const like = f.q ? `%${f.q.trim()}%` : null;
  const locations = await sql`
    select id, name from location where company_id = ${companyId} and is_stock_location and is_active
     and (${f.locationId ?? null}::uuid is null or id = ${f.locationId ?? null}) order by code`;
  const rows = await sql`
    with qty as (
      select item_id, location_id, qty_on_hand::float as qty, value_on_hand::float as value
        from v_stock_on_hand where company_id = ${companyId}
         and (${f.locationId ?? null}::uuid is null or location_id = ${f.locationId ?? null})
    ),
    per as (
      select item_id, sum(qty) as qty, sum(value) as value,
             jsonb_object_agg(location_id, qty) as by_loc
        from qty group by item_id
    )
    select i.id, i.name, coalesce(p.name, i.name) as model, ${VARIANT_LABEL} as variant,
           g.name as category, b.name as brand, i.tracks_serial,
           coalesce(per.qty, 0) as qty, coalesce(per.value, 0) as value, per.by_loc,
           (select count(*)::int from stock_serial_hold h join stock_serial s on s.id = h.serial_id
             where s.item_id = i.id and h.released_at is null) as reserved,
           case when coalesce(per.qty, 0) > 0 then per.value / per.qty end as avg_cost,
           (select sum(r.min_qty)::float from item_reorder r where r.item_id = i.id) as min_qty,
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
      left join per on per.item_id = i.id
     where i.company_id = ${companyId} and i.is_active and i.is_stocked
       and not exists (select 1 from item c where c.parent_item_id = i.id)
       and (${like}::text is null or i.name ilike ${like} or i.code ilike ${like}
            or p.name ilike ${like} or i.barcode = ${f.q ?? null})
       and (${f.groupId ?? null}::uuid is null or i.item_group_id = ${f.groupId ?? null}
            or g.parent_id = ${f.groupId ?? null})
       and (${f.brand ?? null}::text is null or b.name = ${f.brand ?? null})
     order by coalesce(p.name, i.name), i.name
     limit 300`;
  const withStatus = rows.map((r: any) => {
    const available = Number(r.qty) - Number(r.reserved);
    const low = r.min_qty != null ? Number(r.qty) <= Number(r.min_qty)
      : r.tracks_serial ? Number(r.qty) <= 2 : Number(r.qty) <= 0;
    return { ...r, available, status: Number(r.qty) <= 0 ? "OUT" : low ? "LOW" : "HEALTHY" };
  });
  return {
    locations,
    rows: f.status ? withStatus.filter((r) => r.status === f.status) : withStatus,
  };
}

/** The last stock movements, newest first, for the summary page. */
export async function recentMovements(companyId: string, limit = 8) {
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
     where sm.company_id = ${companyId} and sm.qty <> 0
       -- A transfer is two movements; show the leg that left.
       and not (d.doc_type = 'STOCK_TRANSFER' and sm.qty > 0)
     order by sm.created_at desc limit ${limit}`;
}

/**
 * Gives IMEIs to phones already on a shelf without one: each joins an open
 * layer of that product at that branch with unnamed units, oldest first, and
 * keeps the cost it arrived at. Nothing moves and nothing is posted. Naming
 * turns IMEI tracking on for the product, so a later sale asks which unit.
 */
export async function nameUnits(companyId: string, userId: string | null, itemId: string,
  locationId: string, units: { serial: string; imei2: string | null }[]) {
  const all = units.flatMap((u) => [u.serial, u.imei2].filter((x): x is string => !!x));
  await sql.begin(async (tx) => {
    const [item] = await tx`
      select id, code from item where id = ${itemId} and company_id = ${companyId}`;
    if (!item) throw new Error("That product does not exist");
    // The same lock an issue takes, so a sale cannot draw these layers meanwhile.
    await tx`
      select id from stock_lot
       where company_id = ${companyId} and item_id = ${itemId} and location_id = ${locationId}
       order by received_date, created_at for update`;
    const lots = await tx`
      select l.id, l.stock_movement_id, sm.document_id,
             l.qty_received
               - coalesce((select sum(c.qty) from stock_lot_consumption c where c.lot_id = l.id), 0)
               - (select count(*) from stock_serial s
                   where s.stock_lot_id = l.id
                     and not exists (select 1 from stock_serial_issue si
                                      where si.serial_id = s.id
                                        and coalesce(si.lot_id, s.stock_lot_id) = s.stock_lot_id
                                        and fn_serial_issue_stands(si.stock_movement_id))) as unnamed
        from stock_lot l
        left join stock_movement sm on sm.id = l.stock_movement_id
       where l.company_id = ${companyId} and l.item_id = ${itemId} and l.location_id = ${locationId}
       order by l.received_date, l.created_at`;
    const open = (lots as unknown as { id: string; stock_movement_id: string | null;
      document_id: string | null; unnamed: string }[])
      .map((l) => ({ ...l, unnamed: Math.floor(Number(l.unnamed)) }))
      .filter((l) => l.unnamed > 0 && l.stock_movement_id);
    const free = open.reduce((s, l) => s + l.unnamed, 0);
    if (units.length > free) {
      throw new Error(`${units.length} IMEIs but only ${free} ${item.code} on this shelf without one.`);
    }
    const clash = await tx`
      select serial_no from stock_serial
       where company_id = ${companyId}
         and (serial_no = any(${all}) or imei2 = any(${all}) or device_serial = any(${all}))`;
    if (clash.length) throw new Error(`${clash[0].serial_no} is already recorded against a unit.`);

    await tx`update item set tracks_serial = true where id = ${itemId}`;
    let i = 0;
    for (const lot of open) {
      for (let n = 0; n < lot.unnamed && i < units.length; n++, i++) {
        const u = units[i];
        const [unit] = await tx`
          insert into stock_serial (company_id, item_id, serial_no, stock_lot_id, stock_movement_id, imei2)
          values (${companyId}, ${itemId}, ${u.serial}, ${lot.id}, ${lot.stock_movement_id}, ${u.imei2})
          returning id`;
        await tx`
          insert into stock_serial_event
            (company_id, serial_id, event, document_id, to_location_id, lot_id, note, acted_by)
          values (${companyId}, ${unit.id}, 'RECEIVED', ${lot.document_id}, ${locationId}, ${lot.id},
                  'Named on the shelf', ${userId})`;
      }
    }
  });
}

import { sql } from "./db";
import { inventorySummary, catalogFacets } from "./phone";
import { catalogSelection } from "@/components/catalog-filters";

type Search = Record<string, string | undefined>;

/**
 * The All products list as the filters leave it, with the price at every
 * level: what the page shows a page of, and what Export writes in full.
 */
export async function productList(co: string, sp: Search) {
  const facets = await catalogFacets(co, sp.category || undefined, sp.brand || undefined);
  const [{ rows }, levels, lastBuy, prices, invoiced] = await Promise.all([
    inventorySummary(co, { q: sp.q || undefined, groupId: sp.category || undefined, ...catalogSelection(sp, facets) }),
    sql<{ id: string; name: string }[]>`
      select id, name from price_level where company_id = ${co}
       order by (code = 'RETAIL' and (select retail_mode from company where id = ${co})) desc, sort_order, code`,
    sql`select dl.item_id, max(d.posting_date) as d from document_line dl
          join document d on d.id = dl.document_id
         where d.company_id = ${co} and d.doc_type = 'GOODS_RECEIPT' and d.status = 'POSTED'
         group by dl.item_id`,
    sql`select distinct on (item_id, price_level_id) item_id, price_level_id, price::float as price
          from item_price where company_id = ${co} and valid_from <= current_date
         order by item_id, price_level_id, valid_from desc`,
    // What the supplier last charged, read from the posted invoice (never kept on the item).
    sql`select distinct on (dl.item_id) dl.item_id, dl.unit_price::float as price
          from document_line dl join document d on d.id = dl.document_id
         where d.company_id = ${co} and d.doc_type = 'PURCHASE_INVOICE' and d.status = 'POSTED'
         order by dl.item_id, d.doc_date desc, d.created_at desc, dl.line_no desc`,
  ]);
  const lastPrice = new Map((invoiced as any[]).map((r) => [r.item_id as string, r.price as number]));
  const bought = new Map(lastBuy.map((r: any) => [r.item_id as string, r.d]));
  const priceAt = new Map<string, Record<string, number>>();
  for (const p of prices as any[]) priceAt.set(p.item_id, { ...priceAt.get(p.item_id), [p.price_level_id]: p.price });

  const identity = (r: any) => r.identity ?? (r.tracks_serial ? "IMEI" : "NONE");
  const list = (rows as any[])
    .filter((r) => !sp.tracking || identity(r) === sp.tracking)
    .filter((r) => !sp.status || r.status === sp.status)
    .map((r) => ({ ...r, last_bought: bought.get(r.id) ?? null, last_price: lastPrice.get(r.id) ?? null, levels: priceAt.get(r.id) ?? {} }));
  return { all: rows as any[], list, facets, levels: [...levels] };
}

/** Every column Export can write, SKU first. */
export const EXPORT_COLUMNS = [
  { key: "code", label: "SKU" },
  { key: "product", label: "Product" },
  { key: "variant", label: "Variant" },
  { key: "brand", label: "Brand" },
  { key: "category", label: "Category" },
  { key: "tracking", label: "Tracking" },
  { key: "price", label: "Selling price" },
  { key: "available", label: "Available" },
  { key: "on_hand", label: "On hand" },
  { key: "status", label: "Status" },
  { key: "last_purchase", label: "Last purchase" },
  { key: "last_price", label: "Latest purchase price" },
] as const;

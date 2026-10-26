import { notFound, redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getCompany, getVariantStock, getReservedQty } from "@/lib/queries";
import { requirePermission, can } from "@/lib/auth";
import { stockCost } from "@/lib/stock-detail";
import { variantPhotos } from "@/lib/variants";
import { saveItemEdit } from "@/lib/actions";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ItemEditor, type EditorItem } from "@/components/item-editor";

export async function generateMetadata() { return { title: "Edit item" }; }

const GONE = ["SOLD", "RETURNED_TO_SUPPLIER", "WRITTEN_OFF", "ISSUED"];

/**
 * One item's editor, for a variant and for a product that has none: the same
 * page, with the sibling list only where there are siblings.
 */
export default async function EditItem({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("items.manage");
  const company = await getCompany();
  if (!company) return null;
  const seeCost = can(user, "cost.view");

  const [item] = (await sql`
    select i.id, i.code, i.name, i.name_is_custom, i.barcode, i.is_active, i.is_stocked, i.identity, i.tracks_serial,
           i.parent_item_id, u.code as uom_code, b.name as brand, g.name as category, pg.name as top_category,
           p.name as parent_name, p.code as parent_code,
           to_char(i.photo_updated_at, 'YYYYMMDDHH24MISSMS') as photo_version,
           (select json_agg(json_build_object('a', va.name, 'o', vo.name) order by iva.sort_order)
              from item_variant_option ivo join variant_option vo on vo.id = ivo.option_id
              join variant_attribute va on va.id = vo.attribute_id
              left join item_variant_attribute iva on iva.item_id = i.parent_item_id and iva.attribute_id = va.id
             where ivo.item_id = i.id) as parts
      from item i join uom u on u.id = i.base_uom_id join item_group g on g.id = i.item_group_id
      left join item_group pg on pg.id = g.parent_id left join brand b on b.id = i.brand_id
      left join item p on p.id = i.parent_item_id
     where i.id = ${id} and i.company_id = ${company.id}`) as any[];
  if (!item) notFound();
  // A product that varies is edited through its variants.
  if ((await sql`select 1 from item where parent_item_id = ${id} limit 1`).length) redirect(`/items/${id}/variants`);

  const [levels, prices, stock, purchases, reservedAll, cost, serials, serialCount] = await Promise.all([
    sql`select id, name from price_level where company_id = ${company.id}
         order by (code = 'RETAIL' and (select retail_mode from company where id = ${company.id})) desc, sort_order, code` as unknown as Promise<{ id: string; name: string }[]>,
    sql`select distinct on (price_level_id) price_level_id, price from item_price
         where item_id = ${id} and valid_from <= current_date order by price_level_id, valid_from desc` as unknown as Promise<any[]>,
    sql`select coalesce(sum(qty_on_hand), 0)::float as qty, coalesce(sum(value_on_hand), 0)::float as value
          from v_stock_on_hand where item_id = ${id}` as unknown as Promise<any[]>,
    sql`select d.id, d.doc_no, to_char(d.doc_date, 'DD Mon YYYY') as date, bp.name as supplier,
               sum(dl.base_qty)::float as qty, (sum(dl.net_amount) / nullif(sum(dl.base_qty), 0))::float as unit_cost
          from document_line dl join document d on d.id = dl.document_id
          left join business_partner bp on bp.id = d.partner_id
         where d.company_id = ${company.id} and dl.item_id = ${id} and d.doc_type = 'GOODS_RECEIPT'
           and d.status = 'POSTED' and dl.base_qty > 0
         group by d.id, bp.name order by d.doc_date desc, d.created_at desc limit 5` as unknown as Promise<any[]>,
    getReservedQty(company.id) as unknown as Promise<Array<{ item_id: string; reserved_qty: string }>>,
    seeCost ? stockCost(id) : Promise.resolve(null),
    item.tracks_serial
      ? sql`select serial_id, imei, status, location_name from v_stock_serial
             where company_id = ${company.id} and item_id = ${id} and status <> all(${GONE})
             order by received_date desc nulls last, imei limit 5` as unknown as Promise<any[]>
      : Promise.resolve([]),
    item.tracks_serial
      ? sql`select count(*)::int as n from v_stock_serial
             where company_id = ${company.id} and item_id = ${id} and status <> all(${GONE})` as unknown as Promise<any[]>
      : Promise.resolve([{ n: 0 }]),
  ]);

  // Siblings, with the picture each one shows.
  let siblings: EditorItem["siblings"] = [];
  let photo: string | null = item.photo_version ? `/items/${id}/photo?v=${item.photo_version}` : null;
  if (item.parent_item_id) {
    const vs = (await getVariantStock(company.id)) as unknown as Parameters<typeof variantPhotos>[0];
    const photos = variantPhotos(vs);
    siblings = (vs as any[]).filter((v) => v.parent_item_id === item.parent_item_id)
      .sort((a, b) => String(a.code).localeCompare(String(b.code)))
      .map((v) => ({ id: v.id, code: v.code, name: v.name, qty: Number(v.qty_on_hand),
                     parts: ((v.parts ?? []) as any[]).map((p) => p.option as string), photo: photos.srcFor(v) }));
    photo = siblings.find((s) => s.id === id)?.photo ?? photo;
  }

  const onHand = Number(stock[0]?.qty ?? 0);
  const reserved = reservedAll.filter((r) => r.item_id === id).reduce((s, r) => s + Number(r.reserved_qty), 0);
  const priceBy = new Map(prices.map((p) => [p.price_level_id as string, String(Number(p.price))]));

  const data: EditorItem = {
    id, code: item.code, name: item.name, nameCustom: !!item.name_is_custom, barcode: item.barcode ?? "",
    isActive: item.is_active, isStocked: item.is_stocked, identity: item.identity, tracksSerial: !!item.tracks_serial,
    uom: item.uom_code, brand: item.brand,
    category: item.top_category ? `${item.top_category} / ${item.category}` : item.category,
    parentId: item.parent_item_id, parentName: item.parent_name,
    parts: (item.parts ?? []) as { a: string; o: string }[],
    photo, siblings,
    levels: levels.map((l) => ({ id: l.id, name: l.name, price: priceBy.get(l.id) ?? "" })),
    stock: { onHand, reserved, available: onHand - reserved,
             avgCost: seeCost && onHand > 0 ? Number(stock[0].value) / onHand : null },
    unitCost: cost ? cost.totalUnitCost : null,
    seeCost,
    purchases: purchases.map((p) => ({ id: p.id, no: p.doc_no, date: p.date, supplier: p.supplier, qty: Number(p.qty),
                                        unitCost: seeCost && p.unit_cost != null ? Number(p.unit_cost) : null })),
    serials: serials.map((s) => ({ id: s.serial_id, imei: s.imei, status: s.status, where: s.location_name })),
    serialCount: Number(serialCount[0]?.n ?? 0),
  };

  const trail = item.parent_item_id
    ? [{ label: "Products", href: "/items" }, { label: item.parent_name, href: `/items/${item.parent_item_id}` },
       { label: "Variants", href: `/items/${item.parent_item_id}/variants` }, { label: item.code }]
    : [{ label: "Products", href: "/items" }, { label: item.name, href: `/items/${id}` }, { label: "Edit" }];

  return (
    <div className="ie">
      <Breadcrumbs trail={trail} />
      <ItemEditor item={data} action={saveItemEdit} />
    </div>
  );
}

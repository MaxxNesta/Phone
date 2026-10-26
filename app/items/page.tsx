import Link from "next/link";
import { sql } from "@/lib/db";
import { getCompany, getItems, getBrands, getBrandsInUse } from "@/lib/queries";
import { deactivateItem, activateItem, deleteItem, setVariantPhoto } from "@/lib/actions";
import { ItemRow } from "@/components/item-row";
import { asVariant } from "@/components/variant-tags";
import { DataTable, type DataRow } from "@/components/data-table";
import { ItemFilters } from "@/components/item-filters";
import { HelpHint } from "@/components/help-hint";
import { getTranslations } from "next-intl/server";

type Row = {
  id: string; code: string; name: string; name_my: string | null;
  item_group_id: string; brand_id: string | null; base_uom_id: string;
  group_name: string; group_parent_id: string | null;
  parent_group_id: string | null; parent_group_name: string | null;
  brand_name: string | null; is_stocked: boolean; is_active: boolean;
  uom_code: string; sale_price: string | null;
  photo_version: string | null;
  last_purchase_price: string | null;
  last_purchase_doc_no: string | null;
  last_purchase_date: string | null;
  parent_item_id: string | null;
  variant_count: number;
  variant: unknown;
  barcode: string | null;
  qty_on_hand: string | number | null;
};

export default async function Items({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; sub?: string; brand?: string; status?: string;
                          edit?: string }>;
}) {
  const { category, sub, brand, status, edit } = await searchParams;
  const company = await getCompany();
  const t = await getTranslations("items");
  const c = await getTranslations("common");
  const f = await getTranslations("itemForm");
  if (!company) return <div className="empty">{c("noCompany")}</div>;

  // Brand filter and column only once the catalogue carries two brands.
  const multiBrand = (await getBrandsInUse(company.id)).length > 1;
  const [all, brands, uoms, groups, packs] = await Promise.all([
    getItems(company.id) as unknown as Promise<Row[]>,
    getBrands(company.id) as unknown as Promise<{ id: string; code: string; name: string }[]>,
    sql`select id, code, name from uom where company_id = ${company.id} and is_active order by code` as unknown as Promise<
      { id: string; code: string; name: string }[]
    >,
    sql`select id, name, parent_id from item_group
         where company_id = ${company.id} order by code` as unknown as Promise<
      { id: string; name: string; parent_id: string | null }[]
    >,
    // Every pack size in one query rather than one per item: the list is
    // short, and a hundred round trips to draw a hundred rows is not.
    sql`select iu.item_id, iu.uom_id, iu.factor, u.code as uom_code
          from item_uom iu
          join item i on i.id = iu.item_id
          join uom u on u.id = iu.uom_id
         where i.company_id = ${company.id}
         order by u.code` as unknown as Promise<
      Array<{ item_id: string; uom_id: string; factor: string; uom_code: string }>>,
  ]);

  /**
   * An item is filed against one category — the leaf. "Category" is therefore
   * that leaf's root ancestor where it has one, and the leaf itself where it
   * does not, which is the same rule the table columns display by. Filtering
   * on a category has to catch the items filed against its children too, or
   * picking "Beverages" would return nothing for a company that files
   * everything one level down.
   */
  const parentOf = new Map(groups.map((g) => [g.id, g.parent_id]));
  const rootOf = (groupId: string): string => {
    let id = groupId;
    for (let hops = 0; hops < 20; hops++) {
      const p = parentOf.get(id);
      if (!p) return id;
      id = p;
    }
    return id;
  };

  /**
   * Variants are folded into the product they belong to.
   *
   * A shirt in four sizes and three colours is twelve item rows, and a
   * catalogue that lists all twelve buries everything else. The parent
   * stands for them here and the row expands to show them; the twelve are
   * still ordinary items everywhere it matters — stock, prices, documents,
   * search by barcode.
   *
   * A variant whose parent is filtered out of this view would vanish
   * entirely, so the fold happens before the filters rather than after.
   */
  const variantsByParent = new Map<string, Row[]>();
  for (const i of all) {
    if (!i.parent_item_id) continue;
    const list = variantsByParent.get(i.parent_item_id) ?? [];
    list.push(i);
    variantsByParent.set(i.parent_item_id, list);
  }
  const catalogue = all.filter((i) => !i.parent_item_id);

  // Opened to edit one item: that item alone, not the whole catalogue to hunt through.
  const editing = edit && catalogue.some((i) => i.id === edit) ? edit : null;
  const items = catalogue.filter((i) => (!editing || i.id === editing) &&
    (!category || rootOf(i.item_group_id) === category) &&
    (!sub || i.item_group_id === sub) &&
    (!brand || (brand === "none" ? i.brand_id === null : i.brand_id === brand)) &&
    (!status || (status === "active" ? i.is_active : !i.is_active))
  );

  // The photo column exists only once something has a photo to put in it.
  const anyPhoto = all.some((i) => i.photo_version);
  const categoryName = (i: Row) => i.parent_group_name ?? i.group_name;
  const subName = (i: Row) => (i.parent_group_name ? i.group_name : "");

  const rows: DataRow[] = items.map((i) => ({
    key: i.id,
    // The variants' own codes and barcodes belong here too. Folding them
    // under the parent must not make them unfindable: scanning a barcode for
    // "POLO-M-Red" has to land somewhere, and the row it lands on is the one
    // that opens to show it.
    searchText: [i.code, i.name, i.name_my, i.group_name, i.parent_group_name, i.brand_name, i.uom_code,
                 i.barcode,
                 // Searching "CTN" should find what comes by the carton.
                 ...packs.filter((p) => p.item_id === i.id).map((p) => p.uom_code),
                 ...(variantsByParent.get(i.id) ?? []).flatMap((v) => [v.code, v.name, v.barcode])]
      .filter(Boolean).join(" "),
    sort: {
      code: i.code,
      name: i.name,
      category: categoryName(i),
      subcategory: subName(i),
      brand_name: i.brand_name ?? "",
      uom_code: i.uom_code,
      sale_price: Number(i.sale_price ?? 0),
      last_purchase_price: Number(i.last_purchase_price ?? 0),
      is_active: i.is_active ? 1 : 0,
    },
    // Keyed by column, so hiding a column on screen drops it from the file
    // too. The four keys with no column of their own are export-only, listed
    // in csvExtra below.
    csv: {
      code: i.code,
      name: i.name,
      name_my: i.name_my ?? "",
      category: categoryName(i),
      subcategory: subName(i),
      brand_name: i.brand_name ?? "",
      uom_code: i.uom_code,
      sale_price: i.sale_price ?? "",
      last_purchase_price: i.last_purchase_price ?? "",
      last_purchase_doc_no: i.last_purchase_doc_no ?? "",
      last_purchase_date: i.last_purchase_date ?? "",
      status: i.is_active ? "active" : "inactive",
    },
    node: (
      <ItemRow
        item={{
          ...i,
          packs: packs
            .filter((p) => p.item_id === i.id)
            .map((p) => ({ uomId: p.uom_id, code: p.uom_code, factor: Number(p.factor) })),
        }}
        showBrand={multiBrand}
        showPhoto={anyPhoto}
        deactivateAction={deactivateItem}
        activateAction={activateItem}
        deleteAction={deleteItem}
        setPhotoAction={setVariantPhoto}
        variants={(variantsByParent.get(i.id) ?? []).map((v) => ({
          id: v.id, code: v.code, name: v.name,
          barcode: v.barcode ?? null,
          qty_on_hand: Number(v.qty_on_hand ?? 0),
          is_active: v.is_active,
          photo_version: v.photo_version ?? null,
          variant_parts: asVariant(v.variant),
        }))}
      />
    ),
  }));

  const priced = items.filter((i) => i.last_purchase_price !== null).length;

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">{t("masterData")}</span>
        <h1>{t("title")}</h1>
        <HelpHint>{t("help")}</HelpHint>
      </div>

      <div className="actions">
        <Link href="/items/categories" className="btn ghost">{t("manageCategories")}</Link>
        <Link href="/items/brands" className="btn ghost">{t("manageBrands")}</Link>
        <Link href="/items/units" className="btn ghost">{t("manageUnits")}</Link>
        <Link href="/items/import" className="btn ghost">{t("import")}</Link>
        <Link href="/items/new" className="btn">{t("addItem")}</Link>
      </div>

      {editing && (
        <p className="hint" style={{ margin: "0 0 8px" }}>
          {t("editingOne")} <Link href="/items" className="linkish">{t("showAll")}</Link>
        </p>
      )}
      <ItemFilters
        groups={groups}
        brands={multiBrand ? brands : []}
        selected={{ category: category ?? "", sub: sub ?? "", brand: brand ?? "", status: status ?? "" }}
      />

      <section>
        <div className="card">
          <div className="card-head">
            <h2>{t("catalogue")}</h2>
            <span className="page-sub">
              {items.length === all.length
                ? t("countAll", { n: all.length })
                : t("countSome", { shown: items.length, total: all.length })}
              {" · "}{t("withPrice", { n: priced })}
            </span>
          </div>

          {all.length === 0 ? (
            <div className="empty">
              {t("nothingYet")}{" "}
              <Link href="/items/categories" style={{ color: "var(--link)" }}>{t("addCategory")}</Link>
            </div>
          ) : items.length === 0 ? (
            <div className="empty">
              {t("noFilterMatch")}{" "}
              <Link href="/items" style={{ color: "var(--link)" }}>{t("clearThem")}</Link>
            </div>
          ) : (
            <DataTable
              rows={rows}
              emptyLabel={t("noItems")}
              searchPlaceholder={t("searchItems")}
              initialQuery={edit ? (items.find((i: any) => i.id === edit)?.code ?? "") : undefined}
              defaultSort={{ key: "code", dir: "asc" }}
              csvFilename="items.csv"
              storageKey="items"
              // Never on screen, always in the file: a Burmese name and a
              // status are wanted in a spreadsheet and would only widen a
              // table that already has ten columns.
              csvExtra={[
                { key: "name_my", label: f("nameBurmese") },
                { key: "last_purchase_doc_no", label: t("fromInvoice") },
                { key: "last_purchase_date", label: t("invoiceDate") },
                { key: "status", label: c("status") },
              ]}
              columns={[
                ...(anyPhoto ? [{ key: "photo", label: "" }] : []),
                { key: "code", label: c("code"), sortable: true },
                { key: "name", label: c("name"), sortable: true },
                { key: "category", label: c("category"), sortable: true },
                { key: "subcategory", label: c("subCategory"), sortable: true },
                ...(multiBrand ? [{ key: "brand_name", label: c("brand"), sortable: true }] : []),
                { key: "uom_code", label: c("unit"), sortable: true },
                { key: "sale_price", label: t("sellingPrice"), sortable: true, align: "r" },
                { key: "last_purchase_price", label: t("latestPurchasePrice"), sortable: true, align: "r" },
                { key: "actions", label: "" },
              ]}
            />
          )}

          <div className="card-body" style={{ paddingTop: 0 }}>
            <span className="page-sub">
              <strong>{t("latestPurchasePrice")}</strong> {t("latestPurchaseNote")}
            </span>
          </div>
        </div>
      </section>
    </>
  );
}

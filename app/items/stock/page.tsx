import { BranchScope } from "@/components/branch-scope";
import { seenRows, seenLocations, scopedBranch } from "@/lib/branch-scope";
import Link from "next/link";
import { Boxes, PackageCheck, TrendingDown, AlertTriangle, HandCoins } from "lucide-react";
import { money, qty, shortDate } from "@/lib/db";
import {
  getCompany, getItems, getBrandsInUse, getReservedQty, getIncomingQty, getLowStock, getReorderPoints, getLocations,
  getStockByLocation, getConsignedStockOnHand, getStockBatches, getExpiryBands,
  getVariantStock,
} from "@/lib/queries";
import { createReorderPoint, updateReorderPoint, deleteReorderPoint } from "@/lib/actions";
import { type DataRow } from "@/components/data-table";
import { StockTable } from "@/components/stock-table";
import { StockRow, type StockRowItem } from "@/components/stock-row";
import { asVariant } from "@/components/variant-tags";
import { variantPhotos } from "@/lib/variants";
import { VariantStock, type VariantStockRow } from "@/components/variant-stock";
import { StockMatrix } from "@/components/stock-matrix";
import { ExpiryBands } from "@/components/expiry-bands";
import { AddReorderPointForm } from "@/components/reorder-point-form";
import { ReorderPointRow } from "@/components/reorder-point-row";
import { AccountPicker } from "@/components/account-picker";
import { getTranslations } from "next-intl/server";

type Row = {
  id: string; code: string; name: string; name_my: string | null;
  item_group_id: string; group_name: string; parent_group_name: string | null;
  brand_name: string | null; barcode: string | null;
  uom_code: string; qty_on_hand: string; value_on_hand: string; is_stocked: boolean;
  tracks_batch: boolean; tracks_expiry: boolean;
  last_purchase_price: string | null;
  last_purchase_document_id: string | null;
  last_purchase_doc_no: string | null;
  last_purchase_date: string | null;
  variant: unknown;
  variant_count: number;
  parent_item_id: string | null;
  photo_version: string | null;
};

export default async function Stock({
  searchParams,
}: {
  searchParams: Promise<{ location?: string; zeros?: string; group?: string;
                        view?: string; product?: string }>;
}) {
  const { location, zeros, group, view, product } = await searchParams;
  const t = await getTranslations("inventory");
  const c = await getTranslations("common");
  const showZeros = zeros === "1";
  const company = await getCompany();
  if (!company) return <div className="empty">{c("noCompany")}</div>;

  const [items, reserved, incoming, lowStock, reorderPoints, locations, stockByLocation, consigned,
         batches, expiryBands, variantStock] = await Promise.all([
    getItems(company.id) as unknown as Promise<Row[]>,
    getReservedQty(company.id) as unknown as Promise<Array<{ item_id: string; location_id: string; reserved_qty: string }>>,
    getIncomingQty(company.id) as unknown as Promise<Array<{ item_id: string; location_id: string; incoming_qty: string }>>,
    getLowStock(company.id).then((r) => seenRows(r as unknown as Record<string, unknown>[])) as unknown as Promise<Array<{
      item_id: string; item_code: string; item_name: string;
      location_id: string; location_code: string; qty_on_hand: string; min_qty: string | null;
      reason: "below_reorder" | "out_of_stock";
    }>>,
    getReorderPoints(company.id) as unknown as Promise<Array<{
      id: string; item_id: string; location_id: string; min_qty: string;
      item_code: string; item_name: string; location_code: string;
    }>>,
    getLocations(company.id).then((r) => seenRows(r as unknown as Record<string, unknown>[], "id")) as unknown as Promise<Array<{ id: string; code: string; name: string; is_stock_location: boolean }>>,
    getStockByLocation(company.id).then((r) => seenRows(r as unknown as Record<string, unknown>[])) as unknown as Promise<Array<{
      item_id: string; location_id: string; qty_on_hand: string; value_on_hand: string;
    }>>,
    getConsignedStockOnHand(company.id) as unknown as Promise<Array<{
      item_id: string; location_id: string; on_hand: string; consignor_name: string;
    }>>,
    // Only the items that keep lots return anything here, so this costs
    // nothing on a catalogue that tracks none.
    getStockBatches(company.id).then((r) => seenRows(r as unknown as Record<string, unknown>[])) as unknown as Promise<Array<{
      item_id: string; location_id: string; location_code: string;
      batch_no: string | null; expiry_date: string | null;
      days_left: number | null; qty: string;
    }>>,
    getExpiryBands(company.id) as unknown as Promise<Array<{
      band: string; batches: number; qty: string; value: string;
    }>>,
    getVariantStock(company.id) as unknown as Promise<VariantStockRow[]>,
  ]);

  /**
   * The picture each line shows.
   *
   * For a variant that is its colour's photograph, whichever size it was
   * uploaded against — resolved once here from the same rule the folded
   * view uses, so a row and its group can never show different shirts.
   * For an ordinary item it is simply its own.
   */
  const photos = variantPhotos(variantStock);
  const variantSrc = new Map(variantStock.map((v) => [v.id, photos.srcFor(v)]));
  const photoSrcOf = (i: Row): string | null => {
    const own = variantSrc.get(i.id) ??
      (i.photo_version ? `/items/${i.id}/photo?v=${i.photo_version}` : null);
    if (own) return own;
    // A product has no picture of its own — it is a name for a group. Its
    // line borrows the first of its variants that has one, so the row shows
    // a garment rather than an empty frame.
    for (const k of childrenOf.get(i.id) ?? []) {
      const kid = variantSrc.get(k.id);
      if (kid) return kid;
    }
    return null;
  };

  /**
   * Which of the three ways of reading the same stock is on screen.
   *
   * Offered only once something has variants: a catalogue of tins has
   * nothing to fold and nothing to lay out as a grid, and two tabs that
   * both say "nothing here" are worse than no tabs at all.
   */
  const hasVariants = variantStock.length > 0;
  const mode = hasVariants && (view === "grouped" || view === "matrix") ? view : "list";

  const reorderableLocations = locations.filter((l) => l.is_stock_location);

  const selectedLocationId = location && reorderableLocations.some((l) => l.id === location) ? location : "all";
  const allLocations = selectedLocationId === "all";

  // Company-wide: sum across every row for that item. One warehouse: the
  // single row for that item and location, or 0 if it's never touched it.
  const onHandOf = (itemId: string, companyWide: number) =>
    allLocations
      ? companyWide
      : Number(stockByLocation.find((r) => r.item_id === itemId && r.location_id === selectedLocationId)?.qty_on_hand ?? 0);
  const valueOf = (itemId: string, companyWide: number) =>
    allLocations
      ? companyWide
      : Number(stockByLocation.find((r) => r.item_id === itemId && r.location_id === selectedLocationId)?.value_on_hand ?? 0);
  const reservedOf = (itemId: string) =>
    allLocations
      ? reserved.filter((r) => r.item_id === itemId).reduce((s, r) => s + Number(r.reserved_qty), 0)
      : Number(reserved.find((r) => r.item_id === itemId && r.location_id === selectedLocationId)?.reserved_qty ?? 0);
  const incomingOf = (itemId: string) =>
    allLocations
      ? incoming.filter((r) => r.item_id === itemId).reduce((s, r) => s + Number(r.incoming_qty), 0)
      : Number(incoming.find((r) => r.item_id === itemId && r.location_id === selectedLocationId)?.incoming_qty ?? 0);
  // Every consigned row visible under the current location choice. The KPI
  // counts these rather than the whole company's, or picking a warehouse
  // would leave the tile reading the same number for every warehouse.
  const consignedHere = allLocations
    ? consigned
    : consigned.filter((r) => r.location_id === selectedLocationId);
  const consignedOf = (itemId: string) =>
    consignedHere.filter((r) => r.item_id === itemId).reduce((s, r) => s + Number(r.on_hand), 0);

  // A product with variants is a name for a group and cannot hold stock —
  // fn_document_line_not_parent refuses it on any document line. Left in, it
  // is a row that can never have a number in any column.
  const childrenOf = new Map<string, Row[]>();
  for (const i of items) {
    if (!i.parent_item_id) continue;
    const list = childrenOf.get(i.parent_item_id) ?? [];
    list.push(i);
    childrenOf.set(i.parent_item_id, list);
  }

  /**
   * What gets a line.
   *
   * An ordinary stocked item, or a product that has variants. A variant is
   * not a line of its own here — twelve of them would bury the rest of the
   * catalogue — so it folds under its product and the chevron opens it.
   */
  const listable = items.filter((i) =>
    i.variant_count > 0 || (i.is_stocked && !i.parent_item_id));

  const stocked = listable.map((i) => {
    const kids = childrenOf.get(i.id) ?? [];
    /**
     * A product with variants holds nothing itself — the guard in 0107
     * refuses it on any document line — so its figures are its variants
     * added up. That makes the parent line a summary of the rows beneath
     * it rather than a stock position of its own, and the two can never
     * disagree because one is computed from the other.
     */
    const members: Row[] = kids.length > 0 ? kids : [i];
    const sum = (f: (r: Row) => number) => members.reduce((acc, m) => acc + f(m), 0);
    const onHand = sum((m) => onHandOf(m.id, Number(m.qty_on_hand)));
    const valueOnHand = sum((m) => valueOf(m.id, Number(m.value_on_hand)));
    const reservedQty = sum((m) => reservedOf(m.id));
    const incomingQty = sum((m) => incomingOf(m.id));
    const consignedQty = sum((m) => consignedOf(m.id));
    const available = onHand - reservedQty;
    const projected = available + incomingQty;
    return { ...i, kids, members, onHand, valueOnHand, reservedQty,
             incomingQty, consignedQty, available, projected };
  });
  /**
   * Which items this view is about: the ones with a stock position.
   *
   * Held, reserved, on its way, or standing on consignment — any of those is
   * a position. None of them is one, and a row of zeroes across every column
   * is not an answer to "what is in stock", it is the catalogue restated. The
   * catalogue is a screen of its own.
   *
   * The same rule whichever warehouse is chosen, including all of them. An
   * earlier version kept the zeroes on the company-wide view on the grounds
   * that they feed Low stock — they do not. That tile runs its own query off
   * the reorder points and has its own section on this page, so an item that
   * has run out is reported there, by name, with the point it fell below.
   */
  const visible = showZeros
    ? stocked
    : stocked.filter((i) =>
        i.onHand !== 0 || i.reservedQty !== 0 || i.incomingQty !== 0 || i.consignedQty !== 0);

  const totalValue = visible.reduce((s, i) => s + i.valueOnHand, 0);

  /**
   * How many things are actually in stock, as against how many lines.
   *
   * Since a product folds its variants into one row, counting rows would
   * report a shirt in four sizes as one item in stock. The figure people
   * check against a count is the number of sellable things holding a
   * position, so that is what is counted — the rows are just how they are
   * arranged on screen.
   */
  const holdsPosition = (m: Row) =>
    onHandOf(m.id, Number(m.qty_on_hand)) !== 0 || reservedOf(m.id) !== 0 ||
    incomingOf(m.id) !== 0 || consignedOf(m.id) !== 0;
  const skuCount = visible.reduce((n, i) => n + i.members.filter(holdsPosition).length, 0);
  const foldedAny = visible.some((i) => i.kids.length > 0);

  /** Which consignors an item's held-but-unowned stock belongs to. */
  const consignorsOf = (itemIds: string[]) =>
    Array.from(new Set(
      consignedHere.filter((r) => itemIds.includes(r.item_id)).map((r) => r.consignor_name)
    ));

  /**
   * Where an item actually sits. Only warehouses holding some of it, and only
   * the chosen one when a location is picked — a panel listing every empty
   * warehouse is a longer answer to a shorter question.
   */
  const warehousesOf = (itemIds: string[]) => {
    const here = (locId: string) => allLocations || locId === selectedLocationId;

    /**
     * Every warehouse holding any of this item, owned or not.
     *
     * Consigned stock was missing, so a consignor's goods sitting on the shelf
     * produced "this item has never been held anywhere" — said about twelve
     * units somebody could walk over and touch. It is not the company's stock
     * and never joins On hand, but where it physically is is exactly what this
     * panel is for.
     */
    const ids = new Set<string>();
    for (const r of stockByLocation) {
      if (itemIds.includes(r.item_id) && here(r.location_id) && Number(r.qty_on_hand) !== 0) {
        ids.add(r.location_id);
      }
    }
    for (const cr of consignedHere) {
      if (itemIds.includes(cr.item_id) && here(cr.location_id) && Number(cr.on_hand) !== 0) {
        ids.add(cr.location_id);
      }
    }

    return [...ids]
      .map((locationId) => {
        const loc = locations.find((l) => l.id === locationId);
        return {
          locationId,
          code: loc?.code ?? "—",
          name: loc?.name ?? "",
          onHand: stockByLocation
            .filter((r) => itemIds.includes(r.item_id) && r.location_id === locationId)
            .reduce((sum, r) => sum + Number(r.qty_on_hand), 0),
          consigned: consignedHere
            .filter((cr) => itemIds.includes(cr.item_id) && cr.location_id === locationId)
            .reduce((sum, cr) => sum + Number(cr.on_hand), 0),
          reserved: reserved
            .filter((x) => itemIds.includes(x.item_id) && x.location_id === locationId)
            .reduce((sum, x) => sum + Number(x.reserved_qty), 0),
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));
  };

  // A column nobody can put a number in is a column that costs width for
  // nothing — and thirteen is where this table stops fitting.
  const anyConsigned = stocked.some((i) => i.consignedQty > 0);
  // Brand only once the catalogue carries more than one.
  const multiBrand = (await getBrandsInUse(company.id)).length > 1;
  const STOCK_COLUMNS = (anyConsigned ? 13 : 12) + (multiBrand ? 1 : 0);

  const rows: DataRow[] = visible.map((i) => {
    const ids = i.members.map((m) => m.id);
    const consignors = consignorsOf(ids);
    const category = i.parent_group_name ? `${i.parent_group_name} / ${i.group_name}` : i.group_name;

    const rowItem: StockRowItem = {
      id: i.id,
      code: i.code,
      name: i.name,
      nameMy: i.name_my,
      itemGroupId: i.item_group_id,
      category,
      uomCode: i.uom_code,
      barcode: i.barcode,
      brandName: i.brand_name,
      onHand: i.onHand,
      consignedQty: i.consignedQty,
      reservedQty: i.reservedQty,
      available: i.available,
      incomingQty: i.incomingQty,
      projected: i.projected,
      valueOnHand: i.valueOnHand,
      lastCost: i.last_purchase_price,
      lastCostDocNo: i.last_purchase_doc_no,
      lastCostDocId: i.last_purchase_document_id,
      lastCostDate: i.last_purchase_date ? shortDate(i.last_purchase_date) : null,
      consignors,
      warehouses: warehousesOf(ids),
      variant: asVariant(i.variant),
      photoSrc: photoSrcOf(i),
      // The things on the shelf, folded under the product they belong to.
      variants: i.kids.map((k) => ({
        id: k.id,
        code: k.code,
        name: k.name,
        variant: asVariant(k.variant),
        photoSrc: photoSrcOf(k),
        uomCode: k.uom_code,
        onHand: onHandOf(k.id, Number(k.qty_on_hand)),
        reservedQty: reservedOf(k.id),
        incomingQty: incomingOf(k.id),
        valueOnHand: valueOf(k.id, Number(k.value_on_hand)),
      })),
      tracksBatch: !!i.tracks_batch,
      tracksExpiry: !!i.tracks_batch && !!i.tracks_expiry,
      batches: batches
        .filter((b) => ids.includes(b.item_id))
        .map((b) => ({
          locationCode: b.location_code,
          batchNo: b.batch_no,
          expiryDate: b.expiry_date,
          daysLeft: b.days_left === null ? null : Number(b.days_left),
          qty: Number(b.qty),
        })),
    };

    return {
      key: i.id,
      searchText: [i.code, i.name, i.name_my, i.group_name, i.parent_group_name, i.barcode, i.brand_name,
                   // so searching "red" finds the red one
                   ...(asVariant(i.variant) ?? []).flatMap((v) => [v.a, v.o]),
                   ...consignors].filter(Boolean).join(" "),
      sort: {
        code: i.code,
        name: i.name,
        ownership: consignors.length > 0 ? t("stk.consignmentName", { names: consignors.join(" ") }) : t("stk.companyOwned"),
        group_name: category,
        brand_name: i.brand_name ?? "",
        uom_code: i.uom_code,
        onHand: i.onHand,
        consignedQty: i.consignedQty,
        reservedQty: i.reservedQty,
        available: i.available,
        incomingQty: i.incomingQty,
        projected: i.projected,
        value_on_hand: i.valueOnHand,
        last_cost: Number(i.last_purchase_price ?? 0),
      },
      node: <StockRow item={rowItem} columnCount={STOCK_COLUMNS} showConsigned={anyConsigned} showBrand={multiBrand} />,
    };
  });

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">{t("stk.eyebrow")}</span>
        <h1>{t("stk.title")}</h1>
        <BranchScope />
      </div>

      {/* Both filters on one line: each narrows the same list, and a warehouse
          chosen here must not silently discard the other one. */}
      <div className="filterbar">
        {reorderableLocations.length > 1 && (
          <AccountPicker
            accounts={[{ id: "all", code: "—", name: t("stk.allWarehouses") }, ...reorderableLocations]}
            selectedId={selectedLocationId}
            basePath="/items/stock"
            paramName="location"
            label={c("warehouse")}
            keep={{ zeros: showZeros ? "1" : undefined }}
          />
        )}
        <div className="field">
          <label>{t("stk.itemsLabel")}</label>
          {/* Links rather than a control with state: the page is already
              addressable by its query, and this way the choice survives a
              reload and can be bookmarked like the warehouse beside it. */}
          <div className="scopetabs" style={{ margin: 0 }}>
            <Link scroll={false} className="scopetab" data-active={!showZeros}
                  href={`/items/stock${allLocations ? "" : `?location=${selectedLocationId}`}`}>
              {t("stk.inStock")}
            </Link>
            <Link scroll={false} className="scopetab" data-active={showZeros}
                  href={`/items/stock?${allLocations ? "" : `location=${selectedLocationId}&`}zeros=1`}>
              {t("stk.allItems")}
            </Link>
          </div>
        </div>
        <div className="filterbar-end">
          <AddReorderPointForm
            action={createReorderPoint}
            // A model with its variants: the point is set on the variant, which
            // is what sits on a shelf.
            items={listable.map((i) => ({
              id: i.id, name: i.name, category: i.parent_group_name ?? i.group_name,
              variants: (childrenOf.get(i.id) ?? []).map((k) => ({ id: k.id, parts: asVariant(k.variant) ?? [] })),
            }))}
            locations={reorderableLocations}
            count={reorderPoints.length}
          />
        </div>
      </div>

      {/* Each figure gets its own tinted mark. Five tiles of identical grey
          text is five things to read; a colour and a shape per tile is one
          thing to recognise. */}
      <div className="kpis kpis-tiled">
        <div className="kpi">
          <span className="kpi-icon" style={{
            color: "var(--link)",
            background: "color-mix(in srgb, var(--brand) 12%, transparent)",
          }}>
            <Boxes size={17} aria-hidden="true" />
          </span>
          <span className="kpi-body">
            <span className="kpi-label">{t("stk.stockValue")}</span>
            <span className="kpi-value">{money(totalValue)}</span>
            <span className="kpi-note">{t("stk.itemsInStock", { n: skuCount })}</span>
          </span>
        </div>

        <div className="kpi">
          <span className="kpi-icon" style={{
            color: "var(--warn)",
            background: "color-mix(in srgb, var(--warn) 14%, transparent)",
          }}>
            <AlertTriangle size={17} aria-hidden="true" />
          </span>
          <span className="kpi-body">
            <span className="kpi-label">{t("stk.lowStock")}</span>
            <span className="kpi-value" style={{ color: lowStock.length > 0 ? "var(--bad)" : undefined }}>
              {lowStock.length}
            </span>
            <span className="kpi-note">
              {t("stk.lowPairs", { n: lowStock.length })}
            </span>
          </span>
        </div>

        <div className="kpi">
          <span className="kpi-icon" style={{
            color: "#3B6FD4",
            background: "color-mix(in srgb, #3B6FD4 12%, transparent)",
          }}>
            <PackageCheck size={17} aria-hidden="true" />
          </span>
          <span className="kpi-body">
            <span className="kpi-label">{t("stk.incoming")}</span>
            <span className="kpi-value">{incoming.length}</span>
            <span className="kpi-note">{t("stk.incomingPairs", { n: incoming.length })}</span>
          </span>
        </div>

        <div className="kpi">
          <span className="kpi-icon" style={{
            color: "#C2610A",
            background: "color-mix(in srgb, #C2610A 12%, transparent)",
          }}>
            <TrendingDown size={17} aria-hidden="true" />
          </span>
          <span className="kpi-body">
            <span className="kpi-label">{t("stk.reserved")}</span>
            <span className="kpi-value">{reserved.length}</span>
            <span className="kpi-note">{t("stk.reservedPairs", { n: reserved.length })}</span>
          </span>
        </div>

        <div className="kpi">
          <span className="kpi-icon" style={{
            color: "#6C5CE0",
            background: "color-mix(in srgb, #6C5CE0 12%, transparent)",
          }}>
            <HandCoins size={17} aria-hidden="true" />
          </span>
          <span className="kpi-body">
            <span className="kpi-label">{t("stk.consigned")}</span>
            <span className="kpi-value">
              <Link href="/inventory/consignment" style={{ color: "inherit" }}>{consignedHere.length}</Link>
            </span>
            <span className="kpi-note">
              {t("stk.consignedCombos", { n: consignedHere.length })}
              {!allLocations && t("stk.atThisWarehouse")}
            </span>
          </span>
        </div>
      </div>

      {/* Only for a company that actually holds perishable stock. Most of a
          trading catalogue never expires, and a band chart reading zero
          forever is a question nobody asked kept on the screen. It appears
          the moment an item tracks expiry and has some on hand, and
          disappears again when the last dated batch is gone. */}
      {expiryBands.length > 0 && <ExpiryBands bands={expiryBands} />}

      {lowStock.length > 0 && (
        <section>
          <div className="card">
            <div className="card-head">
              <h2>{t("stk.lowTitle")}</h2>
              <span className="page-sub">{t("stk.lowSub")}</span>
            </div>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>{c("code")}</th><th>{t("item")}</th><th>{c("warehouse")}</th><th>{c("status")}</th>
                    <th className="r">{t("onHand")}</th><th className="r">{t("stk.reorderPoint")}</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStock.map((r) => (
                    <tr key={`${r.item_id}-${r.location_id}`}>
                      <td className="code">{r.item_code}</td>
                      <td className="wrap">{r.item_name}</td>
                      <td className="code">{r.location_code}</td>
                      <td>
                        <span className={`pill ${r.reason === "out_of_stock" ? "overdue" : "warn"}`}>
                          {r.reason === "out_of_stock" ? t("stk.outOfStock") : t("stk.belowReorder")}
                        </span>
                      </td>
                      <td className="r" style={{ color: Number(r.qty_on_hand) <= 0 ? "var(--bad)" : undefined }}>
                        {qty(r.qty_on_hand)}
                      </td>
                      <td className="r">{r.min_qty !== null ? qty(r.min_qty) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {reorderPoints.length > 0 && (
      <section>
        <div className="card">
          <div className="card-head">
            <h2>{t("stk.reorderPoints")}</h2>
            <span className="page-sub">{t("stk.nSet", { n: reorderPoints.length })}</span>
          </div>
          {(
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>{c("code")}</th><th>{t("item")}</th><th>{c("warehouse")}</th>
                    <th className="r">{t("stk.reorderPoint")}</th><th />
                  </tr>
                </thead>
                <tbody>
                  {reorderPoints.map((p) => (
                    <ReorderPointRow
                      key={p.id}
                      point={p}
                      updateAction={updateReorderPoint}
                      deleteAction={deleteReorderPoint}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      )}

      {hasVariants && (
        <div className="scopetabs viewtabs">
          {([["list", t("stk.viewList")], ["grouped", t("stk.viewGrouped")],
             ["matrix", t("stk.viewMatrix")]] as const).map(([key, label]) => {
            const q = new URLSearchParams();
            if (!allLocations) q.set("location", selectedLocationId);
            if (showZeros) q.set("zeros", "1");
            if (key !== "list") q.set("view", key);
            const qs = q.toString();
            return (
              <Link key={key} scroll={false} className="scopetab" data-active={mode === key}
                    href={`/items/stock${qs ? `?${qs}` : ""}`}>
                {label}
              </Link>
            );
          })}
        </div>
      )}

      {mode === "list" && (
      <section>
        <div className="card">
          <div className="card-head">
            <h2>{t("stk.position")}</h2>
            <span className="page-sub">
              {t("stk.itemsInStock", { n: skuCount })}
              {foldedAny && ` \u00b7 ${t("stk.rowsCount", { n: visible.length })}`}
              {!allLocations && ` · ${reorderableLocations.find((l) => l.id === selectedLocationId)?.name ?? ""}`}
            </span>
          </div>

          {visible.length === 0 ? (
            <div className="empty">
              {allLocations ? (
                <>
                  {t("stk.nothingInStock")}{" "}
                  <Link href="/items/stock?zeros=1" style={{ color: "var(--link)" }}>
                    {t("stk.showAllItems")}
                  </Link>
                </>
              ) : (
                <>
                  {t("stk.nothingHere")}{" "}
                  <Link href={`/items/stock?location=${selectedLocationId}&zeros=1`}
                        style={{ color: "var(--link)" }}>{t("stk.showAllItems")}</Link>
                </>
              )}
            </div>
          ) : (
            <StockTable
              rows={rows}
              consignmentItemIds={visible.filter((i) => i.consignedQty > 0).map((i) => i.id)}
              emptyLabel={t("stk.noStockedItems")}
              searchPlaceholder={t("stk.searchStock")}
              defaultSort={{ key: "code", dir: "asc" }}
              columns={[
                // No label: the chevron column is a control, not a field.
                { key: "expand", label: "" },
                { key: "code", label: c("code"), sortable: true },
                { key: "name", label: t("item"), sortable: true },
                { key: "ownership", label: t("stk.colOwnership"), sortable: true },
                { key: "group_name", label: c("category"), sortable: true },
                ...(multiBrand ? [{ key: "brand_name", label: c("brand"), sortable: true }] : []),
                { key: "uom_code", label: c("unit"), sortable: true },
                { key: "onHand", label: t("onHand"), sortable: true, align: "r" },
                ...(anyConsigned
                  ? [{ key: "consignedQty", label: t("stk.consigned"), sortable: true, align: "r" as const }]
                  : []),
                { key: "reservedQty", label: t("stk.reserved"), sortable: true, align: "r" },
                { key: "available", label: t("stk.colAvailable"), sortable: true, align: "r" },
                { key: "incomingQty", label: t("stk.incoming"), sortable: true, align: "r" },
                { key: "projected", label: t("stk.colProjected"), sortable: true, align: "r" },
                { key: "value_on_hand", label: t("stk.colValue"), sortable: true, align: "r" },
              ]}
              footerCells={{
                span: <>{t("stk.totalValue")}{!allLocations ? t("stk.atThisWarehouse") : ""}</>,
                cells: { value_on_hand: money(totalValue) },
              }}
            />
          )}
        </div>
      </section>
      )}

      {mode === "grouped" && (
        <VariantStock
          rows={showZeros ? variantStock : variantStock.filter((r) => Number(r.qty_on_hand) !== 0)}
          groupBy={group}
          basePath="/items/stock"
          keep={{ location: allLocations ? undefined : selectedLocationId,
                  zeros: showZeros ? "1" : undefined, view: "grouped" }}
        />
      )}

      {mode === "matrix" && (
        <StockMatrix
          rows={variantStock}
          productId={product}
          basePath="/items/stock"
          keep={{ location: allLocations ? undefined : selectedLocationId,
                  zeros: showZeros ? "1" : undefined }}
        />
      )}
    </>
  );
}

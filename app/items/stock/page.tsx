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
import { StockTable, ParamSelect } from "@/components/stock-table";
import { HelpHint } from "@/components/help-hint";
import { StockRow, type StockRowItem } from "@/components/stock-row";
import { asVariant } from "@/components/variant-tags";
import { variantPhotos } from "@/lib/variants";
import { VariantStock, type VariantStockRow } from "@/components/variant-stock";
import { StockMatrix } from "@/components/stock-matrix";
import { ExpiryBands } from "@/components/expiry-bands";
import { AddReorderPointForm } from "@/components/reorder-point-form";
import { ReorderPointRow } from "@/components/reorder-point-row";
import { getTranslations } from "next-intl/server";

type Row = {
  id: string; code: string; name: string; name_my: string | null;
  item_group_id: string; group_name: string; parent_group_name: string | null;
  brand_name: string | null; barcode: string | null;
  uom_code: string; qty_on_hand: string; value_on_hand: string; is_stocked: boolean;
  tracks_batch: boolean; tracks_expiry: boolean; tracks_serial: boolean; identity: string;
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
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { location, zeros, group, view, product } = sp;
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

  /*
   * Each list indexed once by item, then by warehouse, so a row is a lookup
   * rather than a scan of every row of every list — a catalogue of 2,000
   * variants against 6,000 stock rows was twelve million comparisons a load.
   */
  const index = <R extends { item_id: string; location_id: string }>(rows: R[], val: (r: R) => number) => {
    const m = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const per = m.get(r.item_id) ?? new Map<string, number>();
      per.set(r.location_id, (per.get(r.location_id) ?? 0) + val(r));
      m.set(r.item_id, per);
    }
    return m;
  };
  const qtyAt = index(stockByLocation, (r) => Number(r.qty_on_hand));
  const valueAt = index(stockByLocation, (r) => Number(r.value_on_hand));
  const reservedAt = index(reserved, (r) => Number(r.reserved_qty));
  const incomingAt = index(incoming, (r) => Number(r.incoming_qty));
  // Company-wide: the sum over every warehouse. One warehouse: that one, or 0.
  const pick = (m: Map<string, Map<string, number>>, itemId: string) => {
    const per = m.get(itemId);
    if (!per) return 0;
    if (!allLocations) return per.get(selectedLocationId) ?? 0;
    let s = 0; for (const v of per.values()) s += v; return s;
  };
  const onHandOf = (itemId: string, companyWide: number) => allLocations ? companyWide : pick(qtyAt, itemId);
  const valueOf = (itemId: string, companyWide: number) => allLocations ? companyWide : pick(valueAt, itemId);
  const reservedOf = (itemId: string) => pick(reservedAt, itemId);
  const incomingOf = (itemId: string) => pick(incomingAt, itemId);
  // Every consigned row visible under the current location choice. The KPI
  // counts these rather than the whole company's, or picking a warehouse
  // would leave the tile reading the same number for every warehouse.
  const consignedHere = allLocations
    ? consigned
    : consigned.filter((r) => r.location_id === selectedLocationId);
  const consignedAt = index(consignedHere, (r) => Number(r.on_hand));
  const consignedOf = (itemId: string) => pick(consignedAt, itemId);
  const consignorsByItem = new Map<string, Set<string>>();
  for (const r of consignedHere) consignorsByItem.set(r.item_id, (consignorsByItem.get(r.item_id) ?? new Set()).add(r.consignor_name));
  const batchesByItem = new Map<string, typeof batches>();
  for (const b of batches) batchesByItem.set(b.item_id, [...(batchesByItem.get(b.item_id) ?? []), b]);
  const locationById = new Map(locations.map((l) => [l.id, l]));

  // A product with variants is a name for a group and cannot hold stock —
  // fn_document_line_not_parent refuses it on any document line — so the
  // line is each variant on its own, named by its product.
  const childrenOf = new Map<string, Row[]>();
  for (const i of items) {
    if (!i.parent_item_id) continue;
    const list = childrenOf.get(i.parent_item_id) ?? [];
    list.push(i);
    childrenOf.set(i.parent_item_id, list);
  }
  const byId = new Map(items.map((i) => [i.id, i]));

  /** What gets a line: anything that can sit on a shelf. */
  const sellable = items.filter((i) => i.is_stocked && i.variant_count === 0);
  const lowIds = new Set(lowStock.map((r) => r.item_id));

  const stocked = sellable.map((i) => {
    const onHand = onHandOf(i.id, Number(i.qty_on_hand));
    const valueOnHand = valueOf(i.id, Number(i.value_on_hand));
    const reservedQty = reservedOf(i.id);
    const incomingQty = incomingOf(i.id);
    const consignedQty = consignedOf(i.id);
    const available = onHand - reservedQty;
    return { ...i, onHand, valueOnHand, reservedQty, incomingQty, consignedQty, available,
             projected: available + incomingQty,
             model: (i.parent_item_id && byId.get(i.parent_item_id)?.name) || i.name,
             status: (onHand <= 0 ? "OUT" : lowIds.has(i.id) ? "LOW" : "IN") as StockRowItem["status"] };
  });
  // Held, reserved, on its way or on consignment is a position; none of them
  // is the catalogue restated, which is a screen of its own.
  const visible = showZeros
    ? stocked
    : stocked.filter((i) =>
        i.onHand !== 0 || i.reservedQty !== 0 || i.incomingQty !== 0 || i.consignedQty !== 0);

  const totalValue = visible.reduce((s, i) => s + i.valueOnHand, 0);
  const totalOnHand = visible.reduce((s, i) => s + i.onHand, 0);

  const consignorsOf = (itemId: string) => Array.from(consignorsByItem.get(itemId) ?? []);

  /**
   * Where an item actually sits — owned or consigned — and only the chosen
   * warehouse when one is picked.
   */
  const warehousesOf = (itemId: string) => {
    const here = (locId: string) => allLocations || locId === selectedLocationId;
    const owned = qtyAt.get(itemId), held = consignedAt.get(itemId), res = reservedAt.get(itemId);
    const ids = new Set<string>();
    for (const [loc, q] of owned ?? []) if (here(loc) && q !== 0) ids.add(loc);
    for (const [loc, q] of held ?? []) if (here(loc) && q !== 0) ids.add(loc);
    return [...ids]
      .map((locationId) => {
        const loc = locationById.get(locationId);
        return {
          locationId, code: loc?.code ?? "—", name: loc?.name ?? "",
          onHand: owned?.get(locationId) ?? 0,
          consigned: held?.get(locationId) ?? 0,
          reserved: res?.get(locationId) ?? 0,
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));
  };

  const anyConsigned = stocked.some((i) => i.consignedQty > 0);
  const multiBrand = (await getBrandsInUse(company.id)).length > 1;
  const STOCK_COLUMNS = anyConsigned ? 10 : 9;
  const STATUS = { IN: "In stock", LOW: "Low stock", OUT: "Out of stock" } as const;

  /*
   * Searched, filtered, sorted and cut to one page here, so the browser gets
   * the page it shows and not the catalogue: 1,849 rows with their detail was
   * 3.2 MB a load. The table's controls write q, f_<key>, sort, dir, page and
   * size to the URL and this reads them back.
   */
  const lite = visible.map((i) => {
    const consignors = consignorsOf(i.id);
    const variant = asVariant(i.variant);
    return {
      i, consignors, variant,
      searchText: [i.code, i.name, i.model, i.name_my, i.group_name, i.parent_group_name, i.barcode, i.brand_name,
                   ...(variant ?? []).flatMap((v) => [v.a, v.o]), ...consignors].filter(Boolean).join(" ").toLowerCase(),
      facet: {
        status: i.status,
        category: i.parent_group_name ?? i.group_name,
        ownership: consignors.length > 0 ? "consigned" : "owned",
        brand: i.brand_name ?? "",
      } as Record<string, string>,
      sort: {
        name: `${i.model} ${(variant ?? []).map((v) => v.o).join(" ")}`,
        code: i.code,
        onHand: i.onHand, consignedQty: i.consignedQty, reservedQty: i.reservedQty, available: i.available,
        avg_cost: i.onHand > 0 ? i.valueOnHand / i.onHand : 0,
        value_on_hand: i.valueOnHand,
        status: i.status === "OUT" ? 0 : i.status === "LOW" ? 1 : 2,
      } as Record<string, string | number>,
    };
  });
  const needle = (sp.q ?? "").trim().toLowerCase();
  const chosen = Object.fromEntries(Object.entries(sp)
    .filter(([k, v]) => k.startsWith("f_") && v).map(([k, v]) => [k.slice(2), v as string]));
  const matched = lite.filter((r) => (!needle || r.searchText.includes(needle))
    && Object.entries(chosen).every(([k, v]) => r.facet[k] === v));
  const sortKey = sp.sort && sp.sort in (lite[0]?.sort ?? { name: 1 }) ? sp.sort : "name";
  const sortDir: "asc" | "desc" = sp.sort ? (sp.dir === "desc" ? "desc" : "asc") : "asc";
  matched.sort((a, b) => {
    const x = a.sort[sortKey] ?? "", y = b.sort[sortKey] ?? "";
    const k = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return sortDir === "asc" ? k : -k;
  });
  const pageSize = [10, 20, 50, 100].includes(Number(sp.size)) ? Number(sp.size) : 50;
  const pageCount = Math.max(1, Math.ceil(matched.length / pageSize));
  const pageNo = Math.min(pageCount, Math.max(1, Math.floor(Number(sp.page)) || 1));
  const pageRows = matched.slice((pageNo - 1) * pageSize, pageNo * pageSize);

  const rows: DataRow[] = pageRows.map(({ i, consignors, variant, searchText, facet, sort }) => {
    const category = i.parent_group_name ? `${i.parent_group_name} / ${i.group_name}` : i.group_name;
    const rowItem: StockRowItem = {
      id: i.id, code: i.code, name: i.name, nameMy: i.name_my, model: i.model,
      itemGroupId: i.item_group_id, category, uomCode: i.uom_code,
      barcode: i.barcode, brandName: i.brand_name,
      onHand: i.onHand, consignedQty: i.consignedQty, reservedQty: i.reservedQty, available: i.available,
      incomingQty: i.incomingQty, projected: i.projected, valueOnHand: i.valueOnHand,
      lastCost: i.last_purchase_price, lastCostDocNo: i.last_purchase_doc_no,
      lastCostDocId: i.last_purchase_document_id,
      lastCostDate: i.last_purchase_date ? shortDate(i.last_purchase_date) : null,
      consignors, warehouses: warehousesOf(i.id), variant, photoSrc: photoSrcOf(i),
      tracksBatch: !!i.tracks_batch, tracksExpiry: !!i.tracks_batch && !!i.tracks_expiry,
      tracksSerial: !!i.tracks_serial || i.identity === "OPTIONAL", status: i.status,
      batches: (batchesByItem.get(i.id) ?? []).map((b) => ({
        locationCode: b.location_code, batchNo: b.batch_no, expiryDate: b.expiry_date,
        daysLeft: b.days_left === null ? null : Number(b.days_left), qty: Number(b.qty),
      })),
    };
    return {
      key: i.id, searchText, facet, sort,
      node: <StockRow item={rowItem} columnCount={STOCK_COLUMNS} showConsigned={anyConsigned} />,
    };
  });

  const facetOptions = (vals: (string | null)[]) =>
    [...new Set(vals.filter((v): v is string => !!v))].sort().map((v) => ({ value: v, label: v }));
  const keep = {
    location: allLocations ? undefined : selectedLocationId,
    zeros: showZeros ? "1" : undefined,
    view: mode === "list" ? undefined : mode,
  };

  const scopeControls = (
    <>
      {reorderableLocations.length > 1 && (
        <ParamSelect param="location" label={c("warehouse")} keep={keep}
          value={allLocations ? "" : selectedLocationId}
          options={[{ value: "", label: t("stk.allWarehouses") },
                    ...reorderableLocations.map((l) => ({ value: l.id, label: l.name || l.code }))]} />
      )}
      <ParamSelect param="zeros" label="Stock" keep={keep} value={showZeros ? "1" : ""}
        options={[{ value: "", label: "In stock" }, { value: "1", label: "All items" }]} />
    </>
  );
  const viewSwitch = hasVariants && (
    <div className="seg" role="group" aria-label="View">
      {([["list", t("stk.viewList")], ["grouped", t("stk.viewGrouped")],
         ["matrix", t("stk.viewMatrix")]] as const).map(([key, label]) => {
        const q = new URLSearchParams();
        if (!allLocations) q.set("location", selectedLocationId);
        if (showZeros) q.set("zeros", "1");
        if (key !== "list") q.set("view", key);
        const qs = q.toString();
        return (
          <Link key={key} scroll={false} data-active={mode === key} aria-current={mode === key || undefined}
                href={`/items/stock${qs ? `?${qs}` : ""}`}>{label}</Link>
        );
      })}
    </div>
  );

  const kpi = (icon: React.ReactNode, tone: string, label: string, value: React.ReactNode, hint: string, bad = false) => (
    <div className="kpi">
      {/* One quiet colour for every mark: the figure is what stands out, not its icon. */}
      <span className="kpi-icon" data-tone={tone} style={{ color: "var(--ink)", background: "var(--line-soft)" }}>
        {icon}
      </span>
      <span className="kpi-body">
        <span className="kpi-label">{label} <HelpHint label={label}>{hint}</HelpHint></span>
        <span className="kpi-value" style={{ color: bad ? "var(--bad)" : undefined }}>{value}</span>
      </span>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <h1>{t("stk.title")}</h1>
        <BranchScope />
      </div>

      <div className="kpis kpis-tiled kpis-compact">
        {kpi(<Boxes size={16} aria-hidden="true" />, "var(--link)", t("stk.stockValue"), money(totalValue),
          t("stk.itemsInStock", { n: visible.filter((i) => i.onHand !== 0).length }))}
        {kpi(<AlertTriangle size={16} aria-hidden="true" />, "var(--warn)", t("stk.lowStock"), lowStock.length,
          t("stk.lowPairs", { n: lowStock.length }), lowStock.length > 0)}
        {kpi(<PackageCheck size={16} aria-hidden="true" />, "#3B6FD4", t("stk.incoming"), incoming.length,
          t("stk.incomingPairs", { n: incoming.length }))}
        {kpi(<TrendingDown size={16} aria-hidden="true" />, "#C2610A", t("stk.reserved"), reserved.length,
          t("stk.reservedPairs", { n: reserved.length }))}
        {kpi(<HandCoins size={16} aria-hidden="true" />, "#6C5CE0", t("stk.consigned"),
          <Link href="/inventory/consignment" style={{ color: "inherit" }}>{consignedHere.length}</Link>,
          t("stk.consignedCombos", { n: consignedHere.length }) + (allLocations ? "" : t("stk.atThisWarehouse")))}
      </div>

      {mode === "list" && (
      <section>
        <div className="card">
          <div className="card-head">
            <h2>{t("stk.position")}</h2>
            <span className="page-sub">
              {t("stk.itemsInStock", { n: visible.length })} · {qty(totalOnHand)} units
              {!allLocations && ` · ${reorderableLocations.find((l) => l.id === selectedLocationId)?.name ?? ""}`}
            </span>
          </div>
          <StockTable
            rows={rows}
            emptyLabel={showZeros ? t("stk.noStockedItems") : t("stk.nothingInStock")}
            searchPlaceholder="Search product, SKU, barcode…"
            defaultSort={{ key: "name", dir: "asc" }}
            server={{ total: matched.length, page: pageNo, pageSize, q: sp.q ?? "",
                      sort: sp.sort ? { key: sortKey, dir: sortDir } : null, filters: chosen }}
            toolbarStart={scopeControls}
            toolbarEnd={viewSwitch}
            filters={[
              { key: "status", allLabel: "All status", label: "Status",
                options: (["IN", "LOW", "OUT"] as const).map((s) => ({ value: s, label: STATUS[s] })) },
              { key: "category", allLabel: "All categories", label: c("category"), more: true,
                options: facetOptions(visible.map((i) => i.parent_group_name ?? i.group_name)) },
              ...(multiBrand ? [{ key: "brand", allLabel: "All brands", label: c("brand"), more: true,
                options: facetOptions(visible.map((i) => i.brand_name)) }] : []),
              ...(anyConsigned ? [{ key: "ownership", allLabel: "All ownership", label: t("stk.colOwnership"), more: true,
                options: [{ value: "owned", label: t("stk.companyOwned") }, { value: "consigned", label: t("stk.consignment") }] }] : []),
            ]}
            columns={[
              { key: "expand", label: "" },
              { key: "code", label: "SKU", sortable: true },
              { key: "name", label: "Product", sortable: true },
              { key: "onHand", label: t("onHand"), sortable: true, align: "r" },
              ...(anyConsigned
                ? [{ key: "consignedQty", label: t("stk.consigned"), sortable: true, align: "r" as const }]
                : []),
              { key: "reservedQty", label: t("stk.reserved"), sortable: true, align: "r" },
              { key: "available", label: t("stk.colAvailable"), sortable: true, align: "r" },
              { key: "avg_cost", label: "Avg. cost", sortable: true, align: "r" },
              { key: "value_on_hand", label: t("stk.colValue"), sortable: true, align: "r" },
              { key: "status", label: c("status"), sortable: true },
            ]}
            footerCells={{
              span: <>{t("stk.totalValue")}{!allLocations ? t("stk.atThisWarehouse") : ""}</>,
              cells: { onHand: qty(totalOnHand), value_on_hand: money(totalValue) },
            }}
          />
        </div>
      </section>
      )}

      {mode !== "list" && (
        <div className="dt-bar">{scopeControls}<span className="dt-spacer" />{viewSwitch}</div>
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

      {/* Only for a company that actually holds perishable stock. */}
      {expiryBands.length > 0 && <ExpiryBands bands={expiryBands} />}

      <div className="grid2 stk-below">
        <div className="card">
          <div className="card-head">
            <h2>{t("stk.lowTitle")}</h2>
            <span className="page-sub">{t("stk.lowSub")}</span>
          </div>
          {lowStock.length === 0 ? <div className="empty">Nothing is below its reorder point.</div> : (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("item")}</th><th>{c("warehouse")}</th><th>{c("status")}</th>
                    <th className="r">{t("onHand")}</th><th className="r">{t("stk.reorderPoint")}</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStock.map((r) => (
                    <tr key={`${r.item_id}-${r.location_id}`}>
                      <td className="wrap">{r.item_name}<span className="subline code"> · {r.item_code}</span></td>
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
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>{t("stk.reorderPoints")}</h2>
            <span className="page-sub">{t("stk.nSet", { n: reorderPoints.length })}</span>
            <span className="dt-spacer" />
            <AddReorderPointForm
              action={createReorderPoint}
              locations={reorderableLocations}
              count={reorderPoints.length}
            />
          </div>
          {reorderPoints.length === 0 ? <div className="empty">No reorder points set.</div> : (
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
                    <ReorderPointRow key={p.id} point={p} updateAction={updateReorderPoint} deleteAction={deleteReorderPoint} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

import { BranchScope } from "@/components/branch-scope";
import { seenRows, seenLocations, scopedBranch } from "@/lib/branch-scope";
import Link from "next/link";
import { qty as fmtQty } from "@/lib/db";
import {
  getCompany, getItems, getLocations, getStockByLocation, getReservedQty,
  getIncomingQty, getReorderPoints, getConsumptionRate, getItemSupply, getSupplierLeadTimes,
} from "@/lib/queries";
import { AccountPicker } from "@/components/account-picker";
import { VariantTags, asVariant } from "@/components/variant-tags";
import { ItemThumb } from "@/components/item-thumb";
import { variantPhotos } from "@/lib/variants";
import { getVariantStock } from "@/lib/queries";
import { HelpHint } from "@/components/help-hint";
import { ReplenishOrderButton } from "@/components/replenish-order-button";
import { draftOrderFromReplenishment } from "@/lib/actions";
import { replenishment, type ReplenishRow } from "@/lib/replenish";
import { getTranslations } from "next-intl/server";

/**
 * What to buy, and by when.
 *
 * Every figure here is derived at read time from the ledger — nothing is
 * stored, and nothing is forecast. The claim is only ever "this is what has
 * been going out, this is what is left, and at that rate it runs out on this
 * date" — arithmetic somebody can check against the stock card, not a
 * prediction they have to trust.
 *
 * An item with no sales in the window makes no claim at all rather than a
 * confident zero, and is listed separately so the silence is visible.
 */

const WINDOWS = [30, 60, 90] as const;
const COVERS = [14, 30, 60] as const;

const round = (n: number) => Math.round(n * 100) / 100;

export default async function Replenishment({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; cover?: string; location?: string }>;
}) {
  const sp = await searchParams;
  const t = await getTranslations("inventory");
  const c = await getTranslations("common");
  const n = await getTranslations("nav");
  const company = await getCompany();
  if (!company) return <div className="empty">{c("noCompany")}</div>;

  const windowDays = WINDOWS.includes(Number(sp.window) as never) ? Number(sp.window) : 30;
  const coverDays = COVERS.includes(Number(sp.cover) as never) ? Number(sp.cover) : 30;

  const [items, locations, stockByLocation, reserved, incoming, reorderPoints,
         consumption, supply, observedLead, variantStock] = await Promise.all([
    getItems(company.id) as unknown as Promise<any[]>,
    getLocations(company.id).then((r) => seenRows(r as unknown as Record<string, unknown>[], "id")) as unknown as Promise<any[]>,
    getStockByLocation(company.id).then((r) => seenRows(r as unknown as Record<string, unknown>[])) as unknown as Promise<any[]>,
    getReservedQty(company.id) as unknown as Promise<any[]>,
    getIncomingQty(company.id) as unknown as Promise<any[]>,
    getReorderPoints(company.id) as unknown as Promise<any[]>,
    getConsumptionRate(company.id, windowDays).then((r) => seenRows(r as unknown as Record<string, unknown>[])) as unknown as Promise<any[]>,
    getItemSupply(company.id) as unknown as Promise<any[]>,
    getSupplierLeadTimes(company.id) as unknown as Promise<any[]>,
    getVariantStock(company.id) as unknown as Promise<any[]>,
  ]);

  const stockLocations = locations.filter((l) => l.is_stock_location);
  const chosen = sp.location && stockLocations.some((l) => l.id === sp.location)
    ? sp.location : "all";
  const allLocations = chosen === "all";
  const here = (locId: string) => allLocations || locId === chosen;

  // What was last paid, so the draft carries an expected price rather
  // than a column of noughts for somebody to fill in by hand.
  const lastCost = new Map<string, number>(
    (items as any[]).filter((i) => i.last_purchase_price !== null)
      .map((i) => [i.id as string, Number(i.last_purchase_price)]));

  const photos = variantPhotos(variantStock as never);
  const srcOf = (itemId: string) => {
    const v = variantStock.find((x) => x.id === itemId);
    return v ? photos.srcFor(v as never) : null;
  };

  // Only things that can actually be bought and held. A product with
  // variants is neither: its variants are what get ordered.
  const buyable = new Map(items.filter((i) => i.is_stocked && i.variant_count === 0)
                               .map((i) => [i.id as string, i]));
  const supplyOf = new Map(supply.map((s) => [s.item_id as string, s]));

  const { rows, quiet } = replenishment({
    items: [...buyable.values()] as never,
    stockByLocation: stockByLocation as never,
    reserved: reserved as never,
    incoming: incoming as never,
    reorderPoints: reorderPoints as never,
    consumption: consumption as never,
    supply: supply as never,
    observed: observedLead as never,
    windowDays, coverDays, here,
    fallbackLeadDays: company.default_lead_time_days,
  });
  type Row = ReplenishRow;

  const urgent = rows.filter((r) => r.urgency === "now").length;

  /** One purchase order per supplier is how buying actually happens. */
  const bySupplier = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.supplier ?? "\u0000none";
    bySupplier.set(key, [...(bySupplier.get(key) ?? []), r]);
  }

  const href = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    if (windowDays !== 30) q.set("window", String(windowDays));
    if (coverDays !== 30) q.set("cover", String(coverDays));
    if (!allLocations) q.set("location", chosen);
    for (const [k, v] of Object.entries(over)) {
      if (v === undefined) q.delete(k); else q.set(k, v);
    }
    const s = q.toString();
    return `/inventory/replenishment${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">{n("inventory")}</span>
        <h1>{t("rep.title")}</h1>
        <BranchScope />
        <HelpHint>
          {t("rep.help")}
        </HelpHint>
      </div>

      <div className="filterbar">
        {stockLocations.length > 1 && (
          <AccountPicker
            accounts={[{ id: "all", code: "—", name: t("sum.allWarehouses") }, ...stockLocations]}
            selectedId={chosen}
            basePath="/inventory/replenishment"
            paramName="location"
            label={c("warehouse")}
            keep={{ window: windowDays !== 30 ? String(windowDays) : undefined,
                    cover: coverDays !== 30 ? String(coverDays) : undefined }}
          />
        )}
        <div className="field">
          <label>{t("rep.salesOver")}</label>
          <div className="scopetabs" style={{ margin: 0 }}>
            {WINDOWS.map((w) => (
              <Link key={w} className="scopetab" data-active={w === windowDays}
                    href={href({ window: w === 30 ? undefined : String(w) })}>
                {t("rep.nDays", { n: w })}
              </Link>
            ))}
          </div>
        </div>
        <div className="field">
          <label>{t("rep.buyCover")}</label>
          <div className="scopetabs" style={{ margin: 0 }}>
            {COVERS.map((cv) => (
              <Link key={cv} className="scopetab" data-active={cv === coverDays}
                    href={href({ cover: cv === 30 ? undefined : String(cv) })}>
                {t("rep.nDays", { n: cv })}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="kpis kpis-tiled">
        <div className="kpi">
          <span className="kpi-body">
            <span className="kpi-label">{t("rep.toOrder")}</span>
            <span className="kpi-value">{rows.length}</span>
            <span className="kpi-note">
              {t("rep.shortOfCover", { n: rows.length, days: coverDays })}
            </span>
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-body">
            <span className="kpi-label">{t("rep.orderToday")}</span>
            <span className="kpi-value" style={{ color: urgent > 0 ? "var(--bad)" : undefined }}>
              {urgent}
            </span>
            <span className="kpi-note">
              {t("rep.runOutBefore")}
            </span>
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-body">
            <span className="kpi-label">{t("rep.noSales")}</span>
            <span className="kpi-value">{quiet.length}</span>
            <span className="kpi-note">
              {t("rep.belowNothing", { n: windowDays })}
            </span>
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          {t("rep.nothingNeeds", { cover: coverDays, window: windowDays })}
        </div>
      ) : (
        [...bySupplier.entries()].map(([key, list]) => (
          <section key={key}>
            <div className="card">
              <div className="card-head">
                <h2>{key === "\u0000none" ? t("rep.noSupplier") : key}</h2>
                <span className="page-sub">
                  {t("rep.nItems", { n: list.length })}
                  {/* Measured belongs to the supplier, so it is said once
                      here. Expected can differ item by item, so it has a
                      column of its own. */}
                  {list[0].measuredDays !== null &&
                    ` · ${t("rep.measured", { days: list[0].measuredDays, n: list[0].measuredSample })}`}
                </span>
              </div>

              {key === "\u0000none" && (
                <div className="card-body" style={{ paddingBottom: 0 }}>
                  <span className="page-sub">
                    {t("rep.defaultAssumed", { n: list[0].leadTime })}
                  </span>
                </div>
              )}

              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th colSpan={2}>{t("item")}</th>
                      <th className="r">{t("onHand")}</th>
                      <th className="r">{t("stk.reserved")}</th>
                      <th className="r">{t("stk.incoming")}</th>
                      <th className="r">{t("rep.perDay")}</th>
                      <th className="r">{t("rep.lead")}</th>
                      <th className="r">{t("rep.runsOutIn")}</th>
                      <th>{t("rep.orderBy")}</th>
                      <th className="r">{t("rep.suggest")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.id}>
                        <td className="vgroup-thumb">
                          <ItemThumb src={srcOf(r.id)} name={r.name} />
                        </td>
                        <td className="wrap">
                          <span className="m">{r.code}</span>
                          <div className="subline">
                            {r.name}
                            <VariantTags variant={asVariant(r.variant)}
                                         className="vartags-inline" />
                          </div>
                        </td>
                        <td className="r">{fmtQty(String(r.onHand))}</td>
                        <td className="r" style={{ color: r.reserved > 0 ? "var(--warn)" : undefined }}>
                          {r.reserved > 0 ? fmtQty(String(r.reserved)) : "—"}
                        </td>
                        <td className="r" style={{ color: r.incoming > 0 ? "var(--ok)" : undefined }}>
                          {r.incoming > 0 ? fmtQty(String(r.incoming)) : "—"}
                        </td>
                        <td className="r">{r.perDay}</td>
                        <td className="r">
                          <span title={
                            r.leadSource === "item" ? t("rep.leadItem")
                            : r.leadSource === "supplier" ? t("rep.leadSupplier")
                            : t("rep.leadDefault")}>
                            {t("int.nDay", { n: r.leadTime })}
                          </span>
                          {r.leadSource === "item" && (
                            <span className="page-sub"> {t("rep.item")}</span>
                          )}
                          {/* Never acted on, only raised. The figure above
                              is what somebody configured and it stays that
                              way until they change it. */}
                          {r.reviewSuggested && (
                            <div className="subline" style={{ color: "var(--warn)" }}>
                              {t("rep.actuallyReview", { n: r.measuredDays ?? 0 })}
                            </div>
                          )}
                        </td>
                        <td className="r">
                          {r.daysLeft === null ? "—" : t("int.nDay", { n: Math.floor(r.daysLeft) })}
                        </td>
                        <td>
                          <span className={`pill ${
                            r.urgency === "now" ? "overdue" : r.urgency === "soon" ? "warn" : ""}`}>
                            {r.urgency === "now" ? t("rep.today") : r.orderBy ?? "—"}
                          </span>
                        </td>
                        <td className="r">
                          <strong>{fmtQty(String(r.suggest))}</strong>{" "}
                          <span className="page-sub">{r.uom}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="card-body">
                <ReplenishOrderButton
                  action={draftOrderFromReplenishment}
                  supplierId={list[0].supplierId}
                  supplierName={key === "\u0000none" ? t("rep.noSupplierShort") : key}
                  lines={list.map((r) => ({
                    itemId: r.id, qty: r.suggest,
                    unitPrice: lastCost.get(r.id) ?? undefined,
                    // Frozen onto the draft line, so a later change to the
                    // supplier's settings cannot restate what this order
                    // was expecting when it was drafted.
                    leadDays: r.leadTime, leadSource: r.leadSource,
                  }))}
                />
                <span className="page-sub" style={{ marginLeft: "0.6rem" }}>
                  {t("rep.putsLines", { n: list.length })}
                </span>
              </div>
            </div>
          </section>
        ))
      )}

      {quiet.length > 0 && (
        <section>
          <div className="card">
            <div className="card-head">
              <h2>{t("rep.quietTitle")}</h2>
              <span className="page-sub">
                {t("rep.quietSub", { n: windowDays })}
              </span>
            </div>
            <div className="card-body" style={{ paddingBottom: 0 }}>
              <span className="page-sub">
                {t("rep.quietBody")}
              </span>
            </div>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr><th>{c("code")}</th><th>{t("item")}</th><th className="r">{t("rep.shortBy")}</th></tr>
                </thead>
                <tbody>
                  {quiet.map((q) => (
                    <tr key={q.code}>
                      <td className="code">{q.code}</td>
                      <td className="wrap">
                        {q.name}
                        <VariantTags variant={asVariant(q.variant)} className="vartags-inline" />
                      </td>
                      <td className="r">{fmtQty(String(q.short))} {q.uom}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

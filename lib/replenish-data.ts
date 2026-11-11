import {
  getItems, getStockByLocation, getReservedQty, getIncomingQty, getReorderPoints,
  getDemandDays, getItemSupply, getSupplierLeadTimes, getOpenPurchaseLines,
} from "./queries";
import { seenRows } from "./branch-scope";
import { replenishment } from "./replenish";

type Any = Record<string, unknown>;

/**
 * Everything replenishment reads, fetched in one round of parallel queries
 * (nine, each a single statement — no per-item queries), then planned by
 * lib/replenish. The page and the dashboard card both come through here so
 * they cannot disagree.
 */
export async function loadPlan(companyId: string, o: {
  windowDays: number; coverDays: number; location?: string | null; fallbackLeadDays: number;
}) {
  const seen = <T extends Any>(p: Promise<unknown>) => p.then((r) => seenRows(r as T[]));
  const [items, stock, reserved, incoming, points, demand, supply, observed, openLines] = await Promise.all([
    getItems(companyId) as unknown as Promise<Any[]>,
    seen(getStockByLocation(companyId)),
    getReservedQty(companyId) as unknown as Promise<Any[]>,
    getIncomingQty(companyId) as unknown as Promise<Any[]>,
    getReorderPoints(companyId) as unknown as Promise<Any[]>,
    seen(getDemandDays(companyId)),
    getItemSupply(companyId) as unknown as Promise<Any[]>,
    getSupplierLeadTimes(companyId) as unknown as Promise<Any[]>,
    seen(getOpenPurchaseLines(companyId)),
  ]);
  const here = (loc: string) => !o.location || loc === o.location;

  // Only what can be bought and held: a product with variants is neither.
  const buyable = items.filter((i) => i.is_stocked && i.variant_count === 0);
  const { rows } = replenishment({
    items: buyable as never, stockByLocation: stock as never, reserved: reserved as never,
    incoming: incoming as never, reorderPoints: points as never, demand: demand as never,
    supply: supply as never, observed: observed as never,
    windowDays: o.windowDays, coverDays: o.coverDays, here, fallbackLeadDays: o.fallbackLeadDays,
  });
  return {
    rows,
    items: buyable,
    openLines: (openLines as Any[]).filter((l) => here(l.location_id as string)) as unknown as OpenLine[],
  };
}

export type LowStockRow = {
  item_id: string; item_code: string; item_name: string;
  location_id: string; location_code: string; qty_on_hand: string;
  /** The reorder point it is measured against: the calculated one. */
  min_qty: string | null;
  reason: "below_reorder" | "out_of_stock";
};

/**
 * The low-stock alert, read off the plan rather than a figure typed by hand.
 *
 * An item is below its reorder point when what is on the shelf has fallen to
 * the calculated reorder point — demand over the lead time plus safety stock,
 * never below a minimum somebody set (Min–max: the minimum itself). Manual
 * items are left alone; they are bought by hand. Out of stock is anything
 * planned with nothing left. One rule, shared by the Stock page and the
 * dashboard, so the alert and Replenishment cannot disagree.
 */
export function lowStockFromPlan(rows: Awaited<ReturnType<typeof loadPlan>>["rows"],
                                 where: { id: string; code: string }): LowStockRow[] {
  return rows
    .filter((r) => r.method !== "MANUAL" && (r.onHand <= 0 || (r.rop > 0 && r.onHand <= r.rop)))
    .map((r) => ({
      item_id: r.id, item_code: r.code, item_name: r.name,
      location_id: where.id, location_code: where.code, qty_on_hand: String(r.onHand),
      min_qty: r.rop > 0 ? String(r.rop) : null,
      reason: r.onHand <= 0 ? "out_of_stock" as const : "below_reorder" as const,
    }))
    .sort((a, b) => (Number(b.min_qty ?? 0) - Number(b.qty_on_hand)) - (Number(a.min_qty ?? 0) - Number(a.qty_on_hand)));
}

export type OpenLine = {
  order_id: string; doc_no: string; doc_date: string | Date; due_date: string | Date | null;
  partner_id: string | null; supplier: string | null; item_id: string; location_id: string; outstanding: number;
};

import { sql } from "./db";
import { can, DISCOUNT_CEILING_PCT, type SessionUser } from "./auth-core";

type Line = { itemId: string; unitPrice: number; discountPct?: number | null; focReasonId?: string | null };
export type PriceProblem = {
  key: "discountNeedsManager" | "priceNeedsManager" | "freeNeedsManager" | "belowCostNeedsManager";
  values: Record<string, string | number>;
};
/** Per item: its name, the price it should sell at (null if none is set) and its average stock cost (null if unknown). */
export type PriceFacts = Map<string, { name: string; price: number | null; cost: number | null }>;

/**
 * The price an item should sell at: the RETAIL list price, else the
 * customer's own price level; and what a unit of it costs on average across
 * the stock on hand. One query for every line.
 */
export async function priceFacts(co: string, itemIds: string[], partnerId: string | null): Promise<PriceFacts> {
  const rows = await sql`
    select i.id, i.name,
           coalesce(
             (select ip.price from item_price ip join price_level pl on pl.id = ip.price_level_id
               where ip.item_id = i.id and pl.code = 'RETAIL' and ip.valid_from <= current_date
               order by ip.valid_from desc limit 1),
             (select ip.price from item_price ip
               where ip.item_id = i.id and ip.valid_from <= current_date
                 and ip.price_level_id = (select price_level_id from business_partner where id = ${partnerId}::uuid)
               order by ip.valid_from desc limit 1))::float as price,
           (select sum(v.value_on_hand) / nullif(sum(v.qty_on_hand), 0) from v_stock_on_hand v
             where v.company_id = ${co} and v.item_id = i.id and v.qty_on_hand > 0)::float as cost
      from item i where i.company_id = ${co} and i.id = any(${itemIds})`;
  return new Map(rows.map((r) => [r.id as string, { name: r.name as string, price: r.price as number | null, cost: r.cost as number | null }]));
}

/**
 * What a seller without discount.unlimited may charge, checked on the server
 * because the price and the free-of-charge reason both arrive from the
 * browser, and a typed price is a discount too:
 *
 *   discount   at most DISCOUNT_CEILING_PCT on the line
 *   free       a manager's call
 *   price      after the line's discount, at least the list (or the
 *              customer's level) price less that ceiling, when one is set
 *   cost       never below the item's average stock cost — the floor that
 *              holds even where no price list is kept
 *
 * The refusal never says what the cost is: a seller who may not see cost is
 * told only that a manager must approve. Managers and administrators are not
 * checked. Null means the sale may post.
 */
export async function priceProblem(
  user: SessionUser | { role: SessionUser["role"] }, co: string, lines: Line[], partnerId: string | null = null,
  facts: (ids: string[]) => Promise<PriceFacts> = (ids) => priceFacts(co, ids, partnerId),
): Promise<PriceProblem | null> {
  if (can(user, "discount.unlimited")) return null;
  const pct = DISCOUNT_CEILING_PCT;
  if (lines.some((l) => (l.discountPct ?? 0) > pct)) return { key: "discountNeedsManager", values: { pct } };
  if (lines.some((l) => l.focReasonId)) return { key: "freeNeedsManager", values: {} };
  const ids = [...new Set(lines.map((l) => l.itemId))];
  if (ids.length === 0) return null;
  const known = await facts(ids);
  for (const l of lines) {
    const item = known.get(l.itemId);
    if (!item) continue;
    const charged = l.unitPrice * (1 - (l.discountPct ?? 0) / 100);
    if (item.price) {
      const floor = item.price * (1 - pct / 100);
      if (charged < floor - 0.005) {
        return { key: "priceNeedsManager", values: { name: item.name, floor: Math.ceil(floor).toLocaleString("en-US"), pct } };
      }
    }
    if (item.cost && charged < item.cost - 0.005) return { key: "belowCostNeedsManager", values: { name: item.name } };
  }
  return null;
}

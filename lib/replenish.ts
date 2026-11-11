/**
 * What to buy, worked out once.
 *
 * The replenishment page and the dashboard card both answer "what needs
 * ordering", and two copies of that arithmetic would eventually disagree.
 * So the rule lives here and both call it.
 *
 * Pure: it takes rows the caller already fetched and returns rows. Nothing
 * here reaches the database, so it can be reasoned about and tested
 * without one (scripts/test-replenish.mjs).
 *
 * The plan, per item, is the textbook reorder-point model a buyer can check
 * by hand:
 *
 *   demand per day   what went out over the window, divided by its days
 *   safety stock     z × σ(daily) × √lead — z from the item's ABC class, σ
 *                    from 13 weeks of demand; or a fixed figure if set
 *   reorder point    demand × lead + safety (never below a min if one is set)
 *   order up to      demand × (lead + cover) + safety
 *   suggest          when projected stock is at or below the reorder point,
 *                    order up to the target, rounded up to the supplier's
 *                    minimum and pack
 *
 * MINMAX items skip the arithmetic (below min, order up to max); MANUAL
 * items are never suggested. Nothing is forecast beyond "what has been
 * going out keeps going out".
 */

export type PlanMethod = "AUTO" | "MINMAX" | "MANUAL";
export type Abc = "A" | "B" | "C" | null;
export type Xyz = "X" | "Y" | "Z" | null;
export type Status = "now" | "soon" | "ok" | "excess" | "dead" | "manual";

export type ReplenishInputs = {
  items: { id: string; code: string; name: string; uom_code: string; variant: unknown;
           item_group_id?: string | null; last_purchase_price?: string | number | null }[];
  stockByLocation: { item_id: string; location_id: string; qty_on_hand: string; value_on_hand?: string }[];
  reserved: { item_id: string; location_id: string; reserved_qty: string }[];
  incoming: { item_id: string; location_id: string; incoming_qty: string }[];
  reorderPoints: { item_id: string; location_id: string; min_qty: string | null; max_qty?: string | null;
                   method?: PlanMethod | null; safety_qty?: string | null }[];
  /** Day-by-day demand over the last 91 days (ago 0 = today). */
  demand: { item_id: string; location_id: string; ago: number; qty: number; cost?: number }[];
  supply: {
    item_id: string; supplier_id: string | null; supplier_name: string | null;
    supplier_days: number | null; item_days: number | null;
    moq?: string | number | null; order_multiple?: string | number | null;
  }[];
  /** Measured supplier lead time. Advisory: it never sets the figure used. */
  observed: { partner_id: string; observed_days: number; sample: number }[];
  windowDays: number;
  coverDays: number;
  here: (locationId: string) => boolean;
  fallbackLeadDays: number;
  /** For "order by" dates; defaults to now. */
  today?: Date;
};

export type ReplenishRow = {
  id: string; code: string; name: string; variant: unknown; uom: string; categoryId: string | null;
  supplier: string | null; supplierId: string | null;
  leadTime: number; leadSource: "item" | "supplier" | "default";
  measuredDays: number | null; measuredSample: number; reviewSuggested: boolean;
  onHand: number; stockValue: number; reserved: number; incoming: number;
  available: number; projected: number;
  perDay: number;
  /** Standard deviation of daily demand, from 13 weekly buckets. */
  sdDay: number;
  abc: Abc; xyz: Xyz;
  method: PlanMethod;
  min: number | null; max: number | null; moq: number | null; multiple: number | null;
  safety: number; safetySource: "set" | "calc";
  rop: number; target: number;
  /** Days the available stock lasts at the current rate; null with no demand. */
  daysLeft: number | null;
  /** Days projected stock (with incoming) lasts. */
  daysCover: number | null;
  orderBy: string | null;
  suggest: number;
  unitCost: number;
  /** Over the target, for excess rows. */
  excessQty: number;
  status: Status;
  /** Kept for the dashboard card: now / soon / ok. */
  urgency: "now" | "soon" | "ok";
  /** Units out per week, oldest first, 13 weeks. */
  weeks: number[];
};

const round = (n: number) => Math.round(n * 100) / 100;
/** Service level by ABC class: A 98%, B 95%, C 90%. */
export const Z = { A: 2.05, B: 1.65, C: 1.28 } as const;
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

/** Up to the supplier's minimum, then up to a whole pack. */
export function roundToBuy(qty: number, moq: number | null, multiple: number | null) {
  if (qty <= 0) return 0;
  let q = Math.ceil(qty);
  if (moq && q < moq) q = moq;
  if (multiple && multiple > 0) q = Math.ceil(q / multiple) * multiple;
  return q;
}

/** Pareto by value: the items making the first 80% are A, the next 15% B. */
export function classifyAbc(values: Map<string, number>) {
  const out = new Map<string, Abc>();
  const sorted = [...values.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((t, [, v]) => t + v, 0);
  let run = 0;
  for (const [id, v] of sorted) {
    // Classed by where the item starts, so the item that crosses 80% is still A.
    out.set(id, run / total < 0.8 ? "A" : run / total < 0.95 ? "B" : "C");
    run += v;
  }
  return out;
}

/** Steadiness: coefficient of variation of weekly demand. */
export function classifyXyz(weeks: number[]): Xyz {
  const mean = weeks.reduce((t, x) => t + x, 0) / weeks.length;
  if (mean <= 0) return null;
  const sd = Math.sqrt(weeks.reduce((t, x) => t + (x - mean) ** 2, 0) / weeks.length);
  const cv = sd / mean;
  return cv < 0.5 ? "X" : cv < 1 ? "Y" : "Z";
}

export function replenishment(input: ReplenishInputs): { rows: ReplenishRow[] } {
  const {
    items, stockByLocation, reserved, incoming, reorderPoints, demand,
    supply, observed, windowDays, coverDays, here, fallbackLeadDays,
  } = input;
  const now = input.today ?? new Date();

  // Indexed once: every lookup below is by item, never a scan per item.
  const group = <T extends { item_id: string; location_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) if (here(r.location_id)) (m.get(r.item_id) ?? m.set(r.item_id, []).get(r.item_id)!).push(r);
    return m;
  };
  const stockOf = group(stockByLocation), resOf = group(reserved), incOf = group(incoming);
  const rpOf = group(reorderPoints as never as { item_id: string; location_id: string }[]) as never as
    Map<string, ReplenishInputs["reorderPoints"]>;
  const demOf = group(demand);
  const supplyOf = new Map(supply.map((s) => [s.item_id, s]));
  const seenOf = new Map(observed.map((o) => [o.partner_id, o]));
  const total = <T>(rows: T[] | undefined, f: (r: T) => number) => (rows ?? []).reduce((t, r) => t + f(r), 0);

  // ABC on what went out over the window, at cost.
  const valueOf = new Map<string, number>();
  for (const [id, rows] of demOf) valueOf.set(id, total(rows.filter((r) => r.ago < windowDays), (r) => Number(r.cost ?? 0)));
  const abcOf = classifyAbc(valueOf);

  const rows: ReplenishRow[] = [];
  for (const i of items) {
    const dem = demOf.get(i.id) ?? [];
    const onHand = total(stockOf.get(i.id), (r) => Number(r.qty_on_hand));
    const stockValue = total(stockOf.get(i.id), (r) => Number(r.value_on_hand ?? 0));
    const res = total(resOf.get(i.id), (r) => Number(r.reserved_qty));
    const inc = total(incOf.get(i.id), (r) => Number(r.incoming_qty));
    const rps = rpOf.get(i.id) ?? [];
    // Nothing on hand, nothing coming, nothing sold and nothing set: no plan to make.
    if (onHand === 0 && inc === 0 && res === 0 && dem.length === 0 && rps.length === 0) continue;

    const available = onHand - res;
    const projected = available + inc;
    const issued = total(dem.filter((r) => r.ago < windowDays), (r) => r.qty);
    const perDay = Math.max(0, issued / windowDays);

    const weeks = Array.from({ length: 13 }, () => 0);
    for (const r of dem) weeks[12 - Math.min(12, Math.floor(r.ago / 7))] += r.qty;
    const meanW = weeks.reduce((t, x) => t + x, 0) / 13;
    const sdW = Math.sqrt(weeks.reduce((t, x) => t + (x - meanW) ** 2, 0) / 13);
    const sdDay = sdW / Math.sqrt(7);

    // Settings: one row per location; across all locations they add up.
    const method: PlanMethod = (rps.find((r) => r.method && r.method !== "AUTO")?.method ?? "AUTO") as PlanMethod;
    const sumSet = (k: "min_qty" | "max_qty" | "safety_qty") => {
      const v = rps.map((r) => num(r[k])).filter((x): x is number => x !== null);
      return v.length ? v.reduce((t, x) => t + x, 0) : null;
    };
    const min = sumSet("min_qty"), max = sumSet("max_qty"), fixedSafety = sumSet("safety_qty");

    const sup = supplyOf.get(i.id);
    const supplierId = sup?.supplier_id ?? null;
    const seen = supplierId ? seenOf.get(supplierId) : undefined;
    const lead = num(sup?.item_days) !== null ? { leadTime: Number(sup!.item_days), leadSource: "item" as const }
      : num(sup?.supplier_days) !== null ? { leadTime: Number(sup!.supplier_days), leadSource: "supplier" as const }
      : { leadTime: fallbackLeadDays, leadSource: "default" as const };
    const measuredDays = seen ? Number(seen.observed_days) : null;
    const measuredSample = seen?.sample ?? 0;
    // A gap of 3+ days over 2+ receipts: one late container is not a trend.
    const reviewSuggested = measuredDays !== null && measuredSample >= 2 && Math.abs(measuredDays - lead.leadTime) >= 3;
    const L = lead.leadTime;
    const moq = num(sup?.moq), multiple = num(sup?.order_multiple);

    const abc = abcOf.get(i.id) ?? null;
    const xyz = perDay > 0 ? classifyXyz(weeks) : null;
    const z = Z[abc ?? "C"];
    const calcSafety = Math.ceil(z * sdDay * Math.sqrt(Math.max(L, 1)));
    const safety = fixedSafety ?? calcSafety;

    let rop: number, target: number;
    if (method === "MINMAX") {
      rop = min ?? 0;
      target = Math.max(max ?? min ?? 0, rop);
    } else {
      rop = Math.max(Math.ceil(perDay * L + safety), min ?? 0);
      target = Math.max(Math.ceil(perDay * (L + coverDays) + safety), rop);
    }

    const daysLeft = perDay > 0 ? available / perDay : null;
    const daysCover = perDay > 0 ? projected / perDay : null;
    const triggered = method !== "MANUAL" && (method === "MINMAX" ? projected < rop : projected <= rop && (perDay > 0 || rop > 0));
    const suggest = triggered ? roundToBuy(target - projected, moq, multiple) : 0;

    // Slack before an order must go in: stays unrounded for the test, floored
    // for the date (0.9 days of slack is today's problem, not tomorrow's).
    const slack = daysLeft === null ? null : daysLeft - L;
    let urgency: ReplenishRow["urgency"] = "ok";
    if (suggest > 0) urgency = slack === null ? "soon" : slack < 1 ? "now" : "soon";

    // Excess: more than twice the order-up-to level, or stock with no demand at all.
    const excessQty = perDay > 0 && projected > 2 * target ? Math.floor(projected - target) : 0;
    const status: Status = method === "MANUAL" ? "manual"
      : suggest > 0 ? urgency as Status
      : perDay === 0 && onHand > 0 ? "dead"
      : excessQty > 0 ? "excess" : "ok";

    rows.push({
      id: i.id, code: i.code, name: i.name, variant: i.variant, uom: i.uom_code,
      categoryId: i.item_group_id ?? null,
      supplier: sup?.supplier_name ?? null, supplierId,
      leadTime: L, leadSource: lead.leadSource, measuredDays, measuredSample, reviewSuggested,
      onHand, stockValue, reserved: res, incoming: inc, available, projected,
      perDay: round(perDay), sdDay: round(sdDay), abc, xyz, method,
      min, max, moq, multiple, safety, safetySource: fixedSafety !== null ? "set" : "calc",
      rop, target,
      daysLeft: daysLeft === null ? null : round(daysLeft),
      daysCover: daysCover === null ? null : round(daysCover),
      orderBy: suggest > 0 ? new Date(now.getTime() + Math.max(0, Math.floor(slack ?? 0)) * 86400000).toISOString().slice(0, 10) : null,
      suggest,
      unitCost: Number(i.last_purchase_price ?? 0) || (onHand > 0 ? stockValue / onHand : 0),
      excessQty, status, urgency, weeks,
    });
  }

  const rank: Record<Status, number> = { now: 0, soon: 1, excess: 2, dead: 3, ok: 4, manual: 5 };
  rows.sort((a, b) => rank[a.status] - rank[b.status] || (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9) || a.code.localeCompare(b.code));
  return { rows };
}

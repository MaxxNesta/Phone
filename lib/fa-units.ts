import { fromUnits, toUnits, type ScheduleRow } from "./fa-engine";

/**
 * A group's units and their shares. Pure, so the server and the tests divide
 * the same way: a total over the units to the cent, each unit but the last in
 * proportion, the last taking what rounding leaves, so the units add up to the
 * group exactly, month by month as well as in cost.
 */

/** A whole quantity of two or more makes units; anything else is one asset. */
export const makesUnits = (quantity: number) => Number.isInteger(quantity) && quantity >= 2 && quantity <= 500;

/** Unit codes and costs for a new group: FA-0004-01 …, the cost to the cent. */
export function unitPlan(code: string, cost: string, quantity: number) {
  if (!makesUnits(quantity)) return [];
  const total = toUnits(cost);
  const q = BigInt(quantity);
  const raw = (total * 2n + q) / (2n * q); // half up, in ten-thousandths
  const each = (raw + 50n) / 100n * 100n; // to the cent
  return Array.from({ length: quantity }, (_, i) => ({
    seq: i + 1, code: `${code}-${String(i + 1).padStart(2, "0")}`,
    cost: fromUnits(i < quantity - 1 ? each : total - each * BigInt(quantity - 1)),
  }));
}

/** A total split by weights, to the cent, the last share taking the remainder. */
export function shareOut(total: bigint, weights: bigint[]): bigint[] {
  const all = weights.reduce((s, w) => s + w, 0n);
  if (all === 0n || weights.length === 0) return weights.map(() => 0n);
  const cent = 100n; // 100 ten-thousandths is one cent
  let given = 0n;
  return weights.map((w, i) => {
    if (i === weights.length - 1) return total - given;
    const v = (total * w * 2n + all) / (2n * all); // half up
    const c = (v + cent / 2n) / cent * cent;
    given += c;
    return c;
  });
}

/** One unit's schedule: its share of each month, its own opening and closing book value. */
export function unitSchedule(rows: ScheduleRow[], unitCosts: bigint[], index: number, groupCost: bigint): ScheduleRow[] {
  // Shared out by running total, not month by month: each unit's month is the
  // change in its share of everything depreciated so far, so the cents never
  // drift and every unit lands exactly where its share of the group does.
  const unitCost = unitCosts[index];
  let before = shareOut(groupCost - (rows[0]?.opening ?? groupCost), unitCosts)[index];
  let cum = groupCost - (rows[0]?.opening ?? groupCost);
  return rows.map((r) => {
    cum += r.amount;
    const upTo = shareOut(cum, unitCosts)[index];
    const amount = upTo - before;
    const out = { ...r, amount, posted: r.posted === null ? null : amount, opening: unitCost - before, closing: unitCost - upTo,
                  residual: shareOut(r.residual, unitCosts)[index] };
    before = upTo;
    return out;
  });
}

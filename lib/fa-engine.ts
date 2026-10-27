/**
 * The depreciation engine: one asset's schedule, month by month.
 *
 * Pure: no database, no clock. The screens, the posting run and the tests all
 * call this, so the figure a calendar shows is the figure a run posts.
 *
 * Money is exact. Amounts are bigint ten-thousandths of a kyat (the scale of
 * numeric(18,4)), so 1,250,000 MMK is 12_500_000_000n. No float touches a
 * figure; the only division is an integer one with half-up rounding, and the
 * last month takes whatever is left so the schedule lands exactly on the
 * residual value.
 *
 * Straight line, by remaining balance: each month that is not on the ledger
 * gets its share of what is left to depreciate (net book value less residual)
 * in proportion to its weight against the weight still to come. With nothing
 * unusual that is cost-less-residual over the life in equal parts. When the
 * ledger differs (a historical journal of another amount, a correction, a
 * change of estimate) the rest of the life absorbs the difference instead of
 * the schedule pretending it did not happen.
 *
 * Weights are what make a partial month exact. A full month weighs one; with
 * the DAILY convention the first month weighs the days left in it over the
 * days in it, and a final short month after the life takes the rest, all as
 * integers in days-of-the-first-month.
 */

export type Convention = "NEXT_MONTH" | "SAME_MONTH" | "DAILY";
/** "2026-10". */
export type Month = string;

export type EngineAsset = {
  cost: bigint;
  residual: bigint;
  lifeMonths: number;
  /** "YYYY-MM-DD". Null: not in service, no schedule. */
  inService: string | null;
  convention: Convention;
  /** "YYYY-MM-DD": no depreciation after it (see disposalCutoff). */
  disposedOn?: string | null;
};

/** A new life (total, from in service) and residual, from a month onwards. */
export type EngineEstimate = { from: Month; lifeMonths: number; residual: bigint };

export type ScheduleRow = {
  month: Month;
  /** What the month carries: the ledger's figure if posted, else the plan. */
  amount: bigint;
  /** The ledger's figure for the month (runs, history, corrections), if any. */
  posted: bigint | null;
  opening: bigint;
  closing: bigint;
  residual: bigint;
  state: "POSTED" | "PLANNED";
};

/** Amounts are rounded to this many ten-thousandths: 10_000n is whole kyat. */
export const WHOLE_KYAT = 10_000n;

const pad = (n: number) => String(n).padStart(2, "0");
export const monthOf = (date: string): Month => date.slice(0, 7);
export const addMonths = (m: Month, k: number): Month => {
  const [y, mo] = m.split("-").map(Number);
  const t = y * 12 + (mo - 1) + k;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
};
export const monthsBetween = (a: Month, b: Month) => {
  const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number);
  return (yb * 12 + mb) - (ya * 12 + ma);
};
const daysIn = (m: Month) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
const dayOf = (date: string) => Number(date.slice(8, 10));

/** Half-up division of non-negative bigints. */
const divRound = (a: bigint, b: bigint) => (a * 2n + b) / (2n * b);

/** The first month that depreciates, and its share of a full month as days/daysInMonth. */
export function firstMonth(a: EngineAsset): { month: Month; days: number; of: number } | null {
  if (!a.inService) return null;
  const m = monthOf(a.inService);
  if (a.convention === "NEXT_MONTH") return { month: addMonths(m, 1), days: 1, of: 1 };
  if (a.convention === "SAME_MONTH") return { month: m, days: 1, of: 1 };
  const of = daysIn(m);
  return { month: m, days: of - dayOf(a.inService) + 1, of };
}

/**
 * The last month that may carry depreciation once an asset is disposed of:
 * NEXT_MONTH stops the month before (as it started the month after),
 * SAME_MONTH includes the month of disposal, DAILY counts the days held in it.
 */
export function disposalCutoff(a: EngineAsset): { month: Month; days?: number; of?: number } | null {
  if (!a.disposedOn) return null;
  const m = monthOf(a.disposedOn);
  if (a.convention === "NEXT_MONTH") return { month: addMonths(m, -1) };
  if (a.convention === "SAME_MONTH") return { month: m };
  return { month: m, days: dayOf(a.disposedOn), of: daysIn(m) };
}

/**
 * The weight of each month of a life of `life` months starting at `start`, in
 * units of 1/`of` of a month: [month, weight] in order.
 */
function weights(start: { month: Month; days: number; of: number }, life: number): [Month, bigint][] {
  const of = BigInt(start.of), first = BigInt(start.days);
  if (first === of) return Array.from({ length: life }, (_, k) => [addMonths(start.month, k), of]);
  const out: [Month, bigint][] = [[start.month, first]];
  for (let k = 1; k < life; k++) out.push([addMonths(start.month, k), of]);
  out.push([addMonths(start.month, life), of - first]);
  return out;
}

/**
 * The schedule from the first month to the last that carries anything, plus
 * any month the ledger has posted outside it (shown, never ignored).
 */
export function schedule(a: EngineAsset, opts: {
  estimates?: EngineEstimate[];
  /** What the ledger carries per month: runs, linked history and corrections together. */
  posted?: Map<Month, bigint>;
  /**
   * An opening balance carried the depreciation up to and including this
   * month as one figure (in `posted` at this month): every month before it
   * counts as carried, at nothing, and is never owed again.
   */
  openingThrough?: Month | null;
  unit?: bigint;
} = {}): ScheduleRow[] {
  const start = firstMonth(a);
  if (!start || a.lifeMonths < 1) return [];
  const unit = opts.unit ?? WHOLE_KYAT;
  const posted = opts.posted ?? new Map<Month, bigint>();
  const estimates = [...(opts.estimates ?? [])].sort((x, y) => x.from.localeCompare(y.from));
  const cut = disposalCutoff(a);

  // The estimate in force in a month: the last one from on or before it.
  const at = (m: Month) => {
    let life = a.lifeMonths, residual = a.residual;
    for (const e of estimates) if (e.from <= m) { life = e.lifeMonths; residual = e.residual; }
    return { life, residual };
  };

  const rows: ScheduleRow[] = [];
  let nbv = a.cost;
  // Months to walk: the plan under each estimate, the disposal cutoff, and
  // anything the ledger has posted that falls later still.
  const lastPlanned = (life: number) => weights(start, life).at(-1)![0];
  let end = lastPlanned(a.lifeMonths);
  for (const e of estimates) { const l = lastPlanned(e.lifeMonths); if (l > end) end = l; if (e.from > end) end = e.from; }
  for (const m of posted.keys()) if (m > end) end = m;
  if (cut && cut.month < end) end = cut.month;
  const firstPosted = [...posted.keys()].sort()[0];
  const from = firstPosted && firstPosted < start.month ? firstPosted : start.month;

  for (let m = from; m <= end; m = addMonths(m, 1)) {
    const { life, residual } = at(m);
    const opening = nbv;
    const covered = opts.openingThrough && m < opts.openingThrough ? 0n : undefined;
    const ledger = posted.get(m) ?? covered;
    let amount: bigint;
    if (ledger !== undefined) {
      amount = ledger;
    } else {
      // This month's weight against the whole of the life still to come. A
      // disposal shortens only the month it happens in; it never speeds up
      // the months before it, so `rest` is the full remaining life.
      const plan = weights(start, life).filter(([wm]) => wm >= m);
      let here = plan.find(([wm]) => wm === m)?.[1] ?? 0n;
      // Days held in the month of disposal: here × days/daysInMonth, kept as a
      // fraction (num/den) so the share is exact, not rounded to a whole day-unit.
      let den = 1n;
      if (cut && m === cut.month && cut.days !== undefined && cut.days < cut.of!) {
        here = here * BigInt(cut.days); den = BigInt(cut.of!);
      }
      const rest = plan.reduce((s, [, w]) => s + w, 0n);
      const left = opening > residual ? opening - residual : 0n;
      if (left === 0n) amount = 0n;
      // A new, shorter life that has already run out: what is left goes in
      // the month the change takes effect.
      else if (plan.length === 0) amount = left;
      else if (here === 0n) amount = 0n;
      // The last month of the life takes exactly what is left, so the
      // schedule lands on residual whatever the rounding did before it.
      else if (here === rest && den === 1n) amount = left;
      else amount = divRound(left * here, rest * den * unit) * unit;
      // Rounding may never carry it below residual.
      if (amount > left) amount = left;
    }
    nbv = opening - amount;
    rows.push({ month: m, amount, posted: ledger ?? null, opening, closing: nbv, residual, state: ledger !== undefined ? "POSTED" : "PLANNED" });
  }
  // Nothing to show after the asset is down to residual and nothing posted.
  while (rows.length && rows.at(-1)!.amount === 0n && rows.at(-1)!.state === "PLANNED") rows.pop();
  return rows;
}

/** The planned and posted figure for one month, or zero. */
export const amountFor = (rows: ScheduleRow[], m: Month) => rows.find((r) => r.month === m) ?? null;

/** Totals that should tie: depreciable base = sum of the schedule. */
export const sum = (xs: bigint[]) => xs.reduce((s, x) => s + x, 0n);

// ----------------------------------------------------- decimal strings --

/** "1250000.5" → 12_500_005_000n; exact, refuses anything that is not a decimal. */
export function toUnits(v: string | number): bigint {
  const s = String(v).trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,4})\d*)?$/.exec(s);
  if (!m) throw new Error(`Not an amount: ${s}`);
  const n = BigInt(m[2]) * 10_000n + BigInt(((m[3] ?? "") + "0000").slice(0, 4));
  return m[1] ? -n : n;
}
/** 12_500_005_000n → "1250000.5000". */
export function fromUnits(n: bigint): string {
  const neg = n < 0n, a = neg ? -n : n;
  return `${neg ? "-" : ""}${a / 10_000n}.${String(a % 10_000n).padStart(4, "0")}`;
}

/**
 * Cash taken at the counter: what is due, what was handed over, and the change.
 *
 * Display and validation only. What the sale posts is the sale's own total,
 * never the cash handed over: the till gives change from the drawer, it does
 * not book it. `postedAmount` is the one place that amount is worked out, and
 * it takes the total alone — the cash received is not an input to it.
 *
 * Everything here is whole cents (integers), so 0.1 + 0.2 style errors cannot
 * make a sale say "0 short" while refusing to post, or give a cent too much.
 */

/** The amount a counter sale posts as its payment: the total, to the cent. */
export const postedAmount = (total: number): number => Math.round(total * 100) / 100;

const toCents = (n: number) => Math.round(n * 100);

export type Tender = {
  /** Total due, in cents — the amount that posts. */
  dueCents: number;
  /** Null when nothing is typed: the customer paid the exact amount. */
  receivedCents: number | null;
  changeCents: number;
  shortCents: number;
  /** Typed, but not an amount of zero or more. */
  invalid: boolean;
};

export function tender(total: number, received: string): Tender {
  const dueCents = toCents(postedAmount(total));
  const text = received.trim();
  if (text === "") return { dueCents, receivedCents: null, changeCents: 0, shortCents: 0, invalid: false };
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return { dueCents, receivedCents: null, changeCents: 0, shortCents: 0, invalid: true };
  const receivedCents = toCents(n);
  return {
    dueCents, receivedCents, invalid: false,
    changeCents: Math.max(0, receivedCents - dueCents),
    shortCents: Math.max(0, dueCents - receivedCents),
  };
}

/** Whole kyat without decimals; a part-kyat shows its two decimals rather than rounding away. */
export function fmtCents(cents: number): string {
  const whole = cents % 100 === 0;
  return (cents / 100).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
}

/** The amount typed into the box for "exactly the total". */
export const exactText = (dueCents: number) => String(dueCents / 100);

/** Exact, then the next round notes above it: what a customer is likely to hand over. */
export function quickAmounts(dueCents: number): number[] {
  if (dueCents <= 0) return [];
  const steps = [10_000, 50_000, 100_000].map((s) => s * 100);
  const ups = steps.map((s) => Math.ceil(dueCents / s) * s);
  return [...new Set([dueCents, ...ups])].slice(0, 4);
}

/**
 * A sale paid several ways. Digital tenders post exactly what was typed; cash
 * posts only what is still due after them, and anything handed over past that
 * is change from the drawer. Digital money past the total is an overpayment:
 * there is no change to give from a wallet.
 */
export function splitTender(total: number, rows: { cash: boolean; amount: string }[]) {
  const dueCents = toCents(postedAmount(total));
  const typed = rows.map((r) => {
    const n = Number(r.amount);
    return r.amount.trim() === "" || !Number.isFinite(n) || n < 0 ? 0 : toCents(n);
  });
  const digitalCents = rows.reduce((s, r, i) => s + (r.cash ? 0 : typed[i]), 0);
  let cashRoom = Math.max(0, dueCents - digitalCents);
  let changeCents = 0;
  const postedCents = rows.map((r, i) => {
    if (!r.cash) return typed[i];
    const take = Math.min(typed[i], cashRoom);
    cashRoom -= take;
    changeCents += typed[i] - take;
    return take;
  });
  const paidCents = postedCents.reduce((s, c) => s + c, 0);
  return {
    dueCents, postedCents, paidCents, changeCents,
    remainingCents: Math.max(0, dueCents - paidCents),
    overCents: Math.max(0, digitalCents - dueCents),
  };
}

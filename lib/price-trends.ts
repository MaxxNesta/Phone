/**
 * Price history as trends: per product, what the unit price was at the start
 * of the period, at the end, its low and high, and a day-by-day series to
 * draw. Pure functions over the lines getPriceHistory returns, all in MMK.
 *
 * A product is an item in one unit: a carton and a piece of the same item
 * are two prices, never averaged together.
 */

export type TrendLine = { date: string; item_id: string; item: string; code: string; uom: string; qty: number; unit_base: number; doc_no: string; partner: string };

export type ProductTrend = {
  key: string; item: string; code: string; uom: string; lines: number;
  first: number; last: number; low: number; high: number;
  /** Last against first, as a fraction; null when the first price was zero. */
  change: number | null;
  /** Weighted average per day, oldest first. */
  spark: number[];
};

export const trendKey = (r: { item_id: string; uom: string }) => `${r.item_id}:${r.uom}`;

/** Quantity-weighted average per date, oldest first. */
function byDay(lines: TrendLine[]) {
  const days = new Map<string, { v: number; q: number }>();
  for (const l of lines) {
    const d = days.get(l.date) ?? { v: 0, q: 0 };
    d.v += l.unit_base * l.qty; d.q += l.qty;
    days.set(l.date, d);
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({ date, avg: d.v / d.q }));
}

export function productTrends(rows: TrendLine[]): ProductTrend[] {
  const groups = new Map<string, TrendLine[]>();
  for (const r of rows) {
    const k = trendKey(r);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  return [...groups.entries()].map(([key, ls]) => {
    const days = byDay(ls);
    const first = days[0].avg, last = days[days.length - 1].avg;
    const prices = ls.map((l) => l.unit_base);
    return {
      key, item: ls[0].item, code: ls[0].code, uom: ls[0].uom, lines: ls.length,
      first, last, low: Math.min(...prices), high: Math.max(...prices),
      change: first > 0 ? (last - first) / first : null,
      spark: days.map((d) => d.avg),
    };
  });
}

/** Day for a short range, week up to about half a year, month beyond. */
export function bucketOf(from: string, to: string) {
  const span = (Date.parse(to) - Date.parse(from)) / 86400000;
  return span <= 45 ? "day" : span <= 200 ? "week" : "month";
}

function bucketStart(date: string, size: "day" | "week" | "month") {
  const d = new Date(`${date}T00:00:00Z`);
  if (size === "week") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday
  if (size === "month") d.setUTCDate(1);
  return d.getTime();
}

/** One product's dots and its per-period average with low–high band. */
export function timeline(lines: TrendLine[], size: "day" | "week" | "month") {
  // Lines on the same day at the same price are one dot: their quantities add
  // up and their documents are listed together.
  const dots = new Map<string, { t: number; price: number; qty: number; doc: string; partner: string }>();
  for (const l of lines) {
    const t = Date.parse(`${l.date}T00:00:00Z`), k = `${t}|${Math.round(l.unit_base * 100)}`;
    const d = dots.get(k);
    if (!d) dots.set(k, { t, price: l.unit_base, qty: l.qty, doc: l.doc_no, partner: l.partner });
    else {
      d.qty += l.qty;
      if (!d.doc.split(", ").includes(l.doc_no)) d.doc += `, ${l.doc_no}`;
      if (!d.partner.split(", ").includes(l.partner)) d.partner += `, ${l.partner}`;
    }
  }
  const points = [...dots.values()].sort((a, b) => a.t - b.t);
  const groups = new Map<number, TrendLine[]>();
  for (const l of lines) {
    const t = bucketStart(l.date, size);
    (groups.get(t) ?? groups.set(t, []).get(t)!).push(l);
  }
  const buckets = [...groups.entries()].sort(([a], [b]) => a - b).map(([t, ls]) => {
    const q = ls.reduce((s, l) => s + l.qty, 0);
    const prices = ls.map((l) => l.unit_base);
    return { t, avg: ls.reduce((s, l) => s + l.unit_base * l.qty, 0) / q, band: [Math.min(...prices), Math.max(...prices)] as [number, number], lines: ls.length };
  });
  return { points, buckets };
}

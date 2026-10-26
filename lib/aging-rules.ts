// What the age groups and the sales pace mean, with no database: the
// settings form previews with the same rules the report sorts by.

/** Age cut-offs and names, and the sales-pace cut-offs, as the shop sets them. */
export type AgingRules = { thresholds: [number, number, number]; labels: [string, string, string, string] };
export type PaceRules = { fastDays: number; slowDays: number };

export const AGING_DEFAULTS: AgingRules = { thresholds: [30, 60, 90], labels: ["Fresh", "Normal", "Aging", "Old stock"] };
export const PACE_DEFAULTS: PaceRules = { fastDays: 30, slowDays: 90 };

/** Which bucket a unit of this age falls in: 0..3. */
export const bucketOf = (age: number, t: AgingRules["thresholds"]) =>
  age <= t[0] ? 0 : age <= t[1] ? 1 : age <= t[2] ? 2 : 3;

/** "0–30 days", "31–60 days", …, "91+ days". */
export const bucketRanges = (t: AgingRules["thresholds"]) =>
  [`0–${t[0]} days`, `${t[0] + 1}–${t[1]} days`, `${t[1] + 1}–${t[2]} days`, `${t[2] + 1}+ days`];

export type Pace = "FAST" | "MODERATE" | "SLOW" | "NONE";
/** Days of cover at the 90-day selling rate, against the shop's two cut-offs. Independent of age. */
export function paceOf(units: number, sold90: number, p: PaceRules): { pace: Pace; cover: number | null } {
  if (sold90 <= 0) return { pace: "NONE", cover: null };
  const cover = Math.round(units / (sold90 / 90));
  return { pace: cover <= p.fastDays ? "FAST" : cover <= p.slowDays ? "MODERATE" : "SLOW", cover };
}

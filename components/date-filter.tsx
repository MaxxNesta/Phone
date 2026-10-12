"use client";

/**
 * When a list can be narrowed to. Presets first — most questions are "this
 * month" or "last week", and a choice is quicker than typing two dates — and a
 * custom range for the rest, shown only when asked for. Dates are compared as
 * calendar days (UTC midnight), the way posting dates are stored.
 */
const DATE_PRESETS = [
  ["", "Any date"], ["today", "Today"], ["yesterday", "Yesterday"], ["7d", "Last 7 days"],
  ["30d", "Last 30 days"], ["month", "This month"], ["lastmonth", "Last month"],
  ["year", "This year"], ["custom", "Custom range…"],
] as const;
export type DatePreset = (typeof DATE_PRESETS)[number][0];
export type DateRange = { preset: DatePreset; from: string; to: string };
export const ANY_DATE: DateRange = { preset: "", from: "", to: "" };

const DAY = 86_400_000;
const dayOf = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
const parseDay = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(v + "T00:00:00Z") : NaN);

/** The [from, to) window a range means today, in UTC-midnight milliseconds; null for any date. */
export function dateWindow({ preset, from, to }: DateRange): [number, number] | null {
  const now = new Date();
  const today = dayOf(now);
  switch (preset) {
    case "today": return [today, today + DAY];
    case "yesterday": return [today - DAY, today];
    case "7d": return [today - 6 * DAY, today + DAY];
    case "30d": return [today - 29 * DAY, today + DAY];
    case "month": return [Date.UTC(now.getFullYear(), now.getMonth(), 1), today + DAY];
    case "lastmonth": return [Date.UTC(now.getFullYear(), now.getMonth() - 1, 1), Date.UTC(now.getFullYear(), now.getMonth(), 1)];
    case "year": return [Date.UTC(now.getFullYear(), 0, 1), today + DAY];
    case "custom": {
      const a = parseDay(from), b = parseDay(to);
      if (Number.isNaN(a) && Number.isNaN(b)) return null;
      return [Number.isNaN(a) ? -Infinity : a, Number.isNaN(b) ? Infinity : b + DAY];
    }
    default: return null;
  }
}

/** Whether a date (a YYYY-MM-DD string or milliseconds) falls in the range. Undated rows never do. */
export function inDateRange(value: string | number | null | undefined, range: DateRange): boolean {
  const w = dateWindow(range);
  if (!w) return true;
  // A plain day ("2026-10-11"), or anything a Date reads — some pages hand
  // over String(date) — taken as the calendar day it names.
  const s = value == null ? "" : String(value);
  const t = typeof value === "number" ? value
    : /^\d{4}-\d{2}-\d{2}/.test(s) ? parseDay(s.slice(0, 10))
    : s && !Number.isNaN(new Date(s).getTime()) ? dayOf(new Date(s)) : NaN;
  return Number.isFinite(t) && t > 0 && t >= w[0] && t < w[1];
}

/** The preset menu, and two day fields when the range is custom. */
export function DateFilter({ value, onChange }: { value: DateRange; onChange: (v: DateRange) => void }) {
  return (
    <div className="dt-dates" role="group" aria-label="Date">
      <select
        aria-label="Date"
        className={`dt-filter${value.preset ? " dt-filter-on" : ""}`}
        value={value.preset}
        onChange={(e) => onChange({ ...value, preset: e.target.value as DatePreset })}
      >
        {DATE_PRESETS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
      {value.preset === "custom" && (
        <>
          <input type="date" className="dt-date" aria-label="From date" value={value.from}
            max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          <span className="dt-date-sep" aria-hidden="true">–</span>
          <input type="date" className="dt-date" aria-label="To date" value={value.to}
            min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} />
        </>
      )}
    </div>
  );
}

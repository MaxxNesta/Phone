/**
 * Reading what a form sent, on the server, with limits.
 *
 * Every server action reads its fields through these, so the rules live in
 * one place: text is trimmed, stripped of control characters and capped in
 * length; a number is a real, finite number of a sane size (commas allowed,
 * "1,000" is a thousand, not zero); a date is a real calendar date.
 *
 * A field that breaks a rule throws with the field's name, which each action
 * turns into the error message it shows. Business rules (a quantity above
 * zero, a price list's limits) stay with the action that knows them.
 */

/** Long enough for any remark or address; short enough that nobody stores a novel in a code field. */
export const TEXT_MAX = 2000;
/** Larger than any figure this business will see, small enough to stay exact as a double. */
export const NUMBER_MAX = 1e13;

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Text with the rules applied; for values that did not come through a FormData field. */
export function cleanStr(value: unknown, key = "text", max = TEXT_MAX): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw new Error(`${key}: expected text`);
  }
  const s = String(value).replace(CONTROL, "").trim();
  if (s.length > max) throw new Error(`${key} is too long (${s.length} characters; the limit is ${max}).`);
  return s;
}

/**
 * Fields that carry a payload rather than a value — a JSON list, a CSV, an
 * image — and their own ceilings. Everything else gets TEXT_MAX.
 */
const MB = 1024 * 1024;
export const PAYLOAD_MAX: Record<string, number> = {
  photo_data: 12 * MB, file: 8 * MB, csv: 8 * MB, payload: 2 * MB, lines: 2 * MB,
  allocations: 2 * MB, orders: 2 * MB, suggestions: 2 * MB, prices: 2 * MB, packs: MB,
  variant_plan: MB, settings: MB, axes: 10_000, fingerprint: 100_000,
};

/** A text field: trimmed, no control characters, within its length limit. */
export function str(fd: FormData, key: string, max = PAYLOAD_MAX[key] ?? TEXT_MAX): string {
  const v = fd.get(key);
  if (v instanceof File) throw new Error(`${key}: expected text, got a file`);
  return cleanStr(v, key, max);
}

/** A number: blank is 0; anything else must be a finite number within ±NUMBER_MAX. */
export function cleanNum(value: unknown, key = "number"): number {
  if (value === null || value === undefined) return 0;
  const s = typeof value === "number" ? value : String(value).replace(/,/g, "").trim();
  if (s === "") return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number.`);
  if (Math.abs(n) > NUMBER_MAX) throw new Error(`${key} is too large.`);
  return n;
}

export function num(fd: FormData, key: string): number {
  const v = fd.get(key);
  if (v instanceof File) throw new Error(`${key}: expected a number, got a file`);
  return cleanNum(v, key);
}

/** A YYYY-MM-DD date that exists on the calendar, or "" when blank. */
export function date(fd: FormData, key: string): string {
  const s = str(fd, key, 10);
  if (!s) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`${key} must be a date (YYYY-MM-DD).`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new Error(`${key} is not a real date.`);
  return s;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An id field: a UUID, or "" when blank. */
export function id(fd: FormData, key: string): string {
  const s = str(fd, key, 36);
  if (s && !UUID.test(s)) throw new Error(`${key} is not a valid id.`);
  return s;
}
export const isUuid = (s: unknown) => typeof s === "string" && UUID.test(s);

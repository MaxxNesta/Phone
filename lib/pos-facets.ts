/**
 * The till's browse filters, as pure functions over the items already loaded
 * for the branch. Nothing here reads the database: groups and values are
 * whatever the loaded variants carry (type, model, and each variant option
 * such as Storage or Colour), so a new attribute in the master data shows up
 * by itself. Counts come from the loaded rows, never from per-IMEI queries.
 *
 * Rules: several values of one attribute are OR; different attributes are
 * AND. A group's own counts ignore that group's own selection, so choosing
 * "256 GB" still shows how many "512 GB" there are to switch to.
 */

export type FacetItem = {
  id: string; type: string | null; model: string; variant: string | null; brand: string | null;
  code: string; barcode: string | null; on_hand: number; price: number | null;
  opts: Record<string, string> | null;
};

export type Selection = {
  type: string;
  models: string[];
  /** attribute name -> chosen values */
  opts: Record<string, string[]>;
  inStockOnly: boolean;
  lowOnly: boolean;
  q: string;
};

export const LOW_STOCK = 2;

/**
 * Browsing loads the whole shelf in one query, so the filters and counts the
 * till draws are complete and filtering costs no further requests. A shelf
 * beyond this many variants is cut there; the till says so, and a search
 * finds the rest.
 */
export const SHELF_LIMIT = 2000;

export const emptySelection = (): Selection =>
  ({ type: "", models: [], opts: {}, inStockOnly: true, lowOnly: false, q: "" });

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/** Every word typed must appear somewhere in the item ("iphone 16 256gb"). */
export function matchesText(i: FacetItem, q: string): boolean {
  const words = q.toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = squash([i.model, i.variant ?? "", i.brand ?? "", i.code, i.barcode ?? "",
    ...Object.values(i.opts ?? {})].join(" "));
  return words.every((w) => hay.includes(squash(w)));
}

type Skip = { models?: boolean; attr?: string; type?: boolean };

/** Whether an item passes every filter, except those named in `skip`. */
export function passes(i: FacetItem, s: Selection, skip: Skip = {}): boolean {
  if (!skip.type && s.type && i.type !== s.type) return false;
  if (s.inStockOnly && i.on_hand <= 0) return false;
  if (s.lowOnly && !(i.on_hand > 0 && i.on_hand <= LOW_STOCK)) return false;
  if (!matchesText(i, s.q)) return false;
  if (!skip.models && s.models.length > 0 && !s.models.includes(i.model)) return false;
  for (const [attr, chosen] of Object.entries(s.opts)) {
    if (chosen.length === 0 || skip.attr === attr) continue;
    const have = i.opts?.[attr];
    if (!have || !chosen.includes(have)) return false;
  }
  return true;
}

export const filterItems = <T extends FacetItem>(items: T[], s: Selection): T[] => items.filter((i) => passes(i, s));

export type Group = { attr: string; values: Array<{ value: string; count: number; on: boolean }> };

export type Facets = {
  /** Types in use, most items first, with how many each holds. */
  types: Array<{ type: string; count: number }>;
  models: Array<{ value: string; count: number; on: boolean }>;
  groups: Group[];
  active: number;
};

/**
 * Which attributes apply. Under a type: any option its items carry. Under All:
 * only the attributes shared by items of at least two types — Storage and
 * Colour yes, "Chip" only if more than one type has it — so the common filters
 * show and the ones that mean something to one line of products wait for it.
 */
function attributeOrder(rows: FacetItem[], common: boolean): string[] {
  const rank = new Map<string, number>();
  const kinds = new Map<string, Set<string>>();
  for (const i of rows) {
    Object.keys(i.opts ?? {}).forEach((a, n) => {
      rank.set(a, Math.min(rank.get(a) ?? 99, n));
      if (!kinds.has(a)) kinds.set(a, new Set());
      kinds.get(a)!.add(i.type ?? "");
    });
  }
  return [...rank.keys()]
    .filter((a) => !common || (kinds.get(a)?.size ?? 0) >= 2)
    .sort((a, b) => (rank.get(a)! - rank.get(b)!) || a.localeCompare(b));
}

export function computeFacets(items: FacetItem[], s: Selection): Facets {
  // Types count whatever else is chosen, but not the type itself.
  const typeCounts = new Map<string, number>();
  for (const i of items) if (i.type && passes(i, { ...s, type: "" }, { type: true })) {
    typeCounts.set(i.type, (typeCounts.get(i.type) ?? 0) + 1);
  }
  const types = [...typeCounts.entries()].map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

  // The rows the groups are drawn from: the type, text and stock filters only.
  const inType = items.filter((i) => (!s.type || i.type === s.type));
  const attrs = attributeOrder(inType, !s.type);

  const modelCounts = new Map<string, number>();
  for (const i of inType) if (passes(i, s, { models: true })) modelCounts.set(i.model, (modelCounts.get(i.model) ?? 0) + 1);
  for (const m of s.models) if (!modelCounts.has(m)) modelCounts.set(m, 0);
  const models = [...modelCounts.entries()]
    .map(([value, count]) => ({ value, count, on: s.models.includes(value) }))
    .filter((m) => m.count > 0 || m.on)
    .sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }));

  const groups: Group[] = [];
  for (const attr of attrs) {
    const counts = new Map<string, number>();
    for (const i of inType) {
      const v = i.opts?.[attr];
      if (v && passes(i, s, { attr })) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const chosen = s.opts[attr] ?? [];
    for (const v of chosen) if (!counts.has(v)) counts.set(v, 0);
    const values = [...counts.entries()]
      .map(([value, count]) => ({ value, count, on: chosen.includes(value) }))
      .filter((v) => v.count > 0 || v.on)
      .sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }));
    if (values.length > 0) groups.push({ attr, values });
  }

  const active = s.models.length + Object.values(s.opts).reduce((n, v) => n + v.length, 0) + (s.lowOnly ? 1 : 0);
  return { types, models, groups, active };
}

/**
 * Changing category: keep only what still applies there. A model that is not
 * in the new type, an attribute it does not carry, a value no variant has —
 * dropped, rather than left silently hiding everything.
 */
export function reconcile(items: FacetItem[], s: Selection): Selection {
  const inType = items.filter((i) => !s.type || i.type === s.type);
  const models = new Set(inType.map((i) => i.model));
  const valuesOf = new Map<string, Set<string>>();
  for (const i of inType) for (const [a, v] of Object.entries(i.opts ?? {})) {
    if (!valuesOf.has(a)) valuesOf.set(a, new Set());
    valuesOf.get(a)!.add(v);
  }
  const allowed = new Set(attributeOrder(inType, !s.type));
  const opts: Record<string, string[]> = {};
  for (const [a, chosen] of Object.entries(s.opts)) {
    if (!allowed.has(a)) continue;
    const keep = chosen.filter((v) => valuesOf.get(a)?.has(v));
    if (keep.length > 0) opts[a] = keep;
  }
  return { ...s, models: s.models.filter((m) => models.has(m)), opts };
}

/** Toggle one value of one group. */
export function toggleValue(s: Selection, attr: string | "model", value: string): Selection {
  const flip = (list: string[]) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  if (attr === "model") return { ...s, models: flip(s.models) };
  const next = flip(s.opts[attr] ?? []);
  const opts = { ...s.opts };
  if (next.length === 0) delete opts[attr]; else opts[attr] = next;
  return { ...s, opts };
}

/** Everything but the search text, stock and type goes. */
export const clearFilters = (s: Selection): Selection => ({ ...s, models: [], opts: {}, lowOnly: false });

/** A card's state for the grid: how it is drawn and whether it can be added. */
export function cardState(i: Pick<FacetItem, "on_hand" | "price">): "out" | "low" | "ok" {
  return i.on_hand <= 0 ? "out" : i.on_hand <= LOW_STOCK ? "low" : "ok";
}

/**
 * When two variants are the same physical thing.
 *
 * A shop with history has 42MM and 42 as two Size values, so "42MM / Black"
 * and "42 / Black" are two combinations of one watch. A value is compared as
 * a fact: case, spaces and punctuation dropped, and a unit after a number
 * dropped. Kept in step with fn_variant_value_norm (migration 0150), which
 * reports group by.
 */
export function physicalValue(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.]/g, "")
    .replace(/^(\d+(?:\.\d+)?)(mm|cm|in|inch|inches|gb|tb)$/, "$1");
}

/** One combination's identity: each attribute with its value as a fact. */
export function physicalKey(parts: { attributeId: string; name: string }[]): string {
  return [...parts].sort((a, b) => a.attributeId.localeCompare(b.attributeId))
    .map((p) => `${p.attributeId}=${physicalValue(p.name)}`).join(";");
}

/**
 * Which combinations repeat an earlier one: index → the index it repeats.
 * The first of a group is the one kept as is; each later one needs someone
 * to decide.
 */
export function repeats(keys: string[]): Map<number, number> {
  const first = new Map<string, number>();
  const out = new Map<number, number>();
  keys.forEach((k, i) => {
    const at = first.get(k);
    if (at === undefined) first.set(k, i); else out.set(i, at);
  });
  return out;
}

/**
 * When two variants are the same physical thing.
 *
 * A shop with history has 42MM and 42 as two Size values, so "42MM / Black"
 * and "42 / Black" are two combinations of one watch. Each value stores what
 * it physically is (variant_option.physical_value, migration 0151) beside the
 * name it is shown by; combinations are compared on that.
 */

/** One combination's identity: each attribute with its physical value. */
export function physicalKey(parts: { attributeId: string; physical: string }[]): string {
  return [...parts].sort((a, b) => a.attributeId.localeCompare(b.attributeId))
    .map((p) => `${p.attributeId}=${p.physical}`).join(";");
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

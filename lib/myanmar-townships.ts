/**
 * Customers' townships, as typed, to the map's township names (2026-11-27,
 * checked with the owner). Customer records stay as they are; this table is
 * the only place a spelling is reconciled. Keys are lower-case letters only.
 */
export const TOWNSHIP_ALIAS: Record<string, string> = {
  taungyi: "Taunggyi", loilem: "Loilen", mogok: "Mogoke", monghnyin: "Mohnyin",
  yinmabin: "Yinmarbin", minpyar: "Minbya", ayartaw: "Ayadaw",
  // Towns inside a township: drawn as that township.
  bagan: "Nyaung-U", aungpann: "Kalaw", aungban: "Kalaw", kume: "Myittha",
  kanhtuma: "Taze", kaduma: "Taze",
};

/** Cities that span several townships: drawn as a dot, not a shape. */
export const CITY_KEYS = new Set(["mandalay", "yangon", "naypyitaw", "naypyidaw"]);

export const placeKey = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** The map's name for a customer's township key, or the key itself when it needs no fixing. */
export const mapTownshipKey = (township: string) => {
  const k = placeKey(township);
  return TOWNSHIP_ALIAS[k] ? placeKey(TOWNSHIP_ALIAS[k]) : k;
};

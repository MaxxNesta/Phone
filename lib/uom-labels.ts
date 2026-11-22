/**
 * Unit-of-measure words, Myanmar first and English after (owner, 2026-11-19):
 * the counter reads Myanmar; the English term is the one suppliers and ERP
 * manuals use. Shown the same in both languages.
 */
export const UOM = {
  base: "အခြေခံယူနစ် · Base UoM",
  alt: "အခြားယူနစ်များ · Alternative UoMs",
  factor: "ပြောင်းလဲနှုန်း · Conversion factor",
  buy: "ဝယ်ယူသည့်ယူနစ် · Purchase UoM",
  sellsAt: "ရောင်းဈေး · Sells at",
  barcode: "ဘားကုဒ် · Barcode",
  pack: "ယူနစ် · Unit",
  equals: "ညီမျှ · Equals",
  whole: "အပြည့်သာ · Whole only",
  conversions: "ယူနစ်ပြောင်းလဲမှု · Conversions",
  stockUnit: "အခြေခံ · base",
} as const;

/** A unit as people say it: its Myanmar name, then its code — "ဗူး (BOX)". */
export const unitLabel = (u: { code: string; name?: string | null; name_my?: string | null }) =>
  u.name_my ? `${u.name_my} (${u.code})` : u.name ? `${u.name} (${u.code})` : u.code;

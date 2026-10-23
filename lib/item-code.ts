/**
 * An item's code: its category's code, a hyphen, then its own piece.
 *
 * The hyphen is what keeps codes apart. Without it category 1 + item 23 and
 * category 12 + item 3 would both be 123; with it they are 1-23 and 12-3.
 * Must match fn_set_item_code (migration 0139). A category code that already
 * ends in a separator, or an empty one, gets no second hyphen.
 */
export const composeItemCode = (groupCode: string, serial: string) =>
  !groupCode || /[-._/]$/.test(groupCode) ? groupCode + serial : `${groupCode}-${serial}`;

/** A model code variants are numbered under: IPC, LTC, NTG. */
export const MODEL_CODE = /^[A-Z0-9][A-Z0-9._/-]{0,29}$/;

/** A model code's variant: IPC + 7 → IPC007. Three digits, more when needed. */
export const modelItemCode = (prefix: string, n: number) => prefix + String(n).padStart(3, "0");

/**
 * The first number not yet used after `prefix` in this company — IPC007 in
 * use makes it 8. Takes the connection so it works inside a transaction; the
 * caller holds the lock that stops two saves taking the same number.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function firstFreeNumber(db: any, co: string, prefix: string): Promise<number> {
  const [r] = await db`
    select coalesce(max(substring(code from ${prefix.length + 1}::int)::bigint), 0) + 1 as n
      from item
     where company_id = ${co} and left(code, ${prefix.length}::int) = ${prefix}
       and substring(code from ${prefix.length + 1}::int) ~ '^[0-9]{1,12}$'`;
  return Number(r.n);
}

/**
 * How an option reads in a variant's name and the preview: a region is its
 * code alone — "LL/A – USA" becomes "LL/A" — so "iPhone 17 256 GB / Black /
 * LL/A" stays short. RAM says it is RAM — "256 GB / 8 GB" would not say
 * which is which. The chips keep the plain name for choosing.
 */
export const optionLabel = (attributeName: string, optionName: string) =>
  /region|market/i.test(attributeName) ? optionName.split(/\s+[–—-]\s+/)[0]
  : /^ram$/i.test(attributeName.trim()) && !/ram/i.test(optionName) ? `${optionName} RAM`
  : optionName;

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

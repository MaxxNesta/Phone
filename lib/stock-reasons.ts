/**
 * Why stock moved, in words a shopkeeper can act on.
 *
 * The inventory reconciliation groups every movement through the inventory
 * account by the document that made it, the account on the other side and
 * whether the document was a void. This turns each group into a reason —
 * "7 voided goods receipts", "returned by customers", "counter sales" — with
 * whether it is cost of goods sold and, where it calls for one, what to do.
 * Shared by the Inventory & cost of sales report and the income statement's
 * cost-of-sales panel, so both explain a figure the same way.
 */

export type Movement = {
  account_id: string | null; code: string | null; name: string | null; account_type: string | null;
  source_type: string; voided?: boolean | null;
  into_stock: string | number; out_of_stock: string | number; entries: number;
};

export type Reason = {
  key: string;
  /** "7 voided goods receipts" */
  label: string;
  /** One line on what it is, and what to do about it if anything. */
  detail: string;
  value: number;
  entries: number;
  isCogs: boolean;
  /** Worth a second look: voids, write-offs, manual journals. */
  attention: boolean;
};

const n = (v: unknown) => Number(v ?? 0);
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const many = (k: number, one: string, more: string) => `${k} ${k === 1 ? one : more}`;

type Rule = { key: string; label: (k: number) => string; detail: string; isCogs?: boolean; attention?: boolean };

/** The reason for one group, by direction. */
function rule(m: Movement, dir: "in" | "out", roles: { cogsId: string | null; heldId: string | null }): Rule {
  const t = m.source_type;
  if (m.voided) {
    const what = ({
      GOODS_RECEIPT: ["voided goods receipt", "voided goods receipts", "A receipt was undone, so its goods came off the shelf again. Check each void was meant."],
      SALES_INVOICE: ["voided sale", "voided sales", "A sale was undone and its goods went back on the shelf. Its cost of sales was reversed with it."],
      DELIVERY: ["voided delivery", "voided deliveries", "A delivery was undone and its goods went back on the shelf."],
      PURCHASE_INVOICE: ["voided bill", "voided bills", "A bill that received goods was undone."],
      PURCHASE_RETURN: ["voided supplier return", "voided supplier returns", "A return to a supplier was undone, so the goods are back in stock."],
      SALES_RETURN: ["voided customer return", "voided customer returns", "A customer return was undone, so the goods left stock again."],
      STOCK_ADJUSTMENT: ["voided stock adjustment", "voided stock adjustments", "A count adjustment was undone."],
    } as Record<string, [string, string, string]>)[t];
    return what
      ? { key: `void-${t}`, label: (k) => many(k, what[0], what[1]), detail: what[2], attention: true }
      : { key: `void-${t}`, label: (k) => many(k, "voided document", "voided documents"), detail: "Undone documents.", attention: true };
  }
  switch (t) {
    case "GOODS_RECEIPT":
      return dir === "in"
        ? { key: "received", label: () => "Goods received from suppliers", detail: "Bought stock arriving. It becomes cost of sales only when sold." }
        : { key: "receipt-out", label: () => "Goods receipt corrections", detail: "A receipt that took value off stock.", attention: true };
    case "PURCHASE_INVOICE":
      return { key: `bill-${dir}`, label: () => dir === "in" ? "Bill price differences added to stock" : "Bill price differences taken off stock",
               detail: "A supplier billed a different price from the receipt; the difference was put on the goods still held." };
    case "LANDED_COST":
      return { key: "landed", label: () => "Freight and import costs added", detail: "Carriage, duty and the like spread onto the goods they brought in." };
    case "SALES_INVOICE":
      return dir === "out"
        ? { key: "counter", label: () => "Counter sales", detail: "Sold at the till: the invoice took the goods and their cost in one step.", isCogs: true }
        : { key: "sale-in", label: () => "Sales adjustments back to stock", detail: "Stock put back by a sales invoice." };
    case "DELIVERY":
      return dir === "out"
        ? { key: "delivered", label: () => "Delivered to customers", detail: "Goods sent out; their cost reaches cost of sales when billed.", isCogs: true }
        : { key: "delivery-in", label: () => "Delivery corrections", detail: "Stock put back by a delivery." };
    case "SALES_RETURN":
      return { key: "cust-return", label: () => "Returned by customers", detail: "Goods brought back; their cost came off cost of sales." };
    case "PURCHASE_RETURN":
      return { key: "supp-return", label: () => "Returned to suppliers", detail: "Goods sent back; not cost of sales." };
    case "STOCK_ADJUSTMENT":
      return dir === "out"
        ? { key: "writeoff", label: () => "Written off or counted short", detail: "Lost, damaged or missing at a count. Not cost of sales — worth knowing why.", attention: true }
        : { key: "found", label: () => "Counted over (found at a count)", detail: "More on the shelf than the books said." };
    case "STOCK_TRANSFER":
      return { key: `transfer-${dir}`, label: () => dir === "out" ? "Moved out to another warehouse" : "Moved in from another warehouse",
               detail: "Between your own warehouses; the company total does not change." };
    case "OPENING_BALANCE":
      return { key: "opening", label: () => "Opening stock entered", detail: "Stock brought into the books when you started." };
    case "JOURNAL_VOUCHER":
    case "CASH_VOUCHER":
    case "BANK_VOUCHER":
      return { key: `journal-${dir}`, label: (k) => many(k, "manual journal entry", "manual journal entries"),
               detail: "Posted to the inventory account by hand, so no stock moved with it. This is the usual reason the stock ledger and the account disagree.",
               attention: true };
  }
  // Out to an expense account that is not cost of sales: a giveaway or sample.
  if (dir === "out" && m.account_type === "EXPENSE") {
    return { key: "giveaway", label: () => "Given away (promotion, sample, free of charge)", detail: "Stock that left without a sale; charged to its reason's expense account." };
  }
  const isCogs = dir === "out" && m.account_id != null && (m.account_id === roles.cogsId || m.account_id === roles.heldId);
  return { key: `other-${t}-${dir}`, label: () => t.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
           detail: m.code ? `Against ${m.code} · ${m.name}.` : "Stock movement.", isCogs };
}

/** Additions and releases, each grouped by reason, largest first. */
export function stockReasons(movement: Movement[], roles: { cogsId: string | null; heldId: string | null }) {
  const group = (dir: "in" | "out") => {
    const by = new Map<string, Reason & { rule: Rule }>();
    for (const m of movement) {
      const v = n(dir === "in" ? m.into_stock : m.out_of_stock);
      if (v <= 0) continue;
      const r = rule(m, dir, roles);
      const x = by.get(r.key) ?? { key: r.key, label: "", detail: r.detail, value: 0, entries: 0,
                                   isCogs: !!r.isCogs, attention: !!r.attention, rule: r };
      x.value = r4(x.value + v); x.entries += m.entries ?? 0;
      by.set(r.key, x);
    }
    return [...by.values()]
      .map(({ rule: r, ...x }) => ({ ...x, label: r.label(x.entries) }))
      .sort((a, b) => b.value - a.value);
  };
  return { additions: group("in"), releases: group("out") };
}

/**
 * Why two figures differ, as far as the movements can say: the items that
 * account for the gap, and whatever is left that nothing here explains.
 */
export function explainGap(gap: number, items: { label: string; value: number; detail: string }[]) {
  const found = items.filter((i) => r4(i.value) !== 0);
  const explained = r4(found.reduce((t, i) => t + i.value, 0));
  return { items: found, unexplained: r4(gap - explained) };
}

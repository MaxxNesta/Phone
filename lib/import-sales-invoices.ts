/**
 * Checking the old system's sales invoice report before it posts.
 *
 * The report reads like the purchase one (parsePurchaseReport reads both), and
 * is checked by the same checker (planInvoices): the old id, the date, each
 * line's item, amount and serials, the totals, discounts, free lines and the
 * payment. What a sale adds is its stock: every phone sold must be in stock,
 * at the warehouse it is sold from, received before the day it is sold. A sale
 * cannot take a phone the books never received, nor one that arrives after it
 * — so a January sale finds its stock only once the January purchases are in.
 *
 * Pure, like the purchase checker: text and master data in, a verdict out.
 */
import {
  netOf, planInvoices,
  type Mapping, type PlannedInvoice, type SourceInvoice,
} from "./import-purchase-invoices";

export type SalesImportMaster = {
  customers: { id: string; code: string; name: string }[];
  locations: { id: string; code: string; name: string }[];
  items: { id: string; code: string; name: string; is_active: boolean; tracks_serial: boolean; identity: "IMEI" | "SERIAL" | "OPTIONAL" | "NONE" }[];
  /** Cash and bank accounts money taken with the sale may go into. */
  payAccounts: { id: string; code: string; name: string }[];
  /** The giveaway reason a free line on a sale posts under, when one is set up. */
  focId: string | null;
  focName: string | null;
  /** Old ids this file names that are already posted here as sales. */
  known: { ref: string; doc_no: string; kind: "POSTED" | "HISTORY" }[];
  /** The units this file names that the system knows: what each is, where, whether it is on the shelf, since when. */
  units: { serial: string; item_code: string; status: string; location_id: string | null; location: string | null; received_on: string | null; out_doc_no: string | null }[];
};

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function planSalesImport(source: SourceInvoice[], master: SalesImportMaster, mapping: Mapping): PlannedInvoice[] {
  const units = new Map(master.units.map((u) => [u.serial, u]));
  return planInvoices(source, {
    parties: master.customers, items: master.items, known: master.known,
    focId: master.focId,
    noFoc: "A line at nothing is a giveaway, but no giveaway reason is set up to post it under.",
    foreign: (c) => ({ level: "error", field: "Currency", message: `In ${c}: imported sales post in kyat only.` }),
    discount: (t) => {
      const d = t.itemDiscount + t.voucherDiscount;
      return d > 0 ? `${fmt(d)} discount: spread over the lines in proportion to their amounts, so the invoice nets to the same figure.` : null;
    },
    // A phone is sold from stock: received, here, before this day, and not already gone.
    serial: (x, it, at, err) => {
      const u = units.get(x);
      if (!u) return err(`${x} has never been received — import the purchase that brought it in first.`);
      if (it && u.item_code !== it.code) err(`${x} is a ${u.item_code}, not ${it.code}.`);
      if (u.status !== "IN_STOCK") err(`${x} is not on the shelf (${u.status.replace(/_/g, " ").toLowerCase()}${u.out_doc_no ? ` on ${u.out_doc_no}` : ""}).`);
      else if (at.locationId && u.location_id && u.location_id !== at.locationId) err(`${x} is at ${u.location ?? "another warehouse"}, not the one this sale is from.`);
      if (at.postDate && u.received_on && u.received_on > at.postDate) err(`${x} was received on ${u.received_on}, after this sale (${at.postDate}).`);
    },
    remark: (s) => [s.remark, s.salesman ? `Salesman: ${s.salesman}` : null].filter(Boolean).join(" · ") || null,
  }, mapping, master.locations);
}

/**
 * The report's discounts as each line's own: the old system gives them only
 * as totals, a sale takes them per line. Shared by amount, whole kyat, the
 * odd kyat to the largest line, so the lines net to the report's figure.
 */
export function lineDiscounts(amounts: number[], discount: number): number[] {
  const total = amounts.reduce((a, b) => a + b, 0);
  if (!(discount > 0) || !(total > 0)) return amounts.map(() => 0);
  const parts = amounts.map((a) => Math.floor((discount * a) / total));
  let big = 0;
  for (let i = 1; i < amounts.length; i++) if (amounts[i] > amounts[big]) big = i;
  parts[big] += Math.round(discount - parts.reduce((a, b) => a + b, 0));
  return parts;
}

export { netOf };

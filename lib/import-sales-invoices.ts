/**
 * Checking the old system's sales invoice report before it posts.
 *
 * The report reads like the purchase one (parsePurchaseReport reads both): a
 * block per invoice — Docid, Customer, Payment (Crd / Csh), Location — its
 * lines with the IMEIs under each, and the totals. What differs is what a sale
 * needs: every phone sold must be in stock, at the warehouse it is sold from,
 * received before the day it is sold. A sale cannot take a phone the books
 * never received, nor one that arrives after it — so a January sale finds its
 * stock only once the January purchases are in.
 *
 * Pure, like the purchase checker: text and master data in, a verdict out.
 */
import {
  ERP_START, luhnOk, match, netOf, norm, reportDate, resolved,
  type Issue, type Mapping, type PlannedInvoice, type PlannedLine, type SourceInvoice,
} from "./import-purchase-invoices";

export type SalesImportMaster = {
  customers: { id: string; code: string; name: string }[];
  locations: { id: string; code: string; name: string }[];
  items: { id: string; code: string; name: string; is_active: boolean; tracks_serial: boolean; identity: "IMEI" | "SERIAL" | "OPTIONAL" | "NONE" }[];
  /** Cash and bank accounts money taken with the sale may go into. */
  payAccounts: { id: string; code: string; name: string }[];
  /** Old ids this file names that are already posted here as sales. */
  known: { ref: string; doc_no: string; kind: "POSTED" | "HISTORY" }[];
  /** The units this file names that the system knows: what each is, where, whether it is on the shelf, since when. */
  units: { serial: string; item_code: string; status: string; location_id: string | null; location: string | null; received_on: string | null; out_doc_no: string | null }[];
};

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function planSalesImport(source: SourceInvoice[], master: SalesImportMaster, mapping: Mapping): PlannedInvoice[] {
  const items = new Map(master.items.map((i) => [norm(i.code), i]));
  const known = new Map(master.known.map((k) => [norm(k.ref), k]));
  const units = new Map(master.units.map((u) => [u.serial, u]));
  const firstSeen = new Map<string, string>();
  const refCount = new Map<string, number>();
  for (const s of source) if (s.oldRef) refCount.set(norm(s.oldRef), (refCount.get(norm(s.oldRef)) ?? 0) + 1);

  return source.map((s, idx) => {
    const issues: Issue[] = [];
    const err = (field: string, message: string) => issues.push({ level: "error", field, message });
    const review = (field: string, message: string) => issues.push({ level: "review", field, message });
    const label = s.oldRef || `Invoice ${idx + 1}`;

    if (!s.oldRef) review("Docid", "No old document ID — nothing will stop this invoice being posted again from another file.");
    else if (refCount.get(norm(s.oldRef))! > 1) err("Docid", `${s.oldRef} appears more than once in this file.`);
    const date = reportDate(s.rawDate);
    if (!date) err("Date", s.rawDate ? `"${s.rawDate}" is not a date.` : "The invoice has no date.");
    else if (date < ERP_START) review("Date", `Dated before the company start: posts on ${ERP_START}, with its own date kept on the invoice as a note.`);
    const postDate = date && date < ERP_START ? ERP_START : date;
    if (s.lines.length === 0) err("Products", "No product lines were found under this invoice.");

    const location = match(s.location, master.locations, mapping.locations[s.location]);
    const where = resolved(location, mapping.locations);

    const lines: PlannedLine[] = s.lines.map((l, n) => {
      const it = items.get(norm(l.code));
      const at = `Line ${n + 1} (${l.code})`;
      if (!it) err(at, `No item is coded ${l.code} in the catalogue.`);
      else if (!it.is_active) err(at, `${it.code} is inactive. Reactivate it before posting.`);
      if (!(l.qty > 0)) err(at, "Quantity must be more than zero.");
      if (Math.abs(l.qty * l.unitPrice - l.amount) > Math.max(1, l.amount * 1e-6))
        err(at, `${l.qty} × ${fmt(l.unitPrice)} is not the amount ${fmt(l.amount)}.`);
      if (l.count !== null && l.count !== l.serials.length)
        review(at, `The report counts ${l.count} serials; ${l.serials.length} were read.`);
      const kind = it?.identity === "SERIAL" ? "serial numbers" : "IMEIs";
      if (it?.tracks_serial && l.serials.length !== l.qty) err(at, `${l.qty} units need ${l.qty} ${kind}; ${l.serials.length} found.`);
      if (it?.identity === "OPTIONAL" && l.serials.length > l.qty) err(at, `${l.serials.length} serials for ${l.qty} units.`);
      if (it?.identity === "NONE" && l.serials.length > 0) review(at, `${it.code} carries no serial; its ${l.serials.length} will be kept as a note.`);
      const dup = l.serials.filter((x, k) => l.serials.indexOf(x) !== k);
      if (dup.length) err(at, `${dup[0]} appears twice on this line.`);
      if (it?.identity !== "NONE") for (const x of new Set(l.serials)) {
        if (it?.identity === "IMEI" && !/^\d{15}$/.test(x)) err(at, `${x} is not an IMEI — an IMEI is 15 digits.`);
        else if (/^\d{15}$/.test(x) && !luhnOk(x)) review(at, `IMEI ${x} fails its check digit — a typo in the old system?`);
        const other = firstSeen.get(x);
        if (other && other !== label) err(at, `${x} is also sold on ${other} in this file.`);
        else firstSeen.set(x, label);
        // A phone is sold from stock: received, here, before this day, and not already gone.
        const u = units.get(x);
        if (!u) { err(at, `${x} has never been received — import the purchase that brought it in first.`); continue; }
        if (it && u.item_code !== it.code) err(at, `${x} is a ${u.item_code}, not ${it.code}.`);
        if (u.status !== "IN_STOCK") err(at, `${x} is not on the shelf (${u.status.replace(/_/g, " ").toLowerCase()}${u.out_doc_no ? ` on ${u.out_doc_no}` : ""}).`);
        else if (where && u.location_id && u.location_id !== where) err(at, `${x} is at ${u.location ?? "another warehouse"}, not the one this sale is from.`);
        if (postDate && u.received_on && u.received_on > postDate) err(at, `${x} was received on ${u.received_on}, after this sale (${postDate}).`);
      }
      return { ...l, itemId: it?.id ?? null, itemName: it?.name ?? null, tracksSerial: !!it?.tracks_serial, identity: it?.identity ?? null,
        free: l.qty > 0 && l.unitPrice === 0 && l.amount === 0 };
    });

    const lineTotal = s.lines.reduce((a, l) => a + l.amount, 0);
    const t = s.totals;
    if (t.invoiceTotal !== null && Math.abs(t.invoiceTotal - lineTotal) > 1)
      err("Invoice total", `Lines add up to ${fmt(lineTotal)}; the report's total is ${fmt(t.invoiceTotal)}.`);
    const net = (t.invoiceTotal ?? lineTotal) - t.itemDiscount - t.voucherDiscount;
    if (t.netTotal !== null && Math.abs(t.netTotal - net) > 1)
      err("Net amount", `Total less discounts is ${fmt(net)}; the report says ${fmt(t.netTotal)}.`);
    if (t.itemDiscount > 0 || t.voucherDiscount > 0)
      err("Discount", "This invoice carries a discount; imported sales with discounts are not posted yet. Enter it by hand.");
    if (lines.some((l) => l.free)) err("Products", "A line at nothing (a giveaway) is not imported yet. Enter it by hand.");
    if (t.paidAmount > net + 1) err("Paid amount", `${fmt(t.paidAmount)} paid is more than the invoice's ${fmt(net)}.`);
    if (t.advancePay > 0)
      review("Advance pay", `${fmt(t.advancePay)} was settled from an advance in the old system. It is not applied here — apply the customer's advance to this invoice after posting.`);
    if (/^c(a)?sh/i.test(s.payment ?? "") && t.paidAmount === 0)
      review("Payment", "Marked Cash, but the report shows nothing paid. It posts as owing; record the payment separately.");
    if (t.currency !== "MMK") err("Currency", `In ${t.currency}: imported sales post in kyat only.`);

    const k = s.oldRef ? known.get(norm(s.oldRef)) : undefined;
    return {
      row: s.row, oldRef: s.oldRef, supplierInvoiceNo: s.supplierInvoiceNo, date, rawDate: s.rawDate, postDate,
      payment: s.payment, remark: [s.remark, s.salesman ? `Salesman: ${s.salesman}` : null].filter(Boolean).join(" · ") || null,
      supplier: match(s.supplier, master.customers, mapping.suppliers[s.supplier]),
      location, lines, totals: { ...t, lines: lineTotal }, issues,
      already: k ? { docNo: k.doc_no, kind: k.kind } : null,
    };
  });
}

export { netOf };

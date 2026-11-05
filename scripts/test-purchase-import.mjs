// Reading the old system's purchase-invoice report.
//
//   npx tsx scripts/test-purchase-import.mjs
//
// Parser and checks only — pure, writes nothing. The sample is the report as
// pasted from Excel (cells split by tabs), merged cells and all.

const { parsePurchaseReport, planPurchaseImport, invoiceStatus, reportDate, luhnOk, netOf } =
  await import("../lib/import-purchase-invoices.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

const SAMPLE = `Docid : s126010003\tInvoiceNo :\tDate : 02/01/2026\t
Supplier : China\tPayment : Credit\t\t
Location : Main Store\tRemark : 29.12.25 purchase\t
Code\tDescription\tQty\t\tPur.price\tAmount\tType\tRemark\t
IPZ003\tIPhone 17 (256GB) ZA/A - Black\t4.00\t\t\t3,772,989.00\t15,091,956.00\t\t1142310\tCount :4
354630185148539, 354630185378847, 354630185399603, 354630185670334
IPZ002\tIPhone 17 (256GB) ZA/A - Green\t2.00\t\t\t3,813,218.00\t7,626,436.00\t\t1154490\tCount :2
355154914483058, 355154917917243
IPZ007\tIPhone 17 Pro Max (256GB) ZA/A - Silver\t4.00\t\t\t5,617,816.00\t22,471,264.00\t\t1700850\tCount :4
354856654239851, 357739162021788, 357739162135190, 357778146526256
IPZ004\tIPhone 17 Pro (256GB) ZA/A - Silver\t1.00\t\t\t5,198,276.00\t5,198,276.00\t\t1573830\tCount :1
359337732992832
Invoice Total\t11.00\t50,387,932.00\t\tPaid\tExg_Rate\tChange\t\t
Item Discount\t\t0.00\t\t\t\t\t\t
Voucher Discount\t\t0.00\tK\t50,387,932.00\t1.00\t\t\t
Advance Pay\t\t0.00\t\t\t\t\t\t
Paid Amount\t\t0.00\t0.00\t\t\t\t\t
Net Total\t\t50,387,932.00\tTotal Cash\t\t50,387,932.00\t\t
Invoice Total\t11.00\t\t\tK\t50,387,932.00\t\t
Item Discount\t\t\t\t\t0.00\t\t\t
Voucher Discount\t\t\t\t\t0.00\t\t\t
Advance Pay\t\t\t\t\t0.00\t\t\t
Paid Amount\t\t\t\t\t0.00\t\t\t
Net Total\t\t\t\t\t50,387,932.00\t\t\t`;

const rows = (text) => text.split("\n").map((l) => l.split("\t"));
const src = parsePurchaseReport(rows(SAMPLE));
const inv = src[0];

console.log("\n  Parsing\n");
check("one invoice", src.length === 1, String(src.length));
check("old reference", inv.oldRef === "s126010003", inv.oldRef);
check("no supplier invoice no.", inv.supplierInvoiceNo === null);
check("date read day first", reportDate(inv.rawDate) === "2026-01-02", inv.rawDate);
check("supplier, payment, location, remark",
  inv.supplier === "China" && inv.payment === "Credit" && inv.location === "Main Store" && inv.remark === "29.12.25 purchase",
  JSON.stringify([inv.supplier, inv.payment, inv.location, inv.remark]));
check("four lines", inv.lines.length === 4, String(inv.lines.length));
const l1 = inv.lines[0];
check("line 1 qty, price, amount", l1.code === "IPZ003" && l1.qty === 4 && l1.unitPrice === 3772989 && l1.amount === 15091956,
  JSON.stringify(l1));
check("line 1 remark and count", l1.remark === "1142310" && l1.count === 4);
check("line 1 IMEIs", l1.serials.length === 4 && l1.serials[0] === "354630185148539");
check("totals read once", inv.totals.qty === 11 && inv.totals.invoiceTotal === 50387932 && inv.totals.netTotal === 50387932,
  JSON.stringify(inv.totals));
check("currency K is MMK at 1.00", inv.totals.currency === "MMK" && inv.totals.exchangeRate === 1);

console.log("\n  Two invoices, Excel-typed cells\n");
const two = parsePurchaseReport([
  ["Docid :", "s1", "InvoiceNo :", "INV-9", "Date :", "2026-01-04"],
  ["Supplier :", "Thai", "Payment :", "Cash"],
  ["Location :", "Main Warehouse", "Remark :", ""],
  ["Code", "Description", "Qty", "Pur.price", "Amount"],
  ["IPZ003", "Black", "1", "100", "100"],
  ["354630185148539"],
  ["Invoice Total", "1", "100"],
  ["Docid : s2", "Date : 05/01/2026"],
  ["Supplier : Nobody", "Location : Nowhere"],
  ["Code", "Description", "Qty", "Pur.price", "Amount"],
  ["NOPE1", "Thing", "2", "50", "90"],
  ["Invoice Total", "2", "100"],
]);
check("two invoices", two.length === 2);
check("value in the next cell", two[0].oldRef === "s1" && two[0].supplierInvoiceNo === "INV-9" && two[0].supplier === "Thai");
check("label and value in one cell", two[1].oldRef === "s2" && two[1].supplier === "Nobody" && two[1].location === "Nowhere");

console.log("\n  Pasted, labels in their own cells\n");
const { parseTsv, invoiceBlocks } = await import("../lib/import-purchase-invoices.ts");
const PASTE = [
  "Docid\ts126010001\tDate\t01/01/2026", "Supplier\tChina\tPayment\tCredit", "Location\tMain Store",
  "Code\tDescription\tQty\tPur.price\tAmount", "IPC006\tiPhone 16 Pro (128GB) CH/A - Black\t5\t3,366,421\t16,832,105",
  "\t\"350657306659247, 351989738727535,\n355040520651214, 359135885267006, 359135886600353\"",
  "\t\tInvoice Total\t\t5\t16,832,105", "\t\tNet Total\t\t\t16,832,105", "",
  "Docid\ts126010002\tDate\t04/01/2026", "Supplier\tThai", "Location\tMain Store",
  "Code\tDescription\tQty\tPur.price\tAmount", "IPC006\tBlack\t1\t100\t100", "\t\tInvoice Total\t\t1\t100",
].join("\r\n");
const pr = parseTsv(PASTE);
const ps = parsePurchaseReport(pr);
check("quoted cell with a newline stays one cell", pr[5][1].includes("355040520651214"));
check("two pasted invoices", ps.length === 2);
check("colonless labels", ps[0].oldRef === "s126010001" && ps[0].supplier === "China" && ps[0].payment === "Credit"
  && ps[0].location === "Main Store" && reportDate(ps[0].rawDate) === "2026-01-01", JSON.stringify([ps[0].oldRef, ps[0].supplier, ps[0].payment]));
check("five IMEIs across a wrapped cell", ps[0].lines[0].serials.length === 5);
check("totals with the label mid-row", ps[0].totals.invoiceTotal === 16832105 && ps[0].totals.netTotal === 16832105);
const bl = invoiceBlocks(pr);
check("where each invoice starts and ends", bl.length === 2 && bl[0].start === 0 && bl[0].end === 7 && bl[1].start === 9 && bl[1].end === 14,
  JSON.stringify(bl));

console.log("\n  A paste that lost its line breaks\n");
{
  const flat = PASTE.split(/\r?\n/).join("\t");
  const a = parsePurchaseReport(parseTsv(PASTE)), b = parsePurchaseReport(parseTsv(flat));
  check("one long line reads as the rows it was", b.length === 2 && JSON.stringify(b.map((i) => [i.oldRef, i.supplier, i.location, i.lines.map((l) => [l.code, l.qty, l.amount, l.serials.length]), i.totals.invoiceTotal]))
    === JSON.stringify(a.map((i) => [i.oldRef, i.supplier, i.location, i.lines.map((l) => [l.code, l.qty, l.amount, l.serials.length]), i.totals.invoiceTotal])),
    JSON.stringify(b.map((i) => [i.oldRef, i.lines.length])));
  const sample = parsePurchaseReport(parseTsv(SAMPLE.split("\n").join("\t")));
  check("the purchase sample too, Count at the end of each line", sample.length === 1 && sample[0].lines.length === 4
    && sample[0].lines.every((l) => l.count === l.serials.length) && sample[0].totals.netTotal === 50387932, JSON.stringify(sample[0]?.lines.map((l) => [l.code, l.count, l.serials.length])));
  const noA = parsePurchaseReport(parseTsv("Description\tQty\tPur.price\tAmount\tType\tRemark\nIPhone 17 (256GB) ZA/A - Silver/White\t5.00\t3,727,011.00\t18,635,055.00\t\t1128390\tCount :5"));
  check("without column A there is no invoice to read", noA.length === 0);
  const coded = parsePurchaseReport(parseTsv("Docid : x1\tDate : 02/01/2026\nSupplier : China\nLocation : Main Warehouse\nDescription\tQty\tPur.price\tAmount\nIPZ003 name\t1.00\t100.00\t100.00\nInvoice Total\t1\t100"));
  check("a line with no code keeps its description and numbers", coded[0]?.lines[0]?.code === "" && coded[0].lines[0].description === "IPZ003 name" && coded[0].lines[0].qty === 1 && coded[0].lines[0].amount === 100,
    JSON.stringify(coded[0]?.lines));
}

console.log("\n  Checks\n");
const master = {
  suppliers: [{ id: "S-china", code: "01-001", name: "China", payment_terms_days: 30 }, { id: "S-thai", code: "01-002", name: "Thai", payment_terms_days: null }],
  locations: [{ id: "L-main", code: "MAIN-WH", name: "Main Warehouse" }],
  items: [...["IPZ002", "IPZ003", "IPZ004", "IPZ007"].map((c) => ({ id: `I-${c}`, code: c, name: c, is_active: true, tracks_serial: true, identity: "IMEI" })),
    { id: "I-MAC", code: "IPM001", name: "MacBook Air", is_active: true, tracks_serial: true, identity: "SERIAL" },
    { id: "I-OLD", code: "IPX999", name: "Old", is_active: false, tracks_serial: false, identity: "NONE" }],
  payAccounts: [{ id: "A-cash", code: "11101", name: "Cash" }],
  supplierFocId: "F-sup",
  known: [], historySerials: [], stockSerials: [],
};
const none = { suppliers: {}, locations: {} };
const [p] = planPurchaseImport(src, master, none);
check("sample has no errors", p.issues.filter((i) => i.level === "error").length === 0, JSON.stringify(p.issues));
check("supplier matched exactly", p.supplier.how === "exact" && p.supplier.id === "S-china");
check("Main Store guessed as Main Warehouse", p.location.how === "guess" && p.location.id === "L-main");
check("a guess waits for confirming", invoiceStatus(p, none) === "unmapped");
check("confirmed, it is ready", invoiceStatus(p, { suppliers: {}, locations: { "Main Store": "L-main" } }) === "ready");

const [, bad] = planPurchaseImport(two, master, none);
check("unknown item is an error", bad.issues.some((i) => i.level === "error" && /NOPE1/.test(i.message)));
check("qty × price ≠ amount is an error", bad.issues.some((i) => /is not the amount/.test(i.message)));
check("unknown supplier is unmatched", bad.supplier.how === "none");

const short = parsePurchaseReport(rows(SAMPLE.replace("354630185378847, ", "")));
check("missing IMEI blocks", invoiceStatus(planPurchaseImport(short, master, none)[0], none) === "blocked");
const again = planPurchaseImport(src, { ...master, known: [{ ref: "S126010003", doc_no: "DP20260102001", kind: "POSTED" }] }, none)[0];
check("already posted is recognised", invoiceStatus(again, none) === "imported" && again.already.docNo === "DP20260102001");
const hist = planPurchaseImport(src, { ...master, known: [{ ref: "s126010003", doc_no: "HPI-2026-00001", kind: "HISTORY" }] }, none)[0];
check("a history record is never posted again", invoiceStatus(hist, none) === "imported" && hist.already.kind === "HISTORY");
check("Luhn", luhnOk("354630185148539") && !luhnOk("354630185148538"));

const mac = (serials, code = "IPM001") => planPurchaseImport(parsePurchaseReport([
  ["Docid", "m1", "Date", "06/01/2026"], ["Supplier", "China"], ["Location", "Main Warehouse"],
  ["Code", "Description", "Qty", "Pur.price", "Amount"], [code, "Mac", "2", "100", "200"], ["", serials],
  ["Invoice Total", "2", "200"]]), master, none)[0];
const m = mac("C02XK0ABJGH5, C02XK0ABJGH6");
check("Mac serials read as serials", m.lines[0].serials.length === 2 && invoiceStatus(m, none) === "ready", JSON.stringify(m.issues));
check("letters in an IMEI item's serial block", mac("C02XK0ABJGH5, C02XK0ABJGH6", "IPZ003").issues.some((i) => /is not an IMEI/.test(i.message)));
check("a 14-digit IMEI blocks", mac("35463018514853, 354630185378847", "IPZ003").issues.some((i) => /is not an IMEI/.test(i.message)));
const moved = planPurchaseImport(src, { ...master, stockSerials: [{ serial: "359337732992832", item_code: "IPZ009" }] }, none)[0];
check("an IMEI already received blocks", invoiceStatus(moved, none) === "blocked" && moved.issues.some((i) => /already in the system as IPZ009/.test(i.message)));

console.log("\n  Posting rules\n");
const one = (extra = [], code = "IPZ003", date = "06/01/2026") => parsePurchaseReport([
  ["Docid", "p1", "Date", date], ["Supplier", "China", "Payment", "Credit"], ["Location", "Main Warehouse"],
  ["Code", "Description", "Qty", "Pur.price", "Amount"], [code, "x", "1", "1000", "1000"], ["", "354630185148539"],
  ["Invoice Total", "1", "1000"], ...extra]);
const loc = { suppliers: {}, locations: {} };
{ const e = planPurchaseImport(one([], "IPZ003", "28/12/2025"), master, loc)[0]; check("a December bill posts on the company start", e.postDate === "2026-01-01" && e.date === "2025-12-28" && invoiceStatus(e, loc) === "review", JSON.stringify(e.issues)); }
check("an inactive item blocks", planPurchaseImport(one([], "IPX999"), master, loc)[0].issues.some((i) => /inactive/.test(i.message)));
const paid = planPurchaseImport(one([["Paid Amount", "", "400"]]), master, loc)[0];
check("a paid amount waits for its account", invoiceStatus(paid, loc) === "unmapped" && invoiceStatus(paid, { ...loc, payAccount: "A-cash" }) === "ready");
check("paid more than the bill blocks", invoiceStatus(planPurchaseImport(one([["Paid Amount", "", "1400"]]), master, loc)[0], { ...loc, payAccount: "A-cash" }) === "blocked");
check("an advance is flagged, not applied", planPurchaseImport(one([["Advance Pay", "", "300"]]), master, loc)[0].issues.some((i) => i.level === "review" && /advance/i.test(i.message)));
const disc = planPurchaseImport(one([["Voucher Discount", "", "100"], ["Net Total", "", "900"]]), master, loc)[0];
check("a discount reconciles to the net", netOf(disc) === 900 && invoiceStatus(disc, loc) === "ready", JSON.stringify(disc.issues));
check("a net that does not reconcile blocks", invoiceStatus(planPurchaseImport(one([["Voucher Discount", "", "100"], ["Net Total", "", "950"]]), master, loc)[0], loc) === "blocked");
const noRef = planPurchaseImport(parsePurchaseReport([["Docid", "", "Date", "06/01/2026"], ["Supplier", "China"], ["Location", "Main Warehouse"],
  ["Code", "Description", "Qty", "Pur.price", "Amount"], ["IPZ003", "x", "1", "1000", "1000"], ["", "354630185148539"], ["Invoice Total", "1", "1000"]]), master, loc)[0];
check("no old ID is allowed, flagged for review", invoiceStatus(noRef, loc) === "review");

// The sales import runs the same checker with a sale's own stock rules.
console.log("\n  Sales, on the same checker\n");
const { planSalesImport, lineDiscounts } = await import("../lib/import-sales-invoices.ts");
const shelf = { serial: "354630185148539", item_code: "IPZ003", status: "IN_STOCK", location_id: null, location: null, received_on: "2026-01-02", out_doc_no: null };
const sm = { customers: [{ id: "C1", code: "C0001", name: "China" }], locations: master.locations, items: master.items, payAccounts: [],
  focId: "F-promo", focName: "Promotional giveaway", known: [], units: [shelf] };
const sale = (extra = [], m = sm, lines = [["IPZ003", "x", "1", "1000", "1000"], ["", "354630185148539"]]) => planSalesImport(parsePurchaseReport([
  ["Docid", "c1", "Date", "06/01/2026"], ["Customer", "China", "Payment", "Crd"], ["Location", "Main Warehouse"],
  ["Code", "Description", "Qty", "Sale price", "Amount"], ...lines, ["Invoice Total", "1", "1000"], ...extra]), m, loc)[0];
check("a phone in stock sells", invoiceStatus(sale(), loc) === "ready", JSON.stringify(sale().issues));
check("a phone never received blocks", sale([], { ...sm, units: [] }).issues.some((i) => /never been received/.test(i.message)));
check("a phone received after the sale blocks", sale([], { ...sm, units: [{ ...shelf, received_on: "2026-01-09" }] }).issues.some((i) => /after this sale/.test(i.message)));
const sd = sale([["Voucher Discount", "", "100"], ["Net Total", "", "900"]]);
check("a discount on a sale is taken, for review", invoiceStatus(sd, loc) === "review" && netOf(sd) === 900, JSON.stringify(sd.issues));
const gift = (m) => sale([], m, [["IPZ003", "x", "1", "1000", "1000"], ["", "354630185148539"], ["AKN01", "charger", "1", "0", "0"]]);
const gm = { ...sm, items: [...sm.items, { id: "I-akn", code: "AKN01", name: "charger", is_active: true, tracks_serial: false, identity: "NONE" }] };
check("a free line on a sale posts as a giveaway", gift(gm).lines[1].free && invoiceStatus(gift(gm), loc) === "ready", JSON.stringify(gift(gm).issues));
check("a free line with no giveaway reason blocks", invoiceStatus(gift({ ...gm, focId: null }), loc) === "blocked");
const parts = lineDiscounts([3000, 1000, 0], 101);
check("a discount is shared by amount and adds back", parts.reduce((a, b) => a + b, 0) === 101 && parts[2] === 0 && parts[0] > parts[1], JSON.stringify(parts));

console.log(failures ? `\n  ${failures} FAILED\n` : "\n  all passed\n");
process.exit(failures ? 1 : 0);

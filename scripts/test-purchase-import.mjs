// Reading the old system's purchase-invoice report.
//
//   npx tsx scripts/test-purchase-import.mjs
//
// Parser and checks only — pure, writes nothing. The sample is the report as
// pasted from Excel (cells split by tabs), merged cells and all.

const { parsePurchaseReport, planPurchaseImport, invoiceStatus, reportDate, luhnOk } =
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

console.log("\n  Checks\n");
const master = {
  suppliers: [{ id: "S-china", code: "01-001", name: "China" }, { id: "S-thai", code: "01-002", name: "Thai" }],
  locations: [{ id: "L-main", code: "MAIN-WH", name: "Main Warehouse" }],
  items: ["IPZ002", "IPZ003", "IPZ004", "IPZ007"].map((c) => ({ id: `I-${c}`, code: c, name: c, tracks_serial: true })),
  importedRefs: [], importedSerials: [],
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
const again = planPurchaseImport(src, { ...master, importedRefs: ["S126010003"] }, none)[0];
check("already imported is recognised", invoiceStatus(again, none) === "imported");
const dupe = planPurchaseImport(src, { ...master, importedSerials: ["359337732992832"] }, none)[0];
check("IMEI on an earlier import blocks", invoiceStatus(dupe, none) === "blocked");
check("Luhn", luhnOk("354630185148539") && !luhnOk("354630185148538"));

console.log(failures ? `\n  ${failures} FAILED\n` : "\n  all passed\n");
process.exit(failures ? 1 : 0);

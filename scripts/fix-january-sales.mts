// January 2026 sales made whole (2026-11-26). The "Sales by each invoice with
// serial" report left out lines without serials: 11 accessory invoices and
// the accessory lines of 9 others (88,777,000). The full report (RPT_SALESUMMARYBYEACHINV)
// has every line but no serials. So: every line from the full report, each
// line's IMEIs from the serial report (same invoice, same item, in order);
// the 9 short invoices voided (on their own date, goods back) and posted
// again whole; the 11 missing posted. DEV only unless --force; --dry checks.
import ExcelJS from "exceljs";
import { sql } from "../lib/db";
import { parsePurchaseReport, invoiceStatus, type SourceInvoice, type Mapping } from "../lib/import-purchase-invoices";
import { planSalesImport } from "../lib/import-sales-invoices";
import { getSalesImportMaster, postImportedSales } from "../lib/sales-import";
import { voidDocument } from "../lib/posting";

const dry = process.argv.includes("--dry");
const [co] = await sql`select id, name from company order by created_at limit 1`;
if (!/\bDEV\b/.test(co.name) && !process.argv.includes("--force")) throw new Error(`${co.name} is not DEV`);
const text = (v: any): string => v == null ? "" : typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : v instanceof Date ? v.toISOString().slice(0, 10) : "result" in v ? text(v.result) : "richText" in v ? v.richText.map((r: any) => r.text).join("").trim() : String(v).trim();
async function rows(f: string) { const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(f); const out: string[][] = []; let w = 0;
  for (const ws of wb.worksheets) ws.eachRow({ includeEmpty: false }, (row) => { const c: string[] = []; row.eachCell({ includeEmpty: true }, (x: any) => c.push(x.isMerged && x.master !== x ? "" : text(x.value))); w = Math.max(w, c.length); out.push(c); });
  for (const r of out) while (r.length < w) r.push(""); return out.filter((r) => r.some((c) => c)); }

const full = parsePurchaseReport(await rows("D:/phone/RPT_SALESUMMARYBYEACHINV 26.11.26.xlsx"));
const withSerial = new Map(parsePurchaseReport(await rows("D:/phone/Sales by each invoice with serial.xlsx")).map((s) => [s.oldRef.toLowerCase(), s]));
const total = (i: SourceInvoice) => i.totals.invoiceTotal ?? 0;
const missing = full.filter((f) => !withSerial.has(f.oldRef.toLowerCase()));
const short = full.filter((f) => withSerial.has(f.oldRef.toLowerCase()) && Math.abs(total(f) - total(withSerial.get(f.oldRef.toLowerCase())!)) > 0.5);
// Each line takes its IMEIs from the serial report's line of the same item and quantity.
const merged = [...short, ...missing].map((f) => {
  const s = withSerial.get(f.oldRef.toLowerCase());
  const pool = s ? s.lines.map((l) => ({ ...l, used: false })) : [];
  return { ...f, lines: f.lines.map((l) => { const m = pool.find((x) => !x.used && x.code === l.code && x.qty === l.qty); if (m) m.used = true; return { ...l, serials: m?.serials ?? [] }; }) };
});
console.log(`${co.name}: ${short.length} short, ${missing.length} missing · full report ${full.reduce((t, i) => t + total(i), 0).toLocaleString()}`);

const [wh] = await sql`select id from location where company_id = ${co.id} and code = 'MAIN-WH'`;
const mapping: Mapping = { suppliers: {}, locations: { "Main Store": wh.id as string } };
const named = { refs: merged.map((i) => i.oldRef), serials: merged.flatMap((i) => i.lines.flatMap((l) => l.serials)) };

if (dry) {
  // As if the short ones were already voided: the plan treats their old ids as posted, so only the missing are judged here.
  const plan = planSalesImport(merged, await getSalesImportMaster(co.id, named) as never, mapping);
  for (const p of plan) console.log(" ", p.oldRef, invoiceStatus(p, mapping), p.issues.filter((i) => i.level === "error").map((i) => i.message).slice(0, 2).join("; "));
  await sql.end(); process.exit(0);
}

// 1. The short ones out, each on its own date, goods back on the shelf.
for (const f of short) {
  const [doc] = await sql`select id, doc_no from document where company_id = ${co.id} and doc_type = 'SALES_INVOICE' and status = 'POSTED' and lower(source_ref) = ${f.oldRef.toLowerCase()}`;
  if (!doc) { console.log(`  ${f.oldRef}: not posted here — nothing to void`); continue; }
  await voidDocument({ documentId: doc.id, goodsBack: true,
    reason: `Imported without its accessory lines (the serial report leaves them out); posted again whole from the full report` });
  console.log(`  voided ${doc.doc_no} (${f.oldRef})`);
}
// 2. All twenty in, whole.
const master = await getSalesImportMaster(co.id, named);
const plan = planSalesImport(merged, master as never, mapping);
const ready = plan.filter((p) => ["ready", "review"].includes(invoiceStatus(p, mapping)));
for (const p of plan.filter((p) => !ready.includes(p))) console.log(`  held ${p.oldRef}: ${invoiceStatus(p, mapping)} ${p.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`);
const res = await postImportedSales(co.id, ready, mapping);
for (const r of res) console.log(`  ${r.oldRef}: ${r.status}${"error" in r ? " " + r.error : ""}`);
const [{ n, t }] = await sql`select count(*)::int as n, sum(gross_total)::float as t from document where company_id = ${co.id} and doc_type = 'SALES_INVOICE' and status = 'POSTED'`;
const [rev] = await sql`select -coalesce(sum(jl.base_amount), 0)::float as r from journal_line jl join account a on a.id = jl.account_id where jl.company_id = ${co.id} and a.account_type = 'REVENUE' and a.code like '41%'`;
console.log(`Sales invoices posted: ${n}, total ${Number(t).toLocaleString()} · revenue (41xx) ${Number(rev.r).toLocaleString()}`);
await sql.end();

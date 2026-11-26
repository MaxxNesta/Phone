// January 2026 from the old system, into an empty ledger (2026-11-26):
// purchases, their carriage spread onto the units (real landed cost), the
// seized iPad lot written off on the day it was seized, then sales.
//
//   npx tsx --env-file=.env scripts/load-january-2026.mts --dry        (read and check, write nothing)
//   npx tsx --env-file=.env scripts/load-january-2026.mts --wipe       (empty DEV's transactions first, then load)
//   … --force                                                          (any database but DEV: only with the owner's OK)
//
// Files (D:\phone): Purchase by each invoice with serial.xlsx, Journal
// Transaction.xlsx, Sales by each invoice with serial.xlsx. Read as a paste
// from Excel reads them: a merged cell gives its value once.
//
// Carriage: every old voucher was Dr 51110 Carriage Inward / Cr 21109 Payable
// (Other). Here each is a landed cost on the goods receipt it belongs to,
// owed to the Unnamed courier, spread "Manual by product variant": only the
// voucher's product type (iPhone, iPad, iWatch, AirPods, keyboard, adaptor),
// qty × the voucher's rate each. Paired to the invoices by supplier, product
// type, quantity and date (two invoices of one day may share a voucher).
// sa26010050 is a duplicate of sa26010051 (owner, 2026-11-26) and is left out.
//
// The seized lot fm26010036 (50 × IPD013): IPD013 is set to Optional serial
// so the lot can come in without serials, written off on 28 Jan (reason
// Damage, Dr 5920 / Cr 1310, carriage included), then set back to Serial.
import ExcelJS from "exceljs";
import { sql } from "../lib/db";
import { resetTransactions } from "./test-reset.mjs";
import { parsePurchaseReport, planPurchaseImport, invoiceStatus, reportDate, type Mapping } from "../lib/import-purchase-invoices";
import { planSalesImport } from "../lib/import-sales-invoices";
import { getPurchaseImportMaster, postImportedPurchases } from "../lib/purchase-import";
import { getSalesImportMaster, postImportedSales } from "../lib/sales-import";
import { postStockAdjustment } from "../lib/posting";
import * as L from "../lib/landed-cost";

const DIR = "D:/phone";
const args = new Set(process.argv.slice(2));
const dry = args.has("--dry");

const [co] = await sql`select id, name from company order by created_at limit 1`;
if (!/\bDEV\b/.test(co.name) && !args.has("--force")) throw new Error(`${co.name} is not DEV. Pass --force only with the owner's OK.`);
console.log(`${co.name}${dry ? " · dry run, nothing written" : ""}`);

// ------------------------------------------------------------ reading --
const text = (v: any): string => v == null ? "" : typeof v === "string" ? v.trim() : typeof v === "number" ? String(v)
  : v instanceof Date ? v.toISOString().slice(0, 10) : "result" in v ? text(v.result)
  : "richText" in v ? v.richText.map((r: any) => r.text).join("").trim() : "text" in v ? text(v.text) : String(v).trim();
async function pasteRows(file: string): Promise<string[][]> {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  const rows: string[][] = []; let width = 0;
  for (const ws of wb.worksheets) ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (c: any) => cells.push(c.isMerged && c.master !== c ? "" : text(c.value)));
    width = Math.max(width, cells.length); rows.push(cells);
  });
  for (const r of rows) while (r.length < width) r.push("");
  return rows.filter((r) => r.some((c) => c !== ""));
}
type Voucher = { no: string; date: string; desc: string; amount: number };
async function carriageVouchers(file: string): Promise<Voucher[]> {
  const out: Voucher[] = []; let cur: Voucher | null = null;
  for (const r of await pasteRows(file)) {
    const c = r.filter((x) => x !== "");
    if (/^[a-z]{1,3}\d{6,}$/i.test(c[0] ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(c[1] ?? "")) { cur = { no: c[0], date: c[1], desc: "", amount: 0 }; out.push(cur); continue; }
    if (cur && c[0] === "51110") {
      cur.desc = c[2] ?? "";
      cur.amount += Number(c.find((x, i) => i > 2 && /^[\d,]+(\.\d+)?$/.test(x))?.replace(/,/g, "") ?? 0);
    }
  }
  return out.filter((v) => v.amount > 0 && v.no !== "sa26010050");
}

// ----------------------------------------------------------- master --
const [mainWh] = await sql`select id from location where company_id = ${co.id} and code = 'MAIN-WH'`;
if (!mainWh) throw new Error("No MAIN-WH warehouse.");
const mapping: Mapping = { suppliers: {}, locations: { "Main Store": mainWh.id as string } };
const kindOf = (s: string) => /keyboard/i.test(s) ? "keyboard" : /adaptor|adapter|20w/i.test(s) ? "adaptor" : /airpod/i.test(s) ? "airpods"
  : /watch/i.test(s) ? "watch" : /ipad/i.test(s) ? "ipad" : /iphone/i.test(s) ? "iphone" : "other";

const purchases = parsePurchaseReport(await pasteRows(`${DIR}/Purchase by each invoice with serial.xlsx`));
const sales = parsePurchaseReport(await pasteRows(`${DIR}/Sales by each invoice with serial.xlsx`));
const vouchers = await carriageVouchers(`${DIR}/Journal Transaction.xlsx`);
const itemRows = await sql`select id, code, name from item where company_id = ${co.id} and code = any(${[...new Set(purchases.flatMap((i) => i.lines.map((l) => l.code)))]})`;
const item = new Map(itemRows.map((r) => [r.code as string, { id: r.id as string, name: r.name as string }]));

/** Each voucher's invoices and the items it covers on them (qty × rate each). */
const used = new Set<string>();
const days = (a: string, b: string) => Math.abs(+new Date(a) - +new Date(b)) / 864e5;
const pairs = vouchers.sort((a, b) => a.date.localeCompare(b.date) || a.no.localeCompare(b.no)).map((v) => {
  const m = /(\d+)\s*qty\s*\*\s*([\d,]+)/i.exec(v.desc);
  if (!m) return { v, refs: [] as string[], kind: "?", qty: 0, rate: 0 };
  const qty = Number(m[1]), rate = Number(m[2].replace(/,/g, "")), kind = kindOf(v.desc);
  const supplier = /thai/i.test(v.desc) ? "Thai" : "China";
  const qOf = (i: (typeof purchases)[number]) => i.lines.filter((l) => kindOf(item.get(l.code)?.name ?? l.code) === kind).reduce((t, l) => t + l.qty, 0);
  const pool = purchases.filter((i) => i.supplier === supplier && qOf(i) > 0 && !used.has(`${i.oldRef}|${kind}`) && days(reportDate(i.rawDate)!, v.date) <= 10)
    .sort((a, b) => days(reportDate(a.rawDate)!, v.date) - days(reportDate(b.rawDate)!, v.date));
  let refs: string[] = [];
  const one = pool.find((i) => qOf(i) === qty);
  if (one) refs = [one.oldRef];
  else for (let a = 0; a < pool.length && !refs.length; a++) for (let b = a + 1; b < pool.length; b++)
    if (qOf(pool[a]) + qOf(pool[b]) === qty && pool[a].rawDate === pool[b].rawDate) { refs = [pool[a].oldRef, pool[b].oldRef]; break; }
  refs.forEach((r) => used.add(`${r}|${kind}`));
  return { v, refs, kind, qty, rate };
});
const unpaired = pairs.filter((p) => !p.refs.length || p.qty * p.rate !== p.v.amount);
console.log(`Files: ${purchases.length} purchases, ${vouchers.length} carriage vouchers (${vouchers.reduce((t, v) => t + v.amount, 0).toLocaleString()}), ${sales.length} sales`);
if (unpaired.length) throw new Error(`Carriage not paired: ${unpaired.map((p) => `${p.v.no} ${p.v.desc}`).join("; ")}`);
if (dry) { for (const p of pairs) console.log(`  ${p.v.no} ${p.v.date} ${p.kind} ${p.qty}×${p.rate.toLocaleString()} → ${p.refs.join(" + ")}`); await sql.end(); process.exit(0); }

// ------------------------------------------------------------ 0. wipe --
if (args.has("--wipe")) {
  const n = await resetTransactions(sql);
  console.log(`Emptied ${n} transaction tables.`);
}

// ------------------------------------------------- 1. the seized lot in --
await sql`update item set identity = 'OPTIONAL', tracks_serial = false where company_id = ${co.id} and code = 'IPD013'`;

// --------------------------------------------------------- 2. purchases --
{
  const named = { refs: purchases.map((i) => i.oldRef), serials: purchases.flatMap((i) => i.lines.flatMap((l) => l.serials)) };
  const master = await getPurchaseImportMaster(co.id, named);
  const plan = planPurchaseImport(purchases, master, mapping);
  const ready = plan.filter((p) => ["ready", "review"].includes(invoiceStatus(p, mapping)));
  const held = plan.filter((p) => !ready.includes(p));
  for (const p of held) console.log(`  purchase ${p.oldRef} held: ${invoiceStatus(p, mapping)} ${p.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`);
  const res = await postImportedPurchases(co.id, ready, mapping, master);
  const failed = res.filter((r) => r.status === "failed");
  console.log(`Purchases: ${res.filter((r) => r.status === "posted").length} posted, ${failed.length} failed, ${held.length} held`);
  for (const f of failed) console.log(`  ${f.oldRef}: ${"error" in f ? f.error : ""}`);
}

// ---------------------------------------------------------- 3. carriage --
{
  const [type] = await sql`select id from landed_cost_type where company_id = ${co.id} and code = 'CARRIAGE' and is_active`;
  if (!type) throw new Error("No CARRIAGE landed cost type.");
  const [courier] = await sql`
    insert into business_partner (company_id, code, name, is_supplier, is_customer)
    values (${co.id}, 'COURIER', 'Unnamed courier', true, false)
    on conflict (company_id, code) do update set is_active = true returning id`;
  let posted = 0, total = 0;
  // Re-runnable: a voucher already spread (its number is the shipment ref) is left alone.
  const done = new Set((await sql`
    select lc.shipment_ref from landed_cost lc join document d on d.id = lc.document_id
     where lc.company_id = ${co.id} and d.status = 'POSTED'`).map((r) => r.shipment_ref as string));
  for (const p of pairs) {
    if (done.has(p.v.no)) { posted++; total += p.v.amount; continue; }
    const receipts = await sql`
      select r.id, r.doc_date::text as date, dl.item_id, sum(dl.base_qty)::float as qty
        from document b join document r on r.id = b.source_document_id and r.doc_type = 'GOODS_RECEIPT'
        join document_line dl on dl.document_id = r.id
       where b.company_id = ${co.id} and b.doc_type = 'PURCHASE_INVOICE' and b.status = 'POSTED' and lower(b.source_ref) = any(${p.refs.map((r) => r.toLowerCase())})
       group by r.id, r.doc_date, dl.item_id`;
    if (!receipts.length) { console.log(`  carriage ${p.v.no}: no receipt for ${p.refs.join(", ")} — skipped`); continue; }
    const names = new Map((await sql`select id, name from item where id = any(${receipts.map((r) => r.item_id)})`).map((r) => [r.id as string, r.name as string]));
    // One amount per product, however many of the voucher's receipts it is on.
    const perItem = new Map<string, number>();
    for (const r of receipts.filter((r) => kindOf(names.get(r.item_id) ?? "") === p.kind)) perItem.set(r.item_id, (perItem.get(r.item_id) ?? 0) + Number(r.qty));
    const manual = [...perItem].map(([itemId, q]) => ({ itemId, amount: Math.round(q * p.rate) }));
    const sum = manual.reduce((t, m) => t + m.amount, 0);
    if (sum !== p.v.amount) { console.log(`  carriage ${p.v.no}: ${sum.toLocaleString()} on the receipts, voucher says ${p.v.amount.toLocaleString()} — skipped`); continue; }
    const docDate = [p.v.date, ...receipts.map((r) => r.date as string)].sort().at(-1)!;
    const actor = { companyId: co.id as string, userId: null };
    await sql.begin(async (tx) => {
      const head = { docDate, receiptIds: [...new Set(receipts.map((r) => r.id as string))], shipmentRef: p.v.no, carrierRef: "Unnamed courier", notes: p.v.desc };
      const lc = await L.createLandedCost({ ...actor, ...head }, tx as never);
      await L.saveLandedCost({ ...actor, ...head, id: lc.id, charges: [{ costTypeId: type.id as string, partnerId: courier.id as string,
        amount: p.v.amount, method: "MANUAL", manual, reference: p.v.no, description: p.v.desc }] }, tx as never);
      await L.acknowledgeExcluded({ ...actor, id: lc.id }, tx as never);
      await L.calculateLandedCost({ ...actor, id: lc.id }, tx as never);
      await L.postLandedCost({ ...actor, id: lc.id }, tx as never);
    });
    posted++; total += p.v.amount;
  }
  console.log(`Carriage: ${posted} of ${pairs.length} landed costs posted, ${total.toLocaleString()}`);
}

// ------------------------------------------- 4. the seized lot written off --
{
  const [ipd] = await sql`select id from item where company_id = ${co.id} and code = 'IPD013'`;
  const [{ qty }] = await sql`select coalesce(sum(qty), 0)::float as qty from stock_movement where item_id = ${ipd.id} and location_id = ${mainWh.id}`;
  if (qty === 50) {
    const r = await postStockAdjustment({ companyId: co.id, locationId: mainWh.id, docDate: "2026-01-28", writeOff: true, reference: "fm26010036",
      memo: "Seized by police on arrival, 28 Jan 2026 — all 50 gone. Written off in the old books in October; here on the day it happened.",
      lines: [{ itemId: ipd.id, qty: -50 }] });
    console.log(`Seized lot: ${r.docNo} writes off 50 × IPD013`);
  } else console.log(`Seized lot: ${qty} × IPD013 on hand, not 50 — not written off`);
  await sql`update item set identity = 'SERIAL', tracks_serial = true where id = ${ipd.id}`;
}

// ------------------------------------------------------------- 5. sales --
{
  const named = { refs: sales.map((i) => i.oldRef), serials: sales.flatMap((i) => i.lines.flatMap((l) => l.serials)) };
  const master = await getSalesImportMaster(co.id, named);
  const plan = planSalesImport(sales, master, mapping);
  const ready = plan.filter((p) => ["ready", "review"].includes(invoiceStatus(p, mapping)));
  const held = plan.filter((p) => !ready.includes(p));
  const why = new Map<string, number>();
  for (const p of held) for (const e of p.issues.filter((i) => i.level === "error")) { const k = e.message.replace(/\b[A-Z0-9]{8,}\b/g, "…"); why.set(k, (why.get(k) ?? 0) + 1); }
  const res = await postImportedSales(co.id, ready, mapping);
  const failed = res.filter((r) => r.status === "failed");
  console.log(`Sales: ${res.filter((r) => r.status === "posted").length} posted, ${failed.length} failed, ${held.length} held`);
  for (const [k, n] of [...why].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  held ×${n}: ${k}`);
  for (const f of failed.slice(0, 15)) console.log(`  ${f.oldRef}: ${"error" in f ? f.error : ""}`);
}

// ------------------------------------------------------------- checks --
const [tb] = await sql`select coalesce(sum(base_amount), 0)::float as t from journal_line where company_id = ${co.id}`;
const [lc] = await sql`select coalesce(sum(jl.base_amount), 0)::float as t from journal_line jl join system_account sa on sa.account_id = jl.account_id and sa.role = 'LANDED_COST_CLEARING' where jl.company_id = ${co.id}`;
console.log(`Trial balance ${tb.t.toFixed(2)} (0 is right) · Landed cost clearing ${lc.t.toLocaleString()}`);
await sql.end();

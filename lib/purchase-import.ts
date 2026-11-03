import type { TransactionSql } from "postgres";
import { createHash } from "node:crypto";
import { sql } from "./db";
import { postOnce } from "./idempotency";
import { postPurchaseWithReceipt } from "./posting";
import { netOf, resolved, type Mapping, type PlannedInvoice, type PurchaseImportMaster } from "./import-purchase-invoices";

/**
 * Posting purchase invoices from the old system's report as real bills.
 *
 * Every invoice goes through postPurchaseWithReceipt — the engine behind a
 * bill typed in with "goods arriving with this bill" ticked — so it makes the
 * same goods receipt, stock, payable, journals and (when something was paid)
 * supplier payment as one entered by hand. Nothing here writes a ledger,
 * stock or payable row itself.
 */

/**
 * Everything a report is checked against, in one round trip: the masters,
 * the cash and bank accounts, and — for only the old IDs and serials this
 * file names — what is already posted, held as history, or in stock.
 */
export async function getPurchaseImportMaster(companyId: string, file: { refs: string[]; serials: string[] }): Promise<PurchaseImportMaster> {
  const refs = file.refs.filter(Boolean).map((r) => r.trim().toLowerCase());
  const [suppliers, locations, items, payAccounts, known, history, stock] = await Promise.all([
    sql`select id, code, name, payment_terms_days from business_partner where company_id = ${companyId} and is_supplier order by code`,
    sql`select id, code, name from location where company_id = ${companyId} and is_stock_location and is_active order by name`,
    sql`select id, code, name, is_active, tracks_serial, identity from item where company_id = ${companyId}`,
    sql`select id, code, name from account where company_id = ${companyId} and is_active and is_postable
           and (is_cash_account or is_bank_account) order by code`,
    sql`select source_ref as ref, doc_no, 'POSTED' as kind from document
         where company_id = ${companyId} and doc_type = 'PURCHASE_INVOICE' and status = 'POSTED' and lower(source_ref) = any(${refs})
        union all
        select old_ref, invoice_no, 'HISTORY' from historical_purchase_invoice where company_id = ${companyId} and lower(old_ref) = any(${refs})`,
    sql`select distinct s from historical_purchase_invoice_line l
          join historical_purchase_invoice h on h.id = l.invoice_id
          cross join unnest(l.serials) s
         where h.company_id = ${companyId} and l.serials && ${file.serials}::text[] and s = any(${file.serials})`,
    sql`select s.serial_no as serial, i.code as item_code from stock_serial s join item i on i.id = s.item_id
          where s.company_id = ${companyId} and (s.serial_no = any(${file.serials}) or s.imei2 = any(${file.serials}))`,
  ]);
  return {
    suppliers: suppliers as unknown as PurchaseImportMaster["suppliers"],
    locations: locations as unknown as PurchaseImportMaster["locations"],
    items: items as unknown as PurchaseImportMaster["items"],
    payAccounts: payAccounts as unknown as PurchaseImportMaster["payAccounts"],
    known: known as unknown as PurchaseImportMaster["known"],
    historySerials: history.map((r) => r.s as string),
    stockSerials: stock as unknown as PurchaseImportMaster["stockSerials"],
  };
}

const addDays = (d: string, n: number) => {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** The invoice as the engine takes it — the same input the manual form builds. */
function toInput(companyId: string, p: PlannedInvoice, mapping: Mapping, master: PurchaseImportMaster) {
  const partnerId = resolved(p.supplier, mapping.suppliers)!;
  const terms = master.suppliers.find((s) => s.id === partnerId)?.payment_terms_days ?? 0;
  const t = p.totals;
  // Serials on an item that carries none have no unit to belong to; they stay readable on the bill.
  const loose = p.lines.filter((l) => l.identity === "NONE" && l.serials.length).map((l) => `${l.code}: ${l.serials.join(", ")}`);
  const discount = t.itemDiscount + t.voucherDiscount;
  const early = p.postDate !== p.date ? `Dated ${p.date} in the old system; posted on the company start` : null;
  return {
    companyId, partnerId,
    locationId: resolved(p.location, mapping.locations)!,
    docDate: p.postDate!,
    // The supplier's own terms decide when it is due; none means on the bill's date.
    dueDate: addDays(p.postDate!, terms),
    memo: [early, p.remark, ...loose].filter(Boolean).join(" · ") || null,
    reference: p.supplierInvoiceNo,
    ...(t.currency !== "MMK" ? { currency: t.currency, exchangeRate: t.exchangeRate } : {}),
    billDiscountAmount: discount > 0 ? discount : null,
    cashOut: t.paidAmount,
    cashAccountId: t.paidAmount > 0 ? mapping.payAccount ?? null : null,
    // Arrived on the bill's date, time not known: the lot starts that day.
    receivedAt: null,
    lines: p.lines.map((l) => ({
      itemId: l.itemId!, qty: l.qty, unitPrice: l.unitPrice,
      serials: l.identity === "NONE" ? undefined : l.serials,
    })),
  };
}

/** One key per old bill, so a retry, a double click or a second upload can never post it twice. */
function keyOf(p: PlannedInvoice) {
  if (p.oldRef) return `pi-import:${p.oldRef.trim().toLowerCase()}`;
  const h = createHash("sha256").update(JSON.stringify([p.supplier.source, p.date, p.lines.map((l) => [l.code, l.qty, l.unitPrice, l.serials])])).digest("hex");
  return `pi-import:#${h.slice(0, 32)}`;
}

async function post(tx: TransactionSql, companyId: string, p: PlannedInvoice, mapping: Mapping, master: PurchaseImportMaster) {
  const posted = await postPurchaseWithReceipt(toInput(companyId, p, mapping, master), tx);
  // The old id on the bill and its receipt, so either is found by it.
  if (p.oldRef) await tx`
    update document set source_ref = ${p.oldRef}
     where id = ${posted.id} or id = (select source_document_id from document where id = ${posted.id})`;
  return posted;
}

export type PostingPreview = {
  documents: { type: string; no: string }[];
  stock: { code: string; location: string; qty: number; cost: number }[];
  journal: { entry: string; source: string; code: string; account: string; partner: string | null; debit: number; credit: number }[];
} | { error: string };

class Rollback extends Error { constructor(readonly value: PostingPreview) { super("rollback"); } }

/**
 * What posting this invoice would create — documents, stock and journal
 * lines — read back from a real posting that is then rolled back. Nothing is
 * kept, not even a number; but the figures are the engine's own, from the
 * configured posting rules, not a guess at them.
 */
export async function previewPurchasePosting(companyId: string, p: PlannedInvoice, mapping: Mapping, master: PurchaseImportMaster): Promise<PostingPreview> {
  try {
    await sql.begin(async (tx) => {
      const posted = await post(tx, companyId, p, mapping, master);
      const docs = await tx`
        select id, doc_type, doc_no, journal_entry_id from document
         where id = ${posted.id} or source_document_id = ${posted.id}
            or id = (select source_document_id from document where id = ${posted.id})`;
      const ids = docs.map((d) => d.id as string);
      const [stock, journal] = await Promise.all([
        tx`select i.code, l.name as location, sum(m.qty)::float as qty, sum(m.total_cost)::float as cost
             from stock_movement m join item i on i.id = m.item_id join location l on l.id = m.location_id
            where m.document_id = any(${ids}) group by i.code, l.name order by i.code`,
        tx`select je.entry_no as entry, je.source_type as source, a.code, a.name as account, p.name as partner,
                  greatest(jl.base_amount, 0)::float as debit, greatest(-jl.base_amount, 0)::float as credit
             from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
             join account a on a.id = jl.account_id left join business_partner p on p.id = jl.partner_id
            where je.source_id = any(${ids}) order by je.entry_no, jl.line_no`,
      ]);
      throw new Rollback({
        documents: docs.map((d) => ({ type: d.doc_type as string, no: d.doc_no as string })),
        stock: stock as never, journal: journal as never,
      });
    });
  } catch (e) {
    if (e instanceof Rollback) return e.value;
    return { error: e instanceof Error ? e.message : String(e) };
  }
  return { error: "Nothing was posted." };
}

export type PostedResult =
  | { row: number; oldRef: string; status: "posted" | "already"; invoiceNo: string; receiptNo: string | null; paymentNo: string | null; total: number }
  | { row: number; oldRef: string; status: "failed"; error: string };

/**
 * Posts each invoice on its own, oldest first so stock arrives in the order
 * it did: a failure rolls back that invoice whole and leaves the rest posted.
 * The key makes a retry safe — an invoice that posted is handed back, not
 * posted again.
 */
export async function postImportedPurchases(companyId: string, invoices: PlannedInvoice[], mapping: Mapping, master: PurchaseImportMaster): Promise<PostedResult[]> {
  const order = [...invoices].sort((a, b) => a.postDate!.localeCompare(b.postDate!) || a.row - b.row);
  const out: PostedResult[] = [];
  const postedIds = new Map<string, number>();
  for (const p of order) {
    try {
      const r = await postOnce(companyId, keyOf(p), (tx) => post(tx, companyId, p, mapping, master));
      postedIds.set(r.id, p.row);
      out.push({ row: p.row, oldRef: p.oldRef, status: r.repeated ? "already" : "posted", invoiceNo: r.docNo, receiptNo: null, paymentNo: null, total: netOf(p) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.push({ row: p.row, oldRef: p.oldRef, status: "failed",
        error: /document_purchase_source_ref_key/.test(msg) ? `${p.oldRef} is already posted.` : msg });
    }
  }
  // The receipt and payment each bill made, in one read for the batch.
  if (postedIds.size) {
    const rel = await sql`
      select b.id, r.doc_no as receipt, pay.doc_no as payment from document b
        left join document r on r.id = b.source_document_id and r.doc_type = 'GOODS_RECEIPT'
        left join document pay on pay.source_document_id = b.id and pay.doc_type = 'SUPPLIER_PAYMENT'
       where b.id = any(${[...postedIds.keys()]})`;
    for (const x of rel) {
      const o = out.find((r) => r.status !== "failed" && r.row === postedIds.get(x.id as string)) as Extract<PostedResult, { invoiceNo: string }> | undefined;
      if (o) { o.receiptNo = (x.receipt as string) ?? null; o.paymentNo = (x.payment as string) ?? null; }
    }
  }
  return out;
}

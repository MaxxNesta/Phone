import type { TransactionSql } from "postgres";
import { createHash } from "node:crypto";
import { sql } from "./db";
import { postOnce } from "./idempotency";
import { postSaleWithDelivery } from "./posting";
import { netOf, resolved, type Mapping, type PlannedInvoice } from "./import-purchase-invoices";
import { lineDiscounts, type SalesImportMaster } from "./import-sales-invoices";
import type { PostedResult, PostingPreview } from "./purchase-import";

/**
 * Posting sales invoices from the old system's report as real sales.
 *
 * Every invoice goes through postSaleWithDelivery — the engine behind a sale
 * delivered as it is invoiced — so it makes the same invoice, delivery, stock
 * out at FIFO cost, cost of sales, receivable and (when money was taken)
 * receipt as one entered at the counter. Nothing here writes a ledger, stock
 * or receivable row itself.
 */

/** Everything a report is checked against, in one round trip; history only for what the file names. */
export async function getSalesImportMaster(companyId: string, file: { refs: string[]; serials: string[] }): Promise<SalesImportMaster> {
  const refs = file.refs.filter(Boolean).map((r) => r.trim().toLowerCase());
  const [customers, locations, items, payAccounts, known, units, [foc]] = await Promise.all([
    sql`select id, code, name from business_partner where company_id = ${companyId} and is_customer order by code`,
    sql`select id, code, name from location where company_id = ${companyId} and is_stock_location and is_active order by name`,
    sql`select id, code, name, is_active, tracks_serial, identity from item where company_id = ${companyId}`,
    sql`select id, code, name from account where company_id = ${companyId} and is_active and is_postable
           and (is_cash_account or is_bank_account) order by code`,
    sql`select source_ref as ref, doc_no, 'POSTED' as kind from document
         where company_id = ${companyId} and doc_type = 'SALES_INVOICE' and status = 'POSTED' and lower(source_ref) = any(${refs})`,
    sql`select v.imei as serial, v.item_code, v.status, v.location_id, v.location_name as location,
               to_char(v.received_date, 'YYYY-MM-DD') as received_on, v.out_doc_no
          from v_stock_serial v
         where v.company_id = ${companyId} and (v.imei = any(${file.serials}) or v.imei2 = any(${file.serials}))`,
    // A free line on the old report was a promotion; any giveaway reason will do where that one is missing.
    sql`select id, name from foc_reason where company_id = ${companyId} and applies_to = 'SALE'
         order by (code = 'PROMOTION') desc, code limit 1`,
  ]);
  return {
    customers: customers as never, locations: locations as never, items: items as never, payAccounts: payAccounts as never,
    known: known as never, units: units as never, focId: (foc?.id as string) ?? null, focName: (foc?.name as string) ?? null,
  };
}

/** The sale as the engine takes it — the same input the counter builds. */
function toInput(companyId: string, p: PlannedInvoice, mapping: Mapping, focId: string | null) {
  const t = p.totals;
  const off = lineDiscounts(p.lines.map((l) => (l.free ? 0 : l.amount)), t.itemDiscount + t.voucherDiscount);
  const early = p.postDate !== p.date ? `Dated ${p.date} in the old system; posted on the company start` : null;
  const loose = p.lines.filter((l) => l.identity === "NONE" && l.serials.length).map((l) => `${l.code}: ${l.serials.join(", ")}`);
  return {
    companyId,
    partnerId: resolved(p.supplier, mapping.suppliers)!,
    locationId: resolved(p.location, mapping.locations)!,
    docDate: p.postDate!,
    dueDate: p.postDate!,
    paymentType: (t.paidAmount >= netOf(p) - 0.5 ? "CASH" : "CREDIT") as "CASH" | "CREDIT",
    memo: [early, p.remark, ...loose].filter(Boolean).join(" · ") || null,
    reference: p.supplierInvoiceNo,
    cashIn: t.paidAmount,
    cashAccountId: t.paidAmount > 0 ? mapping.payAccount ?? null : null,
    lines: p.lines.map((l, i) => ({
      itemId: l.itemId!, qty: l.qty, unitPrice: l.unitPrice, serials: l.identity === "NONE" ? undefined : l.serials,
      discountAmount: off[i] > 0 ? off[i] : null,
      focReasonId: l.free ? focId : null,
    })),
  };
}

function keyOf(p: PlannedInvoice) {
  if (p.oldRef) return `si-import:${p.oldRef.trim().toLowerCase()}`;
  const h = createHash("sha256").update(JSON.stringify([p.supplier.source, p.date, p.lines.map((l) => [l.code, l.qty, l.unitPrice, l.serials])])).digest("hex");
  return `si-import:#${h.slice(0, 32)}`;
}

/** The giveaway reason a free line posts under: read once for a whole batch, and only when a line is free. */
async function giveaway(companyId: string, invoices: PlannedInvoice[]): Promise<string | null> {
  if (!invoices.some((p) => p.lines.some((l) => l.free))) return null;
  const [foc] = await sql`
    select id from foc_reason where company_id = ${companyId} and applies_to = 'SALE'
     order by (code = 'PROMOTION') desc, code limit 1`;
  return (foc?.id as string) ?? null;
}

async function post(tx: TransactionSql, companyId: string, p: PlannedInvoice, mapping: Mapping, focId: string | null) {
  const posted = await postSaleWithDelivery(toInput(companyId, p, mapping, focId), tx);
  // The old id on the invoice and the delivery it owns, so either is found by it.
  if (p.oldRef) await tx`
    update document set source_ref = ${p.oldRef}
     where id = ${posted.id} or (lifecycle_owner_id = ${posted.id} and doc_type = 'DELIVERY')`;
  return posted;
}

class Rollback extends Error { constructor(readonly value: PostingPreview) { super("rollback"); } }

/** What posting this invoice would create, from a real posting that is then rolled back. */
export async function previewSalesPosting(companyId: string, p: PlannedInvoice, mapping: Mapping): Promise<PostingPreview> {
  const focId = await giveaway(companyId, [p]);
  try {
    await sql.begin(async (tx) => {
      const posted = await post(tx, companyId, p, mapping, focId);
      const docs = await tx`
        select id, doc_type, doc_no from document
         where id = ${posted.id} or lifecycle_owner_id = ${posted.id} or source_document_id = ${posted.id}`;
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
      throw new Rollback({ documents: docs.map((d) => ({ type: d.doc_type as string, no: d.doc_no as string })), stock: stock as never, journal: journal as never });
    });
  } catch (e) {
    if (e instanceof Rollback) return e.value;
    return { error: e instanceof Error ? e.message : String(e) };
  }
  return { error: "Nothing was posted." };
}

/** Each invoice on its own, oldest first so stock leaves in the order it did; a retry posts nothing twice. */
export async function postImportedSales(companyId: string, invoices: PlannedInvoice[], mapping: Mapping): Promise<PostedResult[]> {
  const order = [...invoices].sort((a, b) => a.postDate!.localeCompare(b.postDate!) || a.row - b.row);
  const focId = await giveaway(companyId, order);
  const out: PostedResult[] = [];
  const postedIds = new Map<string, number>();
  for (const p of order) {
    try {
      const r = await postOnce(companyId, keyOf(p), (tx) => post(tx, companyId, p, mapping, focId));
      postedIds.set(r.id, p.row);
      out.push({ row: p.row, oldRef: p.oldRef, status: r.repeated ? "already" : "posted", invoiceNo: r.docNo, receiptNo: null, paymentNo: null, total: netOf(p) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.push({ row: p.row, oldRef: p.oldRef, status: "failed", error: /document_sales_source_ref_key/.test(msg) ? `${p.oldRef} is already posted.` : msg });
    }
  }
  // The delivery and receipt each invoice made, in one read for the batch.
  if (postedIds.size) {
    const rel = await sql`
      select s.id, dl.doc_no as delivery, rc.doc_no as receipt from document s
        left join document dl on dl.lifecycle_owner_id = s.id and dl.doc_type = 'DELIVERY'
        left join document rc on rc.source_document_id = s.id and rc.doc_type = 'CUSTOMER_RECEIPT'
       where s.id = any(${[...postedIds.keys()]})`;
    for (const x of rel) {
      const o = out.find((r) => r.status !== "failed" && r.row === postedIds.get(x.id as string)) as Extract<PostedResult, { invoiceNo: string }> | undefined;
      if (o) { o.receiptNo = (x.delivery as string) ?? null; o.paymentNo = (x.receipt as string) ?? null; }
    }
  }
  return out;
}

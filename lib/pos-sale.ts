import { sql } from "./db";
import { postOnce } from "./idempotency";
import { postRetailSale, postCustomerReceipt, type InvoiceLine } from "./posting";
import { resolveTenders, stampReceipt, type TenderIn } from "./payment-channels";

/**
 * Posting a counter sale, once the till's action has checked who is asking
 * (lib/pos-actions.ts). Kept out of the "use server" module so it is not an
 * endpoint of its own, and so the test suites run the same code the till does.
 */

type Tr = (key: string, values?: Record<string, string | number>) => string;

export type TillSale = {
  companyId: string; userId: string | null;
  locationId: string; partnerId: string | null; salesmanId: string | null;
  priceIncludesTax: boolean; memo: string | null;
  lines: InvoiceLine[];
  payments: TenderIn[];
  attempt: string;
};

/** The shop's walk-in customer, made the first time it is needed. */
export async function walkIn(companyId: string): Promise<string> {
  const [found] = await sql`
    select id from business_partner where company_id = ${companyId} and code = 'WALKIN'`;
  if (found) return found.id as string;
  const [made] = await sql`
    insert into business_partner (company_id, code, name, is_customer, payment_terms_days)
    values (${companyId}, 'WALKIN', 'Walk-in customer', true, 0)
    on conflict do nothing returning id`;
  return (made?.id as string) ?? walkIn(companyId);
}

export async function postTillSale(sale: TillSale, tr: Tr): Promise<{ id: string; docNo: string }> {
  const co = sale.companyId;
  // Each tender's channel, resolved to the account it pays into at this
  // branch, with its reference checked. The ceiling (nothing tendered past
  // the total) is checked again once the sale has posted and its total is known.
  const resolved = await resolveTenders(co, sale.locationId, sale.payments.filter((p) => Number(p.amount) > 0), null);
  if (!resolved.ok) throw new Error(tr(`tender.${resolved.problem.key}`, resolved.problem.values));
  const payments = resolved.tenders;

  const walkInId = await walkIn(co);
  const partnerId = sale.partnerId || walkInId;
  const today = (await sql`select to_char(current_date, 'YYYY-MM-DD') as d`)[0].d as string;

  // The same attempt twice is the same sale. Looking for it first was not
  // enough: requests sent together all looked before any had posted, and
  // six copies of one sale sent at once posted six sales (found by testing
  // retries over HTTP). postOnce claims the attempt in the transaction that
  // posts it, so a second request waits for the first and is handed its sale.
  const attemptKey = sale.attempt ? `POS:${String(sale.attempt).slice(0, 96)}` : null;
  return postOnce(co, attemptKey, async (tx) => {
    const [first, ...rest] = payments;
    const posted = await postRetailSale({
      companyId: co, partnerId, locationId: sale.locationId,
      docDate: today, dueDate: today,
      paymentType: rest.length === 0 && first ? "CASH" : "CREDIT",
      salesmanId: sale.salesmanId || null,
      priceIncludesTax: sale.priceIncludesTax,
      memo: sale.memo, reference: "POS:" + sale.attempt,
      lines: sale.lines,
      cashIn: first ? first.amount : 0,
      cashAccountId: first?.channel.accountId ?? null,
    }, tx as never);

    const paidCents = payments.reduce((s, p) => s + Math.round(p.amount * 100), 0);
    const [doc] = await tx`select gross_total::float as total from document where id = ${posted.id}`;
    if (paidCents > Math.round(doc.total * 100)) throw new Error(tr("tender.overpaid"));

    if (first) {
      // The receipt the engine wrote for the first tender.
      const [r] = await tx`
        select id from document
         where source_document_id = ${posted.id} and doc_type = 'CUSTOMER_RECEIPT'`;
      await stampReceipt(tx as never, r.id, first.channel.id, first.reference, sale.userId);
    }

    // Further tenders — card after cash — are receipts the sale owns, so
    // voiding the sale undoes them with it.
    for (const p of rest) {
      const r = await postCustomerReceipt({
        companyId: co, partnerId, docDate: today, cashAccountId: p.channel.accountId as string,
        locationId: sale.locationId,
        allocations: [{ invoiceId: posted.id, amount: p.amount }],
        memo: `Payment against ${posted.docNo}`,
      }, tx as never);
      await tx`update document set lifecycle_owner_id = ${posted.id} where id = ${(r as { id: string }).id}`;
      await stampReceipt(tx as never, (r as { id: string }).id, p.channel.id, p.reference, sale.userId);
    }

    const [open] = await tx`select outstanding from v_open_item where document_id = ${posted.id}`;
    if (partnerId === walkInId && Number(open?.outstanding ?? 0) > 0.0001) {
      throw new Error(tr("walkInFull"));
    }

    await tx`
      update document set created_by_id = ${sale.userId}, posted_by_id = ${sale.userId}
       where id = ${posted.id}`;
    return { id: posted.id as string, docNo: posted.docNo as string };
  });
}

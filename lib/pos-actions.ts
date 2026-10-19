"use server";

import { revalidatePath } from "next/cache";
import { sql } from "./db";
import { postOnce } from "./idempotency";
import { requirePermission, can, DISCOUNT_CEILING_PCT } from "./auth";
import { assertMyBranch, seenLocations } from "./branch-scope";
import { receiptView, type ReceiptView } from "./receipt";
import { postRetailSale, postCustomerReceipt, type InvoiceLine } from "./posting";
import { posSearch, unitsOnShelf, stripCost } from "./phone";
import { serverT } from "./i18n-server";

// The till. Every action checks pos.sell on the server; cost leaves the
// server only for a role that may see it; discounts above the ceiling need
// discount.unlimited; a walk-in customer must pay in full.

export async function posSearchAction(locationId: string, q: string) {
  const user = await requirePermission("pos.sell");
  await assertMyBranch(locationId);
  const r = await posSearch(user.companyId, locationId, q);
  return { units: stripCost(r.units, can(user, "cost.view")), items: r.items };
}

export async function posUnitsAction(itemId: string, locationId: string) {
  const user = await requirePermission("pos.sell");
  await assertMyBranch(locationId);
  return stripCost(await unitsOnShelf(user.companyId, itemId, locationId), can(user, "cost.view"));
}

/**
 * The receipt of a sale the till has just posted, drawn with the template its
 * branch publishes, for the Sale complete sheet. This first view pins the sale
 * to that template version, so every reprint matches it. Read the way the
 * receipt page reads it: another branch's receipt, or another company's,
 * comes back as nothing. It reads the sale; it never posts anything.
 */
export async function posReceiptAction(id: string): Promise<{ view: ReceiptView; logoUrl: string | null } | null> {
  const user = await requirePermission("pos.sell");
  const view = await receiptView(user.companyId, id, await seenLocations(), { bind: true });
  return view ? { view, logoUrl: view.identity.hasLogo ? "/api/company-logo" : null } : null;
}

export type PosSale = {
  locationId: string;
  partnerId: string | null;           // null = walk-in
  salesmanId: string | null;
  priceIncludesTax: boolean;
  memo: string | null;
  lines: Array<{
    itemId: string; qty: number; unitPrice: number; discountPct: number;
    taxCodeId: string | null; serials: string[]; warrantyMonths: number | null;
    /** Given free: not charged, still leaves stock; the reason names the expense. */
    focReasonId?: string | null;
  }>;
  payments: Array<{ accountId: string; amount: number }>;
  /** A key the till generated for this attempt, so a double click posts once. */
  attempt: string;
};

export type PosResult = { ok: true; id: string; docNo: string } | { ok: false; error: string };

/** The shop's walk-in customer, made the first time it is needed. */
async function walkIn(companyId: string): Promise<string> {
  const [found] = await sql`
    select id from business_partner where company_id = ${companyId} and code = 'WALKIN'`;
  if (found) return found.id as string;
  const [made] = await sql`
    insert into business_partner (company_id, code, name, is_customer, payment_terms_days)
    values (${companyId}, 'WALKIN', 'Walk-in customer', true, 0)
    on conflict do nothing returning id`;
  return (made?.id as string) ?? walkIn(companyId);
}

export async function posPostSale(sale: PosSale): Promise<PosResult> {
  try {
    const user = await requirePermission("pos.sell");
    const tr = await serverT("pos");
    // The till sells at the cashier's own branch, whatever the request names.
    await assertMyBranch(sale.locationId);
    const co = user.companyId;

    const lines: InvoiceLine[] = sale.lines
      .filter((l) => l.itemId && l.qty > 0)
      .map((l) => ({
        itemId: l.itemId, qty: Number(l.qty), unitPrice: Number(l.unitPrice),
        discountPct: Number(l.discountPct) || 0, taxCodeId: l.taxCodeId || null,
        serials: l.serials.length ? l.serials : undefined,
        warrantyMonths: l.warrantyMonths,
        focReasonId: l.focReasonId || null,
      }));
    if (lines.length === 0) return { ok: false, error: tr("noLines") };

    if (!can(user, "discount.unlimited")) {
      const over = lines.find((l) => (l.discountPct ?? 0) > DISCOUNT_CEILING_PCT);
      if (over) {
        return { ok: false, error: tr("discountNeedsManager", { pct: DISCOUNT_CEILING_PCT }) };
      }
    }

    const payments = sale.payments.filter((p) => p.accountId && Number(p.amount) > 0);
    // Money can only be taken into an account that holds money.
    if (payments.length) {
      const ok = await sql`
        select id from account where company_id = ${co} and is_cash_account
           and id = any(${payments.map((p) => p.accountId)})`;
      if (ok.length !== new Set(payments.map((p) => p.accountId)).size) {
        return { ok: false, error: tr("chooseAccount") };
      }
    }

    const walkInId = await walkIn(co);
    const partnerId = sale.partnerId || walkInId;
    const today = (await sql`select to_char(current_date, 'YYYY-MM-DD') as d`)[0].d as string;

    // The same attempt twice is the same sale. Looking for it first was not
    // enough: requests sent together all looked before any had posted, and
    // six copies of one sale sent at once posted six sales (found by testing
    // retries over HTTP). postOnce claims the attempt in the transaction that
    // posts it, so a second request waits for the first and is handed its sale.
    const attemptKey = sale.attempt ? `POS:${String(sale.attempt).slice(0, 96)}` : null;
    const result = await postOnce(co, attemptKey, async (tx) => {
      const [first, ...rest] = payments;
      const posted = await postRetailSale({
        companyId: co, partnerId, locationId: sale.locationId,
        docDate: today, dueDate: today,
        paymentType: rest.length === 0 && first ? "CASH" : "CREDIT",
        salesmanId: sale.salesmanId || null,
        priceIncludesTax: sale.priceIncludesTax,
        memo: sale.memo, reference: "POS:" + sale.attempt,
        lines,
        cashIn: first ? Number(first.amount) : 0,
        cashAccountId: first?.accountId ?? null,
      }, tx as never);

      // Further tenders — card after cash — are receipts the sale owns, so
      // voiding the sale undoes them with it.
      for (const p of rest) {
        const r = await postCustomerReceipt({
          companyId: co, partnerId, docDate: today, cashAccountId: p.accountId,
          locationId: sale.locationId,
          allocations: [{ invoiceId: posted.id, amount: Number(p.amount) }],
          memo: `Payment against ${posted.docNo}`,
        }, tx as never);
        await tx`update document set lifecycle_owner_id = ${posted.id} where id = ${(r as { id: string }).id}`;
      }

      const [open] = await tx`select outstanding from v_open_item where document_id = ${posted.id}`;
      if (partnerId === walkInId && Number(open?.outstanding ?? 0) > 0.0001) {
        throw new Error(tr("walkInFull"));
      }

      await tx`
        update document set created_by_id = ${user.id}, posted_by_id = ${user.id}
         where id = ${posted.id}`;
      return { id: posted.id, docNo: posted.docNo };
    });

    revalidatePath("/pos");
    revalidatePath("/");
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

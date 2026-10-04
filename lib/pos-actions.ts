"use server";

import { revalidatePath } from "next/cache";
import { sql } from "./db";
import { requirePermission, can, DISCOUNT_CEILING_PCT } from "./auth";
import { postRetailSale, postCustomerReceipt, type InvoiceLine } from "./posting";
import { posSearch, unitsOnShelf, stripCost } from "./phone";

// The till. Every action checks pos.sell on the server; cost leaves the
// server only for a role that may see it; discounts above the ceiling need
// discount.unlimited; a walk-in customer must pay in full.

export async function posSearchAction(locationId: string, q: string) {
  const user = await requirePermission("pos.sell");
  const r = await posSearch(user.companyId, locationId, q);
  return { units: stripCost(r.units, can(user, "cost.view")), items: r.items };
}

export async function posUnitsAction(itemId: string, locationId: string) {
  const user = await requirePermission("pos.sell");
  return stripCost(await unitsOnShelf(user.companyId, itemId, locationId), can(user, "cost.view"));
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
    const co = user.companyId;

    const lines: InvoiceLine[] = sale.lines
      .filter((l) => l.itemId && l.qty > 0)
      .map((l) => ({
        itemId: l.itemId, qty: Number(l.qty), unitPrice: Number(l.unitPrice),
        discountPct: Number(l.discountPct) || 0, taxCodeId: l.taxCodeId || null,
        serials: l.serials.length ? l.serials : undefined,
        warrantyMonths: l.warrantyMonths,
      }));
    if (lines.length === 0) return { ok: false, error: "The sale has no lines." };

    if (!can(user, "discount.unlimited")) {
      const over = lines.find((l) => (l.discountPct ?? 0) > DISCOUNT_CEILING_PCT);
      if (over) {
        return { ok: false, error: `Discounts above ${DISCOUNT_CEILING_PCT}% need a manager.` };
      }
    }

    const payments = sale.payments.filter((p) => p.accountId && Number(p.amount) > 0);
    // Money can only be taken into an account that holds money.
    if (payments.length) {
      const ok = await sql`
        select id from account where company_id = ${co} and is_cash_account
           and id = any(${payments.map((p) => p.accountId)})`;
      if (ok.length !== new Set(payments.map((p) => p.accountId)).size) {
        return { ok: false, error: "Choose a cash or bank account for each payment." };
      }
    }

    const walkInId = await walkIn(co);
    const partnerId = sale.partnerId || walkInId;
    const today = (await sql`select to_char(current_date, 'YYYY-MM-DD') as d`)[0].d as string;

    const result = await sql.begin(async (tx) => {
      // The same attempt twice is the same sale: a retried request finds the
      // first one rather than selling the handset again (which the serial
      // guard would refuse anyway, less helpfully).
      const [seen] = await tx`
        select id, doc_no from document
         where company_id = ${co} and doc_type = 'SALES_INVOICE' and reference = ${"POS:" + sale.attempt}`;
      if (seen) return { id: seen.id as string, docNo: seen.doc_no as string };

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
        throw new Error("A walk-in customer pays in full. Choose a customer to sell on account.");
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

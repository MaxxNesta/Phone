"use server";
import { isUuid, cleanStr } from "./input";

import { revalidatePath } from "next/cache";
import { requirePermission, can, DISCOUNT_CEILING_PCT } from "./auth";
import { assertMyBranch, seenLocations } from "./branch-scope";
import { receiptView, type ReceiptView } from "./receipt";
import type { InvoiceLine } from "./posting";
import { posSearch, unitsOnShelf, stripCost } from "./phone";
import { serverT } from "./i18n-server";
import { priceProblem } from "./price-guard";
import { postTillSale } from "./pos-sale";

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
  /** One per payment: how it was paid, how much, and the wallet's transaction id. */
  payments: Array<{ channelId: string; amount: number; reference?: string | null; accountId?: string | null }>;
  /** A key the till generated for this attempt, so a double click posts once. */
  attempt: string;
};

export type PosResult = { ok: true; id: string; docNo: string } | { ok: false; error: string };

export async function posPostSale(sale: PosSale): Promise<PosResult> {
  try {
    const user = await requirePermission("pos.sell");
    const tr = await serverT("pos");
    // The till sells at the cashier's own branch, whatever the request names.
    await assertMyBranch(sale.locationId);
    const co = user.companyId;
    // The sale arrives as an object, not a form: its shape is checked here,
    // because TypeScript's types do not exist by the time it reaches the server.
    if (!Array.isArray(sale.lines) || sale.lines.length > 300) return { ok: false, error: "Too many lines on one sale." };
    if (!Array.isArray(sale.payments) || sale.payments.length > 10) return { ok: false, error: "Too many payments on one sale." };
    for (const l of sale.lines) {
      if (!isUuid(l.itemId) || !Number.isFinite(Number(l.qty)) || !Number.isFinite(Number(l.unitPrice))
          || Number(l.unitPrice) < 0 || Math.abs(Number(l.qty)) > 100_000
          || (l.discountPct && (Number(l.discountPct) < 0 || Number(l.discountPct) > 100))
          || (l.serials && (!Array.isArray(l.serials) || l.serials.length > 1000))) {
        return { ok: false, error: "A line on this sale is not valid." };
      }
    }
    for (const p of sale.payments) {
      if (!Number.isFinite(Number(p.amount)) || Number(p.amount) < 0) return { ok: false, error: "A payment on this sale is not valid." };
    }
    sale.memo = cleanStr(sale.memo, "memo") || null;

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

    // Discount, typed price and free goods, checked against the price list on the server.
    const problem = await priceProblem(user, co, lines, sale.partnerId);
    if (problem) return { ok: false, error: tr(problem.key, problem.values) };

    const result = await postTillSale({
      companyId: co, userId: user.id, locationId: sale.locationId,
      partnerId: sale.partnerId, salesmanId: sale.salesmanId,
      priceIncludesTax: sale.priceIncludesTax, memo: sale.memo,
      lines, payments: sale.payments, attempt: sale.attempt,
    }, tr);

    revalidatePath("/pos");
    revalidatePath("/");
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, can, DISCOUNT_CEILING_PCT } from "./auth";
import { assertMyBranch, seenLocations } from "./branch-scope";
import { receiptView, type ReceiptView } from "./receipt";
import type { InvoiceLine } from "./posting";
import { posSearch, unitsOnShelf, stripCost } from "./phone";
import { serverT } from "./i18n-server";
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
  payments: Array<{ channelId: string; amount: number; reference?: string | null }>;
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

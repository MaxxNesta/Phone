"use server";

import { requirePermission } from "./auth";
import { seenLocations } from "./branch-scope";
import * as D from "./supplier-panel-data";
import type { Scope } from "./customer-panel-data";

/**
 * The supplier panel's loaders, as server actions: who is asking is checked
 * here (purchase.view), the queries live in supplier-panel-data.ts. Changing
 * a purchasing term goes through saveSupplierItem / deleteSupplierItem in
 * lib/actions.ts, which check purchase.post.
 */
async function who(): Promise<Scope> {
  const user = await requirePermission("purchase.view");
  return { co: user.companyId, locs: await seenLocations() };
}

export async function supplierOverview(partnerId: string) { return D.supplierOverview(await who(), partnerId); }
export async function supplierPurchases(partnerId: string, offset = 0) { return D.supplierPurchases(await who(), partnerId, offset); }
export async function supplierBills(partnerId: string, offset = 0) { return D.supplierBills(await who(), partnerId, offset); }
export async function billSettlements(partnerId: string, billId: string) { return D.billSettlements(await who(), partnerId, billId); }
export async function supplierTerms(partnerId: string) { return D.supplierTerms(await who(), partnerId); }
export async function termItems() { return D.termItems(await who()); }
export async function supplierActivity(partnerId: string, offset = 0) { return D.supplierActivity(await who(), partnerId, offset); }

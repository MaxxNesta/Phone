"use server";

import { requirePermission } from "./auth";
import { seenLocations } from "./branch-scope";
import * as D from "./customer-panel-data";

/**
 * The customer panel's loaders, as server actions: who is asking is checked
 * here, and the queries themselves live in customer-panel-data.ts.
 */
async function who(): Promise<D.Scope> {
  const user = await requirePermission("sales.view");
  return { co: user.companyId, locs: await seenLocations() };
}

export async function customerOverview(partnerId: string) { return D.customerOverview(await who(), partnerId); }
export async function customerSales(partnerId: string, offset = 0) { return D.customerSales(await who(), partnerId, offset); }
export async function customerInvoices(partnerId: string, offset = 0) { return D.customerInvoices(await who(), partnerId, offset); }
export async function invoiceSettlements(partnerId: string, invoiceId: string) { return D.invoiceSettlements(await who(), partnerId, invoiceId); }
export async function customerActivity(partnerId: string, offset = 0) { return D.customerActivity(await who(), partnerId, offset); }

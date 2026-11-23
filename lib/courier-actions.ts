"use server";
import { str } from "./input";
import { todayLocal } from "@/lib/format";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "./auth";
import { can } from "./auth-core";
import { sql } from "./db";
import { inTransaction } from "./posting";
import { assertMyBranch } from "./branch-scope";
import { payCourier, courierBill, type PreviewShare } from "./courier-payables";
import { courierCollected, remitCourier } from "./cod-couriers";

type Result = { error?: string } | null;


/** Pay a courier against the charges ticked on the form. */
export async function payCourierAction(_prev: Result, fd: FormData): Promise<Result> {
  const u = await requirePermission("accounting.post");
  let done: { id: string; docNo: string };
  try {
    const partnerId = str(fd, "partner_id");
    const locationId = str(fd, "location_id") || null;
    await assertMyBranch(locationId);
    const allocations = (JSON.parse(str(fd, "allocations") || "[]") as { chargeId: string; amount: number }[])
      .map((a) => ({ chargeId: String(a.chargeId), amount: Number(a.amount) }))
      .filter((a) => Number.isFinite(a.amount) && a.amount > 0);
    if (!partnerId) return { error: "Choose the courier being paid." };
    done = await payCourier({
      companyId: u.companyId, partnerId, docDate: str(fd, "doc_date") || todayLocal(),
      locationId, moneyAccountId: str(fd, "money_account_id"),
      reference: str(fd, "reference") || null, memo: str(fd, "memo") || null, allocations,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/payables");
  redirect(`/payables/couriers/${str(fd, "partner_id")}?toast=${encodeURIComponent(`Payment ${done.docNo} posted`)}`);
}

/** The bill as the form gives it, checked the same way for preview and post. */
async function billInput(u: { id: string; companyId: string }, fd: FormData) {
  if (!can(u as never, "cost.view")) throw new Error("Your account cannot see stock costs, so it cannot spread a charge onto phones.");
  const receiptIds = fd.getAll("receipt_id").map(String).filter(Boolean);
  const amount = Number(str(fd, "amount"));
  if (receiptIds.length === 0) throw new Error("Choose the goods receipt whose phones the courier carried.");
  if (!(amount > 0)) throw new Error("Enter the amount of the bill.");
  const rows = await sql`select location_id from document where company_id = ${u.companyId} and id = any(${receiptIds})`;
  await assertMyBranch(...rows.map((r) => r.location_id as string | null));
  return {
    companyId: u.companyId, userId: u.id, partnerId: str(fd, "partner_id"), receiptIds, amount,
    docDate: str(fd, "doc_date") || todayLocal(),
    method: (["VALUE", "WEIGHT"] as const).find((m) => m === str(fd, "method")) ?? ("EQUAL" as const),
    costTypeId: str(fd, "cost_type_id") || null,
    reference: str(fd, "reference") || null, notes: str(fd, "memo") || null,
    paidFromAccountId: str(fd, "paid_from") || null,
  };
}

/**
 * What Record and spread would do, phone by phone, without doing it: the
 * same calculation the posting runs, inside a transaction that is always
 * rolled back. Nothing is numbered, booked or kept.
 */
export async function previewCourierBillAction(fd: FormData): Promise<{ error?: string; shares?: PreviewShare[] }> {
  const u = await requirePermission("purchase.post");
  const rollback = new Error("preview");
  let shares: PreviewShare[] = [];
  try {
    const input = await billInput(u, fd);
    await inTransaction(undefined, async (tx) => {
      shares = ((await courierBill(tx, { ...input, preview: true })) as { shares?: PreviewShare[] }).shares ?? [];
      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) return { error: e instanceof Error ? e.message : String(e) };
  }
  return { shares };
}

/**
 * A courier's bill, spread onto the phones it carried, in one step: the
 * landed cost is created, calculated and posted in a single transaction,
 * so there is never a bill booked to Carriage Inward that nobody spread.
 */
export async function recordCourierBillAction(_prev: Result, fd: FormData): Promise<Result> {
  const u = await requirePermission("purchase.post");
  let lcId: string;
  try {
    const input = await billInput(u, fd);
    lcId = (await inTransaction(undefined, (tx) => courierBill(tx, input))).id;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/payables");
  redirect(`/purchases/landed-costs/${lcId}`);
}

/** Cash on delivery (0232): the courier says these parcels were delivered and paid. */
export async function courierCollectedAction(_prev: unknown, fd: FormData): Promise<{ error?: string; ok?: string } | null> {
  const u = await requirePermission("sales.post");
  try {
    const invoiceIds = fd.getAll("invoice_id").map(String).filter(Boolean);
    const rows = await sql`select location_id, courier_id from document where company_id = ${u.companyId} and id = any(${invoiceIds})`;
    await assertMyBranch(...rows.map((r) => r.location_id as string | null));
    const courierId = rows[0]?.courier_id as string | undefined;
    if (!courierId) return { error: "That invoice is not carried by a courier." };
    const posted = await inTransaction(undefined, (tx) => courierCollected(tx, {
      companyId: u.companyId, courierId, docDate: str(fd, "doc_date") || todayLocal(), invoiceIds }));
    for (const id of invoiceIds) revalidatePath(`/documents/${id}`);
    revalidatePath("/receivables");
    return { ok: `Collected by the courier · receipt ${posted.map((p) => p.docNo).join(", ")} posted` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** The courier pays in what it collected, its fee kept back. */
export async function remitCourierAction(_prev: Result, fd: FormData): Promise<Result> {
  const u = await requirePermission("sales.post");
  let done: { id: string; docNo: string };
  const courierId = str(fd, "courier_id");
  try {
    const locationId = str(fd, "location_id") || null;
    await assertMyBranch(locationId);
    if (!courierId) return { error: "Choose the courier paying in." };
    const n = (k: string) => { const v = Number(str(fd, k) || 0); if (!Number.isFinite(v)) throw new Error("Enter amounts as numbers."); return v; };
    done = await remitCourier({
      companyId: u.companyId, courierId, docDate: str(fd, "doc_date") || todayLocal(), locationId,
      moneyAccountId: str(fd, "money_account_id"), received: n("received"), fee: n("fee"),
      collectInvoiceIds: fd.getAll("invoice_id").map(String).filter(Boolean),
      reference: str(fd, "reference") || null, memo: str(fd, "memo") || null,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/receivables");
  redirect(`/documents/${done.id}?toast=${encodeURIComponent(`Paid in · ${done.docNo} posted`)}`);
}

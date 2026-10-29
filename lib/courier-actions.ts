"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "./auth";
import { can } from "./auth-core";
import { sql } from "./db";
import { inTransaction } from "./posting";
import { assertMyBranch } from "./branch-scope";
import { payCourier, courierBill } from "./courier-payables";

type Result = { error?: string } | null;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

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
      companyId: u.companyId, partnerId, docDate: str(fd, "doc_date") || new Date().toISOString().slice(0, 10),
      locationId, moneyAccountId: str(fd, "money_account_id"),
      reference: str(fd, "reference") || null, memo: str(fd, "memo") || null, allocations,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/payables");
  redirect(`/payables/couriers/${str(fd, "partner_id")}?toast=${encodeURIComponent(`Payment ${done.docNo} posted`)}`);
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
    if (!can(u, "cost.view")) throw new Error("Your account cannot see stock costs, so it cannot spread a charge onto phones.");
    const receiptIds = fd.getAll("receipt_id").map(String).filter(Boolean);
    const partnerId = str(fd, "partner_id");
    const amount = Number(str(fd, "amount"));
    const paidFromAccountId = str(fd, "paid_from") || null;
    if (receiptIds.length === 0) return { error: "Choose the goods receipt whose phones the courier carried." };
    if (!(amount > 0)) return { error: "Enter the amount of the bill." };
    const rows = await sql`select location_id from document where company_id = ${u.companyId} and id = any(${receiptIds})`;
    await assertMyBranch(...rows.map((r) => r.location_id as string | null));
    lcId = (await inTransaction(undefined, (tx) => courierBill(tx, {
      companyId: u.companyId, userId: u.id, partnerId, receiptIds, amount,
      docDate: str(fd, "doc_date") || new Date().toISOString().slice(0, 10),
      method: str(fd, "method") === "VALUE" ? "VALUE" : "EQUAL",
      costTypeId: str(fd, "cost_type_id") || null,
      reference: str(fd, "reference") || null, notes: str(fd, "memo") || null, paidFromAccountId,
    }))).id;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/payables");
  redirect(`/purchases/landed-costs/${lcId}`);
}

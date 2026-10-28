"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "./auth";
import { assertMyBranch } from "./branch-scope";
import { payCourier } from "./courier-payables";

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

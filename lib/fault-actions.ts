"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "./auth";
import { reportFaulty } from "./posting";

/**
 * A unit found faulty after its receipt was posted (0224, docs/06 D-P7): what
 * is wrong, replace or credit, and into the warehouse's quarantine bin. Done
 * by whoever manages stock, since it moves stock.
 */
export async function reportFaultyAction(_prev: unknown, fd: FormData): Promise<{ error: string } | void> {
  const user = await requirePermission("inventory.manage");
  const receiptId = String(fd.get("receipt_id") ?? "");
  const outcome = String(fd.get("outcome") ?? "");
  const reason = String(fd.get("reason") ?? "");
  const lineIds = fd.getAll("line_id").map(String);
  const lines = lineIds.map((id) => ({
    receiptLineId: id,
    serials: fd.getAll(`serial_${id}`).map(String),
    qty: Number(fd.get(`qty_${id}`) ?? 0) || undefined,
  }));
  try {
    if (outcome !== "REPLACE" && outcome !== "CREDIT") return { error: "Choose whether the supplier replaces or credits it." };
    await reportFaulty({ companyId: user.companyId, receiptId, reason, outcome, userId: user.id, lines });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath(`/documents/${receiptId}`);
  revalidatePath("/inventory");
  redirect(`/documents/${receiptId}`);
}

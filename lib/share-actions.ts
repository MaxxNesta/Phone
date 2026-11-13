"use server";
import { str } from "./input";
import { todayLocal } from "@/lib/format";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "./auth";
import { createShareholder, updateShareholder, postShareTransfer, cancelShareTransfer, type ShareType, type TransferType, type ShareholderInput } from "./shares";

type Result = { error?: string } | null;
const PATH = "/equity";

export async function createShareholderAction(_prev: Result, fd: FormData): Promise<Result> {
  const u = await requirePermission("accounting.post");
  let code: string;
  try {
    code = (await createShareholder(u.companyId, holderFrom(fd))).code;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath(PATH, "layout");
  redirect(`${PATH}/shareholders?toast=${encodeURIComponent(`Shareholder ${code} added. Issue shares to give it a balance.`)}`);
}

const num = (fd: FormData, k: string) => (str(fd, k).replace(/,/g, "") === "" ? null : Number(str(fd, k).replace(/,/g, "")));
const holderFrom = (fd: FormData): ShareholderInput => ({
  name: str(fd, "name"), isCompany: fd.get("is_company") !== null,
  phone: str(fd, "phone"), email: str(fd, "email"), address: str(fd, "address"), notes: str(fd, "notes"),
  equityAccountId: str(fd, "equity_account_id") || null, noOfShares: num(fd, "no_of_shares"), sharePrice: num(fd, "share_price"),
});

export async function updateShareholderAction(_prev: Result, fd: FormData): Promise<Result> {
  const u = await requirePermission("accounting.post");
  let code: string;
  try {
    code = (await updateShareholder(u.companyId, str(fd, "id"), holderFrom(fd))).code;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath(PATH, "layout");
  redirect(`${PATH}/shareholders?toast=${encodeURIComponent(`Shareholder ${code} saved`)}`);
}

export async function postShareTransferAction(_prev: Result, fd: FormData): Promise<Result> {
  const u = await requirePermission("accounting.post");
  let no: string;
  try {
    const type = str(fd, "transfer_type") as TransferType;
    if (!["ISSUE", "PURCHASE", "TRANSFER"].includes(type)) return { error: "Choose Issue, Transfer or Purchase." };
    no = (await postShareTransfer({
      companyId: u.companyId, userId: u.id, type, date: str(fd, "transfer_date"),
      shareType: (str(fd, "share_type") === "PREFERENCE" ? "PREFERENCE" : "EQUITY") as ShareType,
      fromShareholderId: str(fd, "from_shareholder_id") || null, toShareholderId: str(fd, "to_shareholder_id") || null,
      noOfShares: Number(str(fd, "no_of_shares")), fromNo: Number(str(fd, "from_no")), rate: Number(str(fd, "rate")),
      equityAccountId: str(fd, "equity_account_id"), assetAccountId: str(fd, "asset_account_id") || null,
      remarks: str(fd, "remarks") || null,
    })).no;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath(PATH, "layout");
  redirect(`${PATH}/transfers?toast=${encodeURIComponent(`Share transfer ${no} posted`)}`);
}

export async function cancelShareTransferAction(_prev: Result, fd: FormData): Promise<Result> {
  const u = await requirePermission("accounting.post");
  let no: string;
  try {
    no = (await cancelShareTransfer(u.companyId, str(fd, "id"), todayLocal())).no;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath(PATH, "layout");
  redirect(`${PATH}/transfers?toast=${encodeURIComponent(`${no} cancelled`)}`);
}

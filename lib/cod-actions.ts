"use server";

/**
 * Cash on delivery from the screens (0233): dispatch, the doorstep handover,
 * a partial payment, not home, refused, the return scanned back in, a credit
 * dispatch confirmed delivered, and the cashier receiving a driver's cash.
 * Each checks the branch and calls lib/cod.ts, where the rules live.
 */

import { revalidatePath } from "next/cache";
import { str } from "./input";
import { todayLocal } from "./format";
import { requirePermission } from "./auth";
import { sql } from "./db";
import { assertMyBranch } from "./branch-scope";
import { postOnce } from "./idempotency";
import {
  codDispatch, confirmHandover, lostInTransit, notHome, parcel, receiveFromDriver, receiveReturn, recordDeposit, refused, type Payment,
} from "./cod";

type Result = { error?: string; ok?: string } | null;
const fail = (e: unknown): Result => ({ error: e instanceof Error ? e.message : String(e) });
const key = (fd: FormData) => { const k = str(fd, "idempotency_key"); return k && k.length <= 100 ? k : null; };

function refresh(...ids: (string | null | undefined)[]) {
  for (const id of ids) if (id) revalidatePath(`/documents/${id}`);
  revalidatePath("/receivables");
  revalidatePath("/sales/invoices");
}

/** "D:<driver>" or "C:<courier>", as the Delivered by select sends it. */
function collector(fd: FormData) {
  const v = str(fd, "collector");
  return { driverId: v.startsWith("D:") ? v.slice(2) : null, courierId: v.startsWith("C:") ? v.slice(2) : null };
}

function payment(fd: FormData): Payment {
  const to = (["DRIVER", "ACCOUNT", "COURIER"] as const).find((t) => t === str(fd, "pay_to")) ?? "DRIVER";
  const amount = Number(str(fd, "amount") || 0);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Enter the amount as a number.");
  return { to, amount, accountId: str(fd, "account_id") || null, verified: fd.get("verified") !== null, reference: str(fd, "reference") || null };
}

async function parcelInBranch(companyId: string, parcelId: string) {
  const p = await parcel(parcelId);
  if (!p) throw new Error("That is not a cash-on-delivery parcel.");
  const [i] = await sql`select company_id from document where id = ${p.invoiceId}`;
  if (i?.company_id !== companyId) throw new Error("That is not a cash-on-delivery parcel.");
  await assertMyBranch(p.warehouseId);
  return p;
}

export async function dispatchCodAction(_prev: Result, fd: FormData): Promise<Result> {
  const u = await requirePermission("sales.post");
  try {
    const invoiceId = str(fd, "invoice_id");
    const [inv] = await sql`select location_id from document where id = ${invoiceId} and company_id = ${u.companyId}`;
    if (!inv) return { error: "That invoice no longer exists." };
    await assertMyBranch(inv.location_id as string);
    const lines = JSON.parse(str(fd, "lines") || "[]") as { lineId: string; qty: number; serials?: string[] }[];
    const t = await postOnce(u.companyId, key(fd), (tx) => codDispatch(tx, {
      companyId: u.companyId, invoiceId, docDate: str(fd, "doc_date") || todayLocal(), ...collector(fd),
      lines: lines.map((l) => ({ lineId: String(l.lineId), qty: Number(l.qty), serials: (l.serials ?? []).map(String) })),
    }));
    refresh(invoiceId);
    return { ok: `Dispatched · ${t.docNo}` };
  } catch (e) { return fail(e); }
}

export async function handoverAction(_prev: Result, fd: FormData): Promise<Result> {
  const u = await requirePermission("sales.post");
  try {
    const p = await parcelInBranch(u.companyId, str(fd, "parcel_id"));
    const pay = payment(fd);
    const done = await postOnce(u.companyId, key(fd), async (tx) => {
      const r = await confirmHandover(tx, { companyId: u.companyId, parcelId: p.id, docDate: str(fd, "doc_date") || todayLocal(), payment: pay, userId: u.id });
      return { id: r.delivery.id, docNo: r.delivery.docNo };
    });
    refresh(p.invoiceId);
    return { ok: done.repeated ? `Already handed over · ${done.docNo}` : `Paid and handed over · ${done.docNo}` };
  } catch (e) { return fail(e); }
}

export async function depositAction(_prev: Result, fd: FormData): Promise<Result> {
  const u = await requirePermission("sales.post");
  try {
    const p = await parcelInBranch(u.companyId, str(fd, "parcel_id"));
    const pay = payment(fd);
    const r = await postOnce(u.companyId, key(fd), (tx) => recordDeposit(tx, { companyId: u.companyId, parcelId: p.id, docDate: str(fd, "doc_date") || todayLocal(), payment: pay }));
    refresh(p.invoiceId);
    return { ok: `Partial payment kept as a deposit · ${r.docNo}` };
  } catch (e) { return fail(e); }
}

export async function notHomeAction(_prev: Result, fd: FormData): Promise<Result> {
  const u = await requirePermission("sales.post");
  try {
    const p = await parcelInBranch(u.companyId, str(fd, "parcel_id"));
    await notHome(sql, { companyId: u.companyId, parcelId: p.id, reason: str(fd, "reason"), retryOn: str(fd, "retry_on") || null, userId: u.id });
    refresh(p.invoiceId);
    return { ok: "Not home · kept for another try" };
  } catch (e) { return fail(e); }
}

export async function refusedAction(_prev: Result, fd: FormData): Promise<Result> {
  const u = await requirePermission("sales.post");
  try {
    const p = await parcelInBranch(u.companyId, str(fd, "parcel_id"));
    await refused(sql, { companyId: u.companyId, parcelId: p.id, reason: str(fd, "reason"), userId: u.id });
    refresh(p.invoiceId);
    return { ok: "Refused · coming back to the shop" };
  } catch (e) { return fail(e); }
}

export async function receiveReturnAction(_prev: Result, fd: FormData): Promise<Result> {
  const u = await requirePermission("sales.post");
  try {
    const p = await parcelInBranch(u.companyId, str(fd, "parcel_id"));
    const scanned = str(fd, "scanned").split(/[\s,]+/).filter(Boolean);
    const counted = Object.fromEntries([...fd.keys()].filter((k) => k.startsWith("count_"))
      .map((k) => [k.slice(6), Number(str(fd, k))]));
    const t = await postOnce(u.companyId, key(fd), (tx) => receiveReturn(tx, { companyId: u.companyId, parcelId: p.id, docDate: str(fd, "doc_date") || todayLocal(), scanned, counted, userId: u.id }));
    refresh(p.invoiceId);
    return { ok: `Back in stock · ${t.docNo}` };
  } catch (e) { return fail(e); }
}

/** A credit sale's delivery reached the customer: the one event that says so. */
export async function confirmDeliveredAction(_prev: Result, fd: FormData): Promise<Result> {
  const u = await requirePermission("sales.post");
  try {
    const id = str(fd, "delivery_id");
    const [d] = await sql`
      select d.id, d.source_document_id, d.location_id, d.status from document d
       where d.id = ${id} and d.company_id = ${u.companyId} and d.doc_type = 'DELIVERY'`;
    if (!d || d.status !== "POSTED") return { error: "That delivery is not posted." };
    await assertMyBranch(d.location_id as string);
    await sql`
      insert into dispatch_event (company_id, parcel_id, invoice_id, kind, acted_by)
      select ${u.companyId}, ${d.id}, ${d.source_document_id}, 'DELIVERED', ${u.id}
       where not exists (select 1 from dispatch_event where parcel_id = ${d.id} and kind = 'DELIVERED')`;
    await sql`update delivery_trip_stop set status = 'DELIVERED', delivered_at = now() where document_id = ${d.id}`;
    refresh(d.source_document_id as string, d.id as string);
    return { ok: "Delivered" };
  } catch (e) { return fail(e); }
}

export async function receiveFromDriverAction(_prev: Result, fd: FormData): Promise<Result> {
  const u = await requirePermission("sales.post");
  try {
    const locationId = str(fd, "location_id") || null;
    await assertMyBranch(locationId);
    const counted = Number(str(fd, "counted") || 0);
    if (!Number.isFinite(counted)) return { error: "Enter the cash counted as a number." };
    const v = await postOnce(u.companyId, key(fd), (tx) => receiveFromDriver({
      companyId: u.companyId, driverId: str(fd, "driver_id"), docDate: str(fd, "doc_date") || todayLocal(), locationId,
      tillAccountId: str(fd, "till_account_id"), counted, receiptIds: fd.getAll("receipt_id").map(String), memo: str(fd, "memo") || null,
    }, tx));
    revalidatePath("/receivables");
    return { ok: `Received · ${v.docNo}` };
  } catch (e) { return fail(e); }
}

/** Lost in transit (0235): a stock loss, so it is for whoever may adjust stock. */
export async function lostInTransitAction(_prev: Result, fd: FormData): Promise<Result> {
  const u = await requirePermission("inventory.manage");
  try {
    const p = await parcelInBranch(u.companyId, str(fd, "parcel_id"));
    const bearer = str(fd, "bearer") === "CARRIER" ? "CARRIER" as const : "SHOP" as const;
    const adj = await postOnce(u.companyId, key(fd), (tx) => lostInTransit(tx, {
      companyId: u.companyId, parcelId: p.id, docDate: str(fd, "doc_date") || todayLocal(),
      reason: str(fd, "reason"), bearer, userId: u.id }));
    refresh(p.invoiceId);
    return { ok: `Written off · ${adj.docNo}` };
  } catch (e) { return fail(e); }
}

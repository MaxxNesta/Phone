"use server";

import { revalidatePath } from "next/cache";
import type { Sql } from "postgres";
import { sql } from "./db";
import { requirePermission } from "./auth";
import type { ActionResult } from "./actions";

// Settings → Payment methods. Admin only (settings.manage). Every change is
// written to payment_channel_audit with who made it. A channel's account
// must hold money; the database trigger refuses anything else.

const KINDS = ["CASH", "BANK", "WALLET", "QR", "CARD", "OTHER"];
const PATH = "/settings/payment-methods";
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

async function audit(db: Sql, co: string, channelId: string | null, userId: string, action: string, detail: unknown) {
  await db`
    insert into payment_channel_audit (company_id, channel_id, action, detail, acted_by)
    values (${co}, ${channelId}, ${action}, ${JSON.stringify(detail)}::jsonb, ${userId})`;
}

/**
 * A wallet's own account, made when a shop first maps one: a bank account
 * filed beside Cash at Bank, coded in the 1011-1019 block next to it. An
 * account of that name already in the chart is reused rather than doubled.
 */
async function walletAccount(db: Sql, co: string, name: string): Promise<string> {
  const [have] = await db`
    select id from account where company_id = ${co} and lower(name) = lower(${name}) and is_cash_account and is_postable`;
  if (have) return have.id as string;
  const [bank] = await db`
    select parent_id from account where company_id = ${co} and is_bank_account order by (code = '1010') desc, code limit 1`;
  const [free] = await db`
    select c::text as code from generate_series(1011, 1019) c
     where not exists (select 1 from account where company_id = ${co} and code = c::text) limit 1`;
  if (!free) throw new Error("No free account code between 1011 and 1019. Add the account in the chart of accounts, then choose it here.");
  const [made] = await db`
    insert into account (company_id, parent_id, code, name, account_type, is_cash_account, is_bank_account)
    values (${co}, ${bank?.parent_id ?? null}, ${free.code}, ${name}, 'ASSET', true, true) returning id`;
  return made.id as string;
}

/** Sets (or clears, with "") where a channel pays into, for the company or one branch. */
async function setAccount(db: Sql, co: string, channelId: string, branchId: string | null, value: string, name: string, userId: string) {
  if (!value) {
    await db`delete from payment_channel_account
              where channel_id = ${channelId} and branch_id is not distinct from ${branchId}`;
    return;
  }
  const accountId = value === "__new" ? await walletAccount(db, co, name) : value;
  await db`
    insert into payment_channel_account (company_id, channel_id, branch_id, account_id, updated_by_id)
    values (${co}, ${channelId}, ${branchId}, ${accountId}, ${userId})
    on conflict (channel_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set account_id = excluded.account_id, updated_at = now(), updated_by_id = excluded.updated_by_id`;
}

function fields(fd: FormData) {
  const name = str(fd, "name");
  const kind = str(fd, "kind");
  if (!name) throw new Error("Enter a name");
  if (!KINDS.includes(kind)) throw new Error("Choose what kind of payment this is");
  return {
    name, kind,
    requiresReference: fd.get("requires_reference") === "on",
    merchantName: str(fd, "merchant_name") || null,
    merchantNumber: str(fd, "merchant_number") || null,
    sortOrder: Math.max(0, Math.min(999, Math.round(Number(str(fd, "sort_order")) || 100))),
  };
}

const failed = (e: unknown): ActionResult => {
  const code = (e as { code?: string }).code;
  if (code === "23505") return { error: "A payment method with that name already exists" };
  return { error: e instanceof Error ? e.message : String(e) };
};

export async function createPaymentChannel(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("settings.manage");
  const co = user.companyId;
  try {
    const f = fields(fd);
    await sql.begin(async (tx) => {
      const code = f.name.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 20) || "CHANNEL";
      const [c] = await tx`
        insert into payment_channel (company_id, code, name, kind, requires_reference, merchant_name, merchant_number,
                                     sort_order, created_by_id, updated_by_id)
        values (${co}, ${code + "-" + Date.now().toString(36).slice(-4).toUpperCase()}, ${f.name}, ${f.kind},
                ${f.requiresReference}, ${f.merchantName}, ${f.merchantNumber}, ${f.sortOrder}, ${user.id}, ${user.id})
        returning id`;
      const account = str(fd, "account_default");
      if (account) await setAccount(tx as never, co, c.id, null, account, f.name, user.id);
      await audit(tx as never, co, c.id, user.id, "CREATE", { ...f, account });
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function updatePaymentChannel(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("settings.manage");
  const co = user.companyId;
  const id = str(fd, "id");
  try {
    const f = fields(fd);
    await sql.begin(async (tx) => {
      const [c] = await tx`
        update payment_channel set name = ${f.name}, kind = ${f.kind}, requires_reference = ${f.requiresReference},
               merchant_name = ${f.merchantName}, merchant_number = ${f.merchantNumber}, sort_order = ${f.sortOrder},
               updated_at = now(), updated_by_id = ${user.id}
         where id = ${id} and company_id = ${co} returning id`;
      if (!c) throw new Error("That payment method no longer exists");
      await setAccount(tx as never, co, id, null, str(fd, "account_default"), f.name, user.id);
      const branches = await tx`select id from location where company_id = ${co} and parent_id is null`;
      const perBranch: Record<string, string> = {};
      for (const b of branches) {
        const v = str(fd, `account_${b.id}`);
        perBranch[b.id] = v;
        await setAccount(tx as never, co, id, b.id as string, v, f.name, user.id);
      }
      await audit(tx as never, co, id, user.id, "UPDATE", { ...f, account: str(fd, "account_default"), perBranch });
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function setPaymentChannelActive(fd: FormData): Promise<void> {
  const user = await requirePermission("settings.manage");
  const active = str(fd, "active") === "1";
  const id = str(fd, "id");
  await sql.begin(async (tx) => {
    const [c] = await tx`
      update payment_channel set is_active = ${active}, updated_at = now(), updated_by_id = ${user.id}
       where id = ${id} and company_id = ${user.companyId} returning id`;
    if (c) await audit(tx as never, user.companyId, id, user.id, active ? "ACTIVATE" : "DEACTIVATE", null);
  });
  revalidatePath(PATH);
}

/** Only a channel no payment has used; one that has is deactivated instead. */
export async function deletePaymentChannel(fd: FormData): Promise<void> {
  const user = await requirePermission("settings.manage");
  const id = str(fd, "id");
  await sql.begin(async (tx) => {
    const [used] = await tx`select 1 from document where payment_channel_id = ${id} limit 1`;
    if (used) {
      await tx`update payment_channel set is_active = false, updated_at = now(), updated_by_id = ${user.id}
                where id = ${id} and company_id = ${user.companyId}`;
      await audit(tx as never, user.companyId, id, user.id, "DEACTIVATE", { reason: "used by payments, not deleted" });
      return;
    }
    const [gone] = await tx`delete from payment_channel where id = ${id} and company_id = ${user.companyId} returning name`;
    if (gone) await audit(tx as never, user.companyId, null, user.id, "DELETE", { id, name: gone.name });
  });
  revalidatePath(PATH);
}

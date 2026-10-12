"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "./db";
import { requirePermission } from "./auth";
import { can } from "./auth-core";
import { assertMyBranch } from "./branch-scope";
import * as L from "./landed-cost";

type Result = { error?: string; ok?: string } | null;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Posting a landed cost changes stock costs: purchasing and cost visibility both. */
async function poster() {
  const u = await requirePermission("purchase.post");
  if (!can(u, "cost.view")) throw new Error("Your account cannot see stock costs, so it cannot post landed costs.");
  return u;
}

/** Every receipt has to be at a branch this person works at. */
async function assertReceiptBranches(companyId: string, receiptIds: string[]) {
  if (receiptIds.length === 0) return;
  const rows = await sql`select location_id from document where company_id = ${companyId} and id = any(${receiptIds})`;
  await assertMyBranch(...rows.map((r) => r.location_id as string | null));
}

async function receiptsOf(id: string) {
  return (await sql`select receipt_id from landed_cost_receipt where landed_cost_id = ${id}`).map((r) => r.receipt_id as string);
}

export async function createLandedCostAction(fd: FormData) {
  const u = await poster();
  const receiptIds = fd.getAll("receipt_id").map(String).filter(Boolean);
  await assertReceiptBranches(u.companyId, receiptIds);
  const lc = await L.createLandedCost({
    companyId: u.companyId, userId: u.id,
    docDate: str(fd, "doc_date") || new Date().toISOString().slice(0, 10),
    receiptIds, templateId: str(fd, "template_id") || null,
    shipmentRef: str(fd, "shipment_ref"), carrierRef: str(fd, "carrier_ref"),
  });
  redirect(`/purchases/landed-costs/${lc.id}`);
}

export async function saveLandedCostAction(_prev: Result, fd: FormData): Promise<Result> {
  try {
    const u = await poster();
    const input = JSON.parse(str(fd, "payload")) as L.DraftInput & { id: string };
    await assertReceiptBranches(u.companyId, [...input.receiptIds, ...(await receiptsOf(input.id))]);
    await L.saveLandedCost({ ...input, companyId: u.companyId, userId: u.id });
    revalidatePath(`/purchases/landed-costs/${input.id}`);
    return { ok: "Saved. Calculate to see each phone's share." };
  } catch (e) { return { error: msg(e) }; }
}

/** One step on a draft or a posted document: the id, and which step. */
export async function landedCostStepAction(_prev: Result, fd: FormData): Promise<Result> {
  const id = str(fd, "id");
  const step = str(fd, "step");
  try {
    const u = await poster();
    await assertReceiptBranches(u.companyId, await receiptsOf(id));
    const actor = { companyId: u.companyId, userId: u.id, id };
    if (step === "acknowledge") await L.acknowledgeExcluded(actor);
    else if (step === "calculate") await L.calculateLandedCost(actor);
    else if (step === "post") await L.postLandedCost(actor);
    else if (step === "reverse") {
      if (!can(u, "documents.void")) throw new Error("Your account cannot reverse posted documents. Ask a manager.");
      await L.reverseLandedCost({ ...actor, reason: str(fd, "reason"), date: str(fd, "date") || undefined });
    } else if (step === "delete") {
      await L.deleteLandedCost(actor);
      revalidatePath("/purchases/landed-costs");
      return { ok: "Draft discarded." };
    } else throw new Error("Unknown step.");
    revalidatePath(`/purchases/landed-costs/${id}`);
    revalidatePath("/purchases/landed-costs");
    return { ok: { acknowledge: "Noted.", calculate: "Calculated.", post: "Posted.", reverse: "Reversed." }[step] };
  } catch (e) { return { error: msg(e) }; }
}

// ------------------------------------------------------------ settings --

export async function saveCostTypeAction(_prev: Result, fd: FormData): Promise<Result> {
  try {
    const u = await requirePermission("settings.manage");
    const id = str(fd, "id");
    const code = str(fd, "code").toUpperCase();
    const name = str(fd, "name");
    const method = str(fd, "default_method") as L.Method;
    if (!code || !name) return { error: "A cost type needs a code and a name." };
    if (!["VALUE", "EQUAL", "MANUAL"].includes(method)) return { error: "Choose a default allocation method." };
    const vals = {
      code, name, method,
      account: str(fd, "clearing_account_id") || null,
      partner: str(fd, "default_partner_id") || null,
      currency: str(fd, "default_currency") || null,
      active: fd.get("is_active") !== null,
    };
    if (id) {
      await sql`
        update landed_cost_type set code = ${vals.code}, name = ${vals.name}, default_method = ${vals.method},
               clearing_account_id = ${vals.account}, default_partner_id = ${vals.partner},
               default_currency = ${vals.currency}, is_active = ${vals.active}
         where id = ${id} and company_id = ${u.companyId}`;
    } else {
      await sql`
        insert into landed_cost_type (company_id, code, name, default_method, clearing_account_id, default_partner_id, default_currency)
        values (${u.companyId}, ${vals.code}, ${vals.name}, ${vals.method}, ${vals.account}, ${vals.partner}, ${vals.currency})`;
    }
    revalidatePath("/settings/landed-cost-types");
    return { ok: id ? "Saved." : `${name} added.` };
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return { error: "That code is already used by another cost type." };
    return { error: msg(e) };
  }
}

export async function saveTemplateAction(_prev: Result, fd: FormData): Promise<Result> {
  try {
    const u = await requirePermission("settings.manage");
    const id = str(fd, "id");
    const name = str(fd, "name");
    if (!name) return { error: "Give the template a name." };
    const lines = fd.getAll("line_type").map(String).map((t, i) => ({
      type: t, method: String(fd.getAll("line_method")[i] ?? "VALUE"),
    })).filter((l) => l.type);
    await sql.begin(async (tx) => {
      const [t] = id
        ? await tx`update landed_cost_template set name = ${name}, is_active = ${fd.get("is_active") !== null}
                    where id = ${id} and company_id = ${u.companyId} returning id`
        : await tx`insert into landed_cost_template (company_id, name) values (${u.companyId}, ${name}) returning id`;
      if (!t) throw new Error("Template not found.");
      await tx`delete from landed_cost_template_line where template_id = ${t.id}`;
      for (const [i, l] of lines.entries()) {
        await tx`
          insert into landed_cost_template_line (template_id, line_no, cost_type_id, method)
          select ${t.id}, ${i + 1}, id, ${l.method} from landed_cost_type where id = ${l.type} and company_id = ${u.companyId}
          on conflict (template_id, cost_type_id) do nothing`;
      }
    });
    revalidatePath("/settings/landed-cost-templates");
    return { ok: id ? "Saved." : `${name} added.` };
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return { error: "A template with that name already exists." };
    return { error: msg(e) };
  }
}

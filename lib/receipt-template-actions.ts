"use server";

import { revalidatePath } from "next/cache";
import { sql } from "./db";
import { requirePermission, requireUser } from "./auth";
import { can, type SessionUser } from "./auth-core";
import { seenLocations } from "./branch-scope";
import { sanitizeConfig, cleanText, PAPERS, type Paper, type ReceiptData } from "./receipt-config";
import { receiptView, mayEditReceiptTemplate } from "./receipt";

type Result = { error?: string; ok?: string; id?: string; version?: number } | null;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const PATH = "/settings/receipt-templates";

const mayEdit = mayEditReceiptTemplate;

/** Locked in the caller's transaction, so two edits of one template queue. */
async function loadForEdit(tx: typeof sql, u: SessionUser, id: string) {
  const [t] = await tx`
    select id, company_id, branch_id, name, paper, is_active, is_default, published_version
      from receipt_template where id = ${id} and company_id = ${u.companyId} for update`;
  if (!t) throw new Error("Template not found.");
  if (!mayEdit(u, t.branch_id)) throw new Error("You can change only your own branch's receipt templates.");
  return t as { id: string; branch_id: string | null; name: string; paper: Paper; is_active: boolean;
    is_default: boolean; published_version: number | null };
}

async function audit(tx: typeof sql, u: SessionUser, templateId: string, action: string, detail?: unknown) {
  await tx`
    insert into receipt_template_audit (company_id, template_id, action, acted_by, detail)
    values (${u.companyId}, ${templateId}, ${action}, ${u.id}, ${detail === undefined ? null : tx.json(detail as never)})`;
}

const paperOf = (v: unknown): Paper => {
  if (!PAPERS.includes(v as Paper)) throw new Error("Choose 58 mm, 80 mm or A4.");
  return v as Paper;
};

export async function createReceiptTemplate(input: { name: string; paper: string; branchId: string | null; copyFrom?: string | null }): Promise<Result> {
  try {
    const u = await requirePermission("receipts.manage");
    const name = cleanText(input.name, 80);
    if (!name) return { error: "Give the template a name." };
    const paper = paperOf(input.paper);
    const branchId = input.branchId || null;
    if (!mayEdit(u, branchId)) {
      return { error: u.branchId ? "You can add templates for your own branch only." : "Only an administrator can add a company template." };
    }
    if (branchId) {
      const [b] = await sql`select 1 from location where id = ${branchId} and company_id = ${u.companyId} and parent_id is null`;
      if (!b) return { error: "That branch is not one of this company's." };
    }
    let draft = sanitizeConfig({}, paper);
    if (input.copyFrom) {
      const [src] = await sql`select draft_config, branch_id from receipt_template where id = ${input.copyFrom} and company_id = ${u.companyId}`;
      if (src) draft = sanitizeConfig(src.draft_config, paper);
    }
    const id = await sql.begin(async (tx) => {
      const [t] = await tx`
        insert into receipt_template (company_id, branch_id, name, paper, draft_config, created_by, updated_by)
        values (${u.companyId}, ${branchId}, ${name}, ${paper}, ${tx.json(draft as never)}, ${u.id}, ${u.id})
        returning id`;
      await audit(tx as never, u, t.id, "CREATE", { name, paper, branchId });
      return t.id as string;
    });
    revalidatePath(PATH);
    return { ok: `${name} created as a draft.`, id };
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return { error: "A template with that name already exists." };
    return { error: msg(e) };
  }
}

/** The draft only: nothing a sale prints changes until it is published. */
export async function saveReceiptDraft(input: { id: string; name: string; paper: string; config: unknown }): Promise<Result> {
  try {
    const u = await requirePermission("receipts.manage");
    const name = cleanText(input.name, 80);
    if (!name) return { error: "Give the template a name." };
    const paper = paperOf(input.paper);
    const config = sanitizeConfig(input.config, paper);
    await sql.begin(async (tx) => {
      const t = await loadForEdit(tx as never, u, input.id);
      await tx`
        update receipt_template set name = ${name}, paper = ${paper}, draft_config = ${tx.json(config as never)},
               updated_at = now(), updated_by = ${u.id}
         where id = ${t.id}`;
      await audit(tx as never, u, t.id, "SAVE_DRAFT", { name, paper });
    });
    revalidatePath(PATH);
    return { ok: "Draft saved. Sales keep printing the published version until you publish." };
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return { error: "A template with that name already exists." };
    return { error: msg(e) };
  }
}

/**
 * The draft becomes a new published version. Versions are never changed, so
 * a sale already printed under an earlier one still reprints the same.
 */
export async function publishReceiptTemplate(input: { id: string }): Promise<Result> {
  try {
    const u = await requirePermission("receipts.manage");
    const version = await sql.begin(async (tx) => {
      const t = await loadForEdit(tx as never, u, input.id);
      const [d] = await tx`select draft_config from receipt_template where id = ${t.id}`;
      const config = sanitizeConfig(d.draft_config, t.paper);
      const next = (t.published_version ?? 0) + 1;
      await tx`
        insert into receipt_template_version (template_id, version, paper, config, published_by)
        values (${t.id}, ${next}, ${t.paper}, ${tx.json(config as never)}, ${u.id})`;
      await tx`
        update receipt_template set published_version = ${next}, published_at = now(), published_by = ${u.id},
               updated_at = now(), updated_by = ${u.id}
         where id = ${t.id}`;
      await audit(tx as never, u, t.id, "PUBLISH", { version: next, paper: t.paper });
      return next;
    });
    revalidatePath(PATH);
    return { ok: `Published as version ${version}. New sales print with it.`, version };
  } catch (e) {
    return { error: msg(e) };
  }
}

/** The template its scope's sales print with: the company's, or one branch's. */
export async function setDefaultReceiptTemplate(input: { id: string }): Promise<Result> {
  try {
    const u = await requirePermission("receipts.manage");
    await sql.begin(async (tx) => {
      const t = await loadForEdit(tx as never, u, input.id);
      if (!t.published_version) throw new Error("Publish the template before making it the default.");
      if (!t.is_active) throw new Error("Turn the template on before making it the default.");
      await tx`
        update receipt_template set is_default = false
         where company_id = ${u.companyId} and is_default and id <> ${t.id}
           and branch_id is not distinct from ${t.branch_id}`;
      await tx`update receipt_template set is_default = true, updated_at = now(), updated_by = ${u.id} where id = ${t.id}`;
      await audit(tx as never, u, t.id, "SET_DEFAULT", { branchId: t.branch_id });
    });
    revalidatePath(PATH);
    return { ok: "Now the default." };
  } catch (e) {
    return { error: msg(e) };
  }
}

/** Off means no sale prints with it; a default turned off stops being the default. */
export async function setReceiptTemplateActive(input: { id: string; active: boolean }): Promise<Result> {
  try {
    const u = await requirePermission("receipts.manage");
    await sql.begin(async (tx) => {
      const t = await loadForEdit(tx as never, u, input.id);
      await tx`
        update receipt_template set is_active = ${input.active},
               is_default = case when ${input.active} then is_default else false end,
               updated_at = now(), updated_by = ${u.id}
         where id = ${t.id}`;
      await audit(tx as never, u, t.id, input.active ? "ACTIVATE" : "DEACTIVATE");
    });
    revalidatePath(PATH);
    return { ok: input.active ? "Turned on." : "Turned off." };
  } catch (e) {
    return { error: msg(e) };
  }
}

// ------------------------------------------------- the company's details --

/** Company master data: an administrator's to change, read by every template. */
export async function saveCompanyContact(input: { address: string; phone: string }): Promise<Result> {
  try {
    const u = await requirePermission("settings.manage");
    await sql`
      update company set address = ${cleanText(input.address, 300) || null}, phone = ${cleanText(input.phone, 60) || null}
       where id = ${u.companyId}`;
    revalidatePath(PATH);
    return { ok: "Company details saved." };
  } catch (e) { return { error: msg(e) }; }
}

/** A PNG or JPEG only — checked by its bytes, not its name — and small. */
export async function uploadCompanyLogo(_prev: Result, fd: FormData): Promise<Result> {
  try {
    const u = await requirePermission("settings.manage");
    const file = fd.get("logo");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose an image." };
    if (file.size > 300_000) return { error: "The logo must be under 300 KB." };
    const bytes = Buffer.from(await file.arrayBuffer());
    const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!png && !jpeg) return { error: "Use a PNG or JPEG image." };
    await sql`update company set logo = ${bytes}, logo_mime = ${png ? "image/png" : "image/jpeg"} where id = ${u.companyId}`;
    revalidatePath(PATH);
    return { ok: "Logo saved." };
  } catch (e) { return { error: msg(e) }; }
}

export async function removeCompanyLogo(): Promise<Result> {
  try {
    const u = await requirePermission("settings.manage");
    await sql`update company set logo = null, logo_mime = null where id = ${u.companyId}`;
    revalidatePath(PATH);
    return { ok: "Logo removed." };
  } catch (e) { return { error: msg(e) }; }
}

// ------------------------------------------------------------- preview --

/**
 * A real sale's figures, to preview a template against. Read-only: nothing is
 * pinned and nothing about the sale changes. Limited to the branches the
 * person may see.
 */
export async function previewSaleData(id: string): Promise<ReceiptData | null> {
  const u = await requireUser();
  if (!can(u, "receipts.manage")) return null;
  const view = await receiptView(u.companyId, id, await seenLocations(), { bind: false });
  return view?.data ?? null;
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "./db";
import { requirePermission } from "./auth";
import { assertMyBranch } from "./branch-scope";
import type { ActionResult } from "./actions";

const MONEY = /^\d{1,14}(\.\d{1,4})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
/** An exact decimal as ten-thousandths, so comparing two amounts never touches a float. */
const units = (v: string) => { const [i, f = ""] = v.split("."); return BigInt(i) * 10000n + BigInt((f + "0000").slice(0, 4)); };

/** What an asset's posted history pins: these change only by correction or change of estimate. */
const PINNED = ["category_id", "acquisition_date", "in_service_date", "acquisition_cost", "residual_value",
                "useful_life_months", "start_convention", "branch_id"] as const;
const PINNED_LABEL: Record<(typeof PINNED)[number], string> = {
  category_id: "category", acquisition_date: "acquisition date", in_service_date: "in-service date",
  acquisition_cost: "cost", residual_value: "residual value", useful_life_months: "useful life",
  start_convention: "start convention", branch_id: "branch",
};

/**
 * Creates or edits an asset. A draft can be changed freely. Once a month of
 * depreciation is on the ledger for it, the figures that depreciation was
 * worked out from are pinned: a new life or residual is a change of
 * estimate, a new branch is a transfer, a wrong cost is a correction, each
 * with its own record, and nothing posted is rewritten.
 */
export async function saveAsset(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("accounting.post");
  const co = user.companyId;
  const id = str(fd, "id") || null;
  const intent = str(fd, "intent");
  let savedId = id;
  try {
    const v = {
      code: str(fd, "code").toUpperCase(), name: str(fd, "name").slice(0, 200),
      category_id: str(fd, "category_id"), branch_id: str(fd, "branch_id"),
      site: str(fd, "site") || null, serial_no: str(fd, "serial_no") || null, notes: str(fd, "notes") || null,
      acquisition_date: str(fd, "acquisition_date"), in_service_date: str(fd, "in_service_date") || null,
      acquisition_cost: str(fd, "acquisition_cost").replace(/,/g, ""),
      residual_value: str(fd, "residual_value").replace(/,/g, "") || "0",
      useful_life_months: Number(str(fd, "useful_life_months")),
      start_convention: str(fd, "start_convention") || null,
    };
    if (!/^[A-Z0-9][A-Z0-9._/-]{0,39}$/.test(v.code)) return { error: "Give the asset a code: letters, numbers, - . / only." };
    if (!v.name) return { error: "Give the asset a name." };
    if (!DATE.test(v.acquisition_date)) return { error: "Enter the acquisition date." };
    if (v.in_service_date && !DATE.test(v.in_service_date)) return { error: "The in-service date is not a date." };
    if (v.in_service_date && v.in_service_date < v.acquisition_date) return { error: "It cannot go into service before it was acquired." };
    if (!MONEY.test(v.acquisition_cost)) return { error: "Enter the cost as an amount, up to four decimal places." };
    if (!MONEY.test(v.residual_value)) return { error: "Enter the residual value as an amount, or 0." };
    if (units(v.residual_value) > units(v.acquisition_cost)) return { error: "The residual value cannot be more than the cost." };
    if (!Number.isInteger(v.useful_life_months) || v.useful_life_months < 1 || v.useful_life_months > 1200) {
      return { error: "Useful life is a whole number of months, 1 to 1200." };
    }
    if (v.start_convention && !["NEXT_MONTH", "SAME_MONTH", "DAILY"].includes(v.start_convention)) return { error: "Choose a start convention." };
    if (intent === "activate" && !v.in_service_date) return { error: "An asset goes active on the day it goes into service; enter that date." };

    const [cat] = await sql`select id, is_active from fa_category where id = ${v.category_id} and company_id = ${co}`;
    if (!cat) return { error: "Choose a category." };
    const [br] = await sql`select id from location where id = ${v.branch_id} and company_id = ${co} and parent_id is null`;
    if (!br) return { error: "Choose the branch it belongs to." };
    await assertMyBranch(v.branch_id);
    const [dup] = await sql`select id from fixed_asset where company_id = ${co} and code = ${v.code}
                             and id <> ${id ?? "00000000-0000-0000-0000-000000000000"}`;
    if (dup) return { error: `Code ${v.code} is already another asset's.` };

    await sql.begin(async (tx) => {
      if (!id) {
        const [a] = await tx`
          insert into fixed_asset (company_id, code, name, category_id, branch_id, site, serial_no, notes,
                                   acquisition_date, in_service_date, acquisition_cost, residual_value,
                                   useful_life_months, start_convention, status, created_by)
          values (${co}, ${v.code}, ${v.name}, ${v.category_id}, ${v.branch_id}, ${v.site}, ${v.serial_no}, ${v.notes},
                  ${v.acquisition_date}, ${v.in_service_date}, ${v.acquisition_cost}, ${v.residual_value},
                  ${v.useful_life_months}, ${v.start_convention}, ${intent === "activate" ? "ACTIVE" : "DRAFT"}, ${user.id})
          returning id`;
        savedId = a.id;
        await tx`insert into fa_event (company_id, asset_id, event_type, event_date, to_branch_id, created_by, detail)
                 values (${co}, ${a.id}, 'CREATED', ${v.acquisition_date}, ${v.branch_id}, ${user.id},
                         ${tx.json({ cost: v.acquisition_cost, life: v.useful_life_months })})`;
        if (intent === "activate") await tx`insert into fa_event (company_id, asset_id, event_type, event_date, created_by)
                 values (${co}, ${a.id}, 'ACTIVATED', ${v.in_service_date}, ${user.id})`;
        return;
      }
      const [old] = await tx`
        select f.*, to_char(f.acquisition_date, 'YYYY-MM-DD') as acq, to_char(f.in_service_date, 'YYYY-MM-DD') as svc,
               f.acquisition_cost::text as cost, f.residual_value::text as resid,
               exists (select 1 from fa_depreciation d where d.asset_id = f.id and d.journal_line_id is not null) as posted
          from fixed_asset f where f.id = ${id} and f.company_id = ${co} for update`;
      if (!old) throw new Error("That asset is not in this company.");
      await assertMyBranch(old.branch_id);
      if (old.status === "DISPOSED") throw new Error("A disposed asset keeps its record as it was.");
      const before: Record<string, unknown> = {
        category_id: old.category_id, acquisition_date: old.acq, in_service_date: old.svc,
        acquisition_cost: old.cost, residual_value: old.resid, useful_life_months: old.useful_life_months,
        start_convention: old.start_convention, branch_id: old.branch_id,
      };
      const same = (k: (typeof PINNED)[number]) => k === "acquisition_cost" || k === "residual_value"
        ? units(String(before[k])) === units(String(v[k])) : String(before[k] ?? "") === String(v[k] ?? "");
      const changed = PINNED.filter((k) => !same(k));
      const plain = (["code", "name", "site", "serial_no", "notes"] as const)
        .filter((k) => String(old[k] ?? "") !== String(v[k] ?? ""));
      if (old.posted && changed.length) {
        throw new Error(`This asset already has depreciation on the ledger, so its ${changed.map((k) => PINNED_LABEL[k]).join(", ")} `
          + "cannot be edited. A new life or residual is a change of estimate, a new branch is a transfer, and a wrong cost is a correction.");
      }
      const status = intent === "activate" && old.status === "DRAFT" ? "ACTIVE" : old.status;
      await tx`
        update fixed_asset set code = ${v.code}, name = ${v.name}, category_id = ${v.category_id}, branch_id = ${v.branch_id},
               site = ${v.site}, serial_no = ${v.serial_no}, notes = ${v.notes},
               acquisition_date = ${v.acquisition_date}, in_service_date = ${v.in_service_date},
               acquisition_cost = ${v.acquisition_cost}, residual_value = ${v.residual_value},
               useful_life_months = ${v.useful_life_months}, start_convention = ${v.start_convention},
               status = ${status}, updated_at = now()
         where id = ${id}`;
      await tx`insert into fa_event (company_id, asset_id, event_type, event_date, created_by, detail)
               values (${co}, ${id}, 'UPDATED', current_date, ${user.id},
                       ${tx.json({ changed: [
                         ...changed.map((k) => ({ field: k, from: String(before[k] ?? ""), to: String(v[k] ?? "") })),
                         ...plain.map((k) => ({ field: k, from: String(old[k] ?? ""), to: String(v[k] ?? "") }))] })})`;
      if (status !== old.status) await tx`insert into fa_event (company_id, asset_id, event_type, event_date, created_by)
               values (${co}, ${id}, 'ACTIVATED', ${v.in_service_date}, ${user.id})`;
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/fixed-assets", "layout");
  redirect(`/fixed-assets/register?toast=${encodeURIComponent(id ? "Asset saved" : "Asset added")}&saved=${savedId}`);
}

/** Active ↔ inactive, and the removal of a draft nothing has touched. */
export async function setAssetStatus(fd: FormData) {
  const user = await requirePermission("accounting.post");
  const co = user.companyId;
  const id = str(fd, "id"), to = str(fd, "to");
  let message = "";
  await sql.begin(async (tx) => {
    const [a] = await tx`
      select f.status, f.branch_id, to_char(f.in_service_date, 'YYYY-MM-DD') as svc,
             exists (select 1 from fa_depreciation d where d.asset_id = f.id) or
             exists (select 1 from fa_journal_link k where k.asset_id = f.id) as touched
        from fixed_asset f where f.id = ${id} and f.company_id = ${co} for update`;
    if (!a) throw new Error("That asset is not in this company.");
    await assertMyBranch(a.branch_id);
    if (to === "DELETE") {
      if (a.status !== "DRAFT" || a.touched) throw new Error("Only a draft with nothing linked to it can be deleted.");
      await tx`delete from fa_event where asset_id = ${id}`;
      await tx`delete from fixed_asset where id = ${id}`;
      message = "Draft deleted";
      return;
    }
    const allowed: Record<string, string[]> = { ACTIVE: ["DRAFT", "INACTIVE"], INACTIVE: ["ACTIVE"] };
    if (!allowed[to]?.includes(a.status)) throw new Error("That change of status is not allowed.");
    if (to === "ACTIVE" && !a.svc) throw new Error("Enter the in-service date before making it active.");
    await tx`update fixed_asset set status = ${to}, updated_at = now() where id = ${id}`;
    await tx`insert into fa_event (company_id, asset_id, event_type, event_date, created_by)
             values (${co}, ${id}, ${to === "INACTIVE" ? "DEACTIVATED" : a.status === "DRAFT" ? "ACTIVATED" : "REACTIVATED"},
                     current_date, ${user.id})`;
    message = to === "INACTIVE" ? "Asset made inactive" : "Asset active";
  });
  revalidatePath("/fixed-assets", "layout");
  redirect(`/fixed-assets/register?toast=${encodeURIComponent(message)}`);
}

/**
 * A new useful life or residual value, from a month on. Prospective only:
 * the month must come after every month the ledger already carries for the
 * asset, and what was posted stays as it was. The rest of the life absorbs
 * the change (lib/fa-engine).
 */
export async function changeEstimate(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("accounting.post");
  const co = user.companyId;
  const id = str(fd, "id");
  try {
    const month = str(fd, "effective_month");
    const life = Number(str(fd, "useful_life_months"));
    const residual = str(fd, "residual_value").replace(/,/g, "") || "0";
    const reason = str(fd, "reason");
    if (!/^\d{4}-\d{2}$/.test(month)) return { error: "Choose the month the change applies from." };
    if (!Number.isInteger(life) || life < 1 || life > 1200) return { error: "Useful life is a whole number of months, 1 to 1200." };
    if (!MONEY.test(residual)) return { error: "Enter the residual value as an amount, or 0." };
    if (!reason) return { error: "Say why the estimate changed; it stays on the asset's record." };
    await sql.begin(async (tx) => {
      const [a] = await tx`
        select f.branch_id, f.status, f.acquisition_cost::text as cost,
               to_char((select max(period_month) from fa_depreciation d where d.asset_id = f.id), 'YYYY-MM') as last_posted
          from fixed_asset f where f.id = ${id} and f.company_id = ${co} for update`;
      if (!a) throw new Error("That asset is not in this company.");
      await assertMyBranch(a.branch_id);
      if (a.status === "DISPOSED" || a.status === "DRAFT") throw new Error("Only an asset in service has estimates to change.");
      if (units(residual) > units(a.cost)) throw new Error("The residual value cannot be more than the cost.");
      if (a.last_posted && month <= a.last_posted) {
        throw new Error(`Depreciation is on the ledger up to ${a.last_posted}; a change of estimate applies from a later month.`);
      }
      await tx`
        insert into fa_estimate_change (company_id, asset_id, effective_month, useful_life_months, residual_value, reason, created_by)
        values (${co}, ${id}, ${month + "-01"}, ${life}, ${residual}, ${reason}, ${user.id})
        on conflict (asset_id, effective_month) do update
          set useful_life_months = excluded.useful_life_months, residual_value = excluded.residual_value,
              reason = excluded.reason, created_by = excluded.created_by, created_at = now()`;
      await tx`insert into fa_event (company_id, asset_id, event_type, event_date, created_by, detail)
               values (${co}, ${id}, 'ESTIMATE_CHANGED', ${month + "-01"}, ${user.id},
                       ${tx.json({ life, residual, reason })})`;
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/fixed-assets", "layout");
  return { ok: true };
}

type Allocation = { assetId: string; kind: "DEPRECIATION" | "CORRECTION" | "ACQUISITION"; month?: string; amount: string };

/**
 * Ties one posted journal line to assets: an acquisition (a debit on the
 * asset account), a month of depreciation history (a credit on the
 * accumulated-depreciation account), or a correction (either side of it).
 * One line can be split across several assets; the database refuses links
 * that add up to more than the line. Nothing is posted or reposted.
 */
export async function linkJournalLine(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("accounting.post");
  const co = user.companyId;
  const lineId = str(fd, "line_id");
  try {
    const allocations = JSON.parse(str(fd, "allocations") || "[]") as Allocation[];
    if (allocations.length === 0) return { error: "Add at least one asset to link." };
    await sql.begin(async (tx) => {
      const [line] = await tx`
        select jl.id, jl.account_id, jl.base_amount::text as amount, to_char(je.entry_date, 'YYYY-MM-DD') as date,
               coalesce(l.parent_id, l.id) as branch_id, d.status,
               exists (select 1 from fa_run r where r.document_id = d.id) as ours
          from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
          left join document d on d.id = je.source_id left join location l on l.id = jl.location_id
         where jl.id = ${lineId} and jl.company_id = ${co} for update of jl`;
      if (!line) throw new Error("That journal line is not in this company.");
      if (line.status && line.status !== "POSTED") throw new Error("Only a posted journal can be linked.");
      if (line.ours) throw new Error("This module's own voucher is linked when it posts.");
      const credit = line.amount.startsWith("-");
      const lineAbs = units(line.amount.replace("-", ""));
      let total = 0n;
      for (const [i, al] of allocations.entries()) {
        const at = `Row ${i + 1}: `;
        if (!MONEY.test(al.amount)) throw new Error(`${at}enter the amount.`);
        const amt = units(al.amount);
        if (amt <= 0n) throw new Error(`${at}the amount must be more than nothing.`);
        total += amt;
        const [a] = await tx`
          select f.id, f.code, f.branch_id, c.asset_account_id, c.accum_account_id
            from fixed_asset f join fa_category c on c.id = f.category_id
           where f.id = ${al.assetId} and f.company_id = ${co}`;
        if (!a) throw new Error(`${at}choose an asset.`);
        await assertMyBranch(a.branch_id);
        // A line from another branch is refused unless the asset was ever there.
        if (line.branch_id && line.branch_id !== a.branch_id) {
          const [was] = await tx`select 1 from fa_event where asset_id = ${a.id} and event_type = 'TRANSFERRED'
                                   and (from_branch_id = ${line.branch_id} or to_branch_id = ${line.branch_id}) limit 1`;
          if (!was) throw new Error(`${at}${a.code} belongs to another branch than this journal line.`);
        }
        if (al.kind === "ACQUISITION") {
          if (line.account_id !== a.asset_account_id) throw new Error(`${at}this line is not on ${a.code}'s asset account.`);
          if (credit) throw new Error(`${at}an acquisition is a debit to the asset account.`);
          await tx`insert into fa_journal_link (company_id, asset_id, journal_line_id, kind, amount, created_by)
                   values (${co}, ${a.id}, ${lineId}, 'ACQUISITION', ${al.amount}, ${user.id})`;
        } else {
          if (line.account_id !== a.accum_account_id) throw new Error(`${at}this line is not on ${a.code}'s accumulated-depreciation account.`);
          if (!al.month || !/^\d{4}-\d{2}$/.test(al.month)) throw new Error(`${at}choose the month it was depreciation for.`);
          if (al.kind === "DEPRECIATION" && !credit) throw new Error(`${at}depreciation history is a credit to accumulated depreciation; link a debit as a correction.`);
          const [held] = al.kind === "DEPRECIATION" ? await tx`
            select x.source, coalesce(d.doc_no, je.entry_no) as no from fa_depreciation x
              left join journal_line jl on jl.id = x.journal_line_id left join journal_entry je on je.id = jl.journal_entry_id
              left join document d on d.id = je.source_id
             where x.asset_id = ${a.id} and x.period_month = ${al.month + "-01"} and x.source in ('RUN', 'HISTORICAL')` : [];
          if (held) throw new Error(`${at}${a.code} ${al.month} is already carried by ${held.no ?? "a draft run"}. Link the difference as a correction instead.`);
          await tx`insert into fa_depreciation (company_id, asset_id, period_month, source, amount, journal_line_id, is_link, created_by, note)
                   values (${co}, ${a.id}, ${al.month + "-01"}, ${al.kind === "DEPRECIATION" ? "HISTORICAL" : "CORRECTION"},
                           ${al.kind === "CORRECTION" && !credit ? "-" + al.amount : al.amount}, ${lineId}, true, ${user.id}, 'Linked from history')`;
        }
        await tx`insert into fa_event (company_id, asset_id, event_type, event_date, created_by, detail)
                 values (${co}, ${a.id}, 'HISTORY_LINKED', ${line.date}, ${user.id},
                         ${tx.json({ line: lineId, kind: al.kind, month: al.month ?? null, amount: al.amount })})`;
      }
      if (total > lineAbs) throw new Error("The links add up to more than the journal line.");
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/fa_depreciation_once_per_month/.test(msg)) return { error: "One of those asset months is already carried by another journal. Link the difference as a correction." };
    return { error: msg };
  }
  revalidatePath("/fixed-assets", "layout");
  return { ok: true };
}

/** Undoes one reconciliation link. A voucher this module posted cannot be unlinked (lib/0157). */
export async function unlinkAllocation(fd: FormData) {
  const user = await requirePermission("accounting.post");
  const co = user.companyId;
  const id = str(fd, "id"), type = str(fd, "type");
  await sql.begin(async (tx) => {
    const [row] = type === "DEP"
      ? await tx`select x.asset_id, x.is_link, f.branch_id from fa_depreciation x join fixed_asset f on f.id = x.asset_id
                  where x.id = ${id} and x.company_id = ${co}`
      : await tx`select k.asset_id, true as is_link, f.branch_id from fa_journal_link k join fixed_asset f on f.id = k.asset_id
                  where k.id = ${id} and k.company_id = ${co}`;
    if (!row) throw new Error("That link is not in this company.");
    await assertMyBranch(row.branch_id);
    if (!row.is_link) throw new Error("Posted depreciation is not unlinked; record a correction instead.");
    if (type === "DEP") await tx`delete from fa_depreciation where id = ${id}`;
    else await tx`delete from fa_journal_link where id = ${id}`;
    await tx`insert into fa_event (company_id, asset_id, event_type, event_date, created_by, detail)
             values (${co}, ${row.asset_id}, 'HISTORY_UNLINKED', current_date, ${user.id}, ${tx.json({ link: id })})`;
  });
  revalidatePath("/fixed-assets", "layout");
}

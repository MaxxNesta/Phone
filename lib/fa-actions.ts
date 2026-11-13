"use server";
import { str } from "./input";
import { todayLocal } from "@/lib/format";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "./db";
import { requirePermission } from "./auth";
import { requireFaPoster, assertFaBranch, isCompanyLevel } from "./fa-access";
import type { ActionResult } from "./actions";
import { heavy } from "./heavy";
import { syncUnits } from "./fa-units-db";
import { reviewRows, type DraftRow } from "./fa-import";
import type { Convention } from "./fa-engine";

const MONEY = /^\d{1,14}(\.\d{1,4})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** An exact decimal as ten-thousandths, so comparing two amounts never touches a float. */
const units = (v: string) => { const [i, f = ""] = v.split("."); return BigInt(i) * 10000n + BigInt((f + "0000").slice(0, 4)); };

/** What an asset's posted history pins: these change only by correction or change of estimate. */
const PINNED = ["category_id", "acquisition_date", "in_service_date", "acquisition_cost", "residual_value",
                "useful_life_months", "start_convention", "branch_id", "posting_branch_id",
                "depreciation_start", "opening_accumulated", "opening_through"] as const;
const PINNED_LABEL: Record<(typeof PINNED)[number], string> = {
  category_id: "category", acquisition_date: "acquisition date", in_service_date: "in-service date",
  acquisition_cost: "cost", residual_value: "residual value", useful_life_months: "useful life",
  start_convention: "start convention", branch_id: "branch", posting_branch_id: "depreciation posting branch",
  depreciation_start: "depreciation start", opening_accumulated: "opening accumulated", opening_through: "opening month",
};
const MONTH = /^\d{4}-\d{2}$/;

/**
 * The checks an asset's history-bearing fields must pass, for the form and the
 * import alike. Returns what is wrong, or null.
 */
function checkHistory(v: { quantity: string; acquisition_cost: string; residual_value: string; depreciation_start: string | null;
  opening_accumulated: string | null; opening_through: string | null; in_service_date: string | null }) {
  if (!MONEY.test(v.quantity) || units(v.quantity) === 0n) return "Quantity is a number above zero.";
  if (v.depreciation_start && !MONTH.test(v.depreciation_start)) return "Depreciation start is a month.";
  if (!!v.opening_accumulated !== !!v.opening_through) return "An opening figure needs both its amount and the month it runs to.";
  if (v.opening_accumulated && !MONEY.test(v.opening_accumulated)) return "Enter the opening accumulated as an amount.";
  if (v.opening_through && !MONTH.test(v.opening_through)) return "The opening month is a month.";
  if (v.opening_accumulated && units(v.opening_accumulated) > units(v.acquisition_cost) - units(v.residual_value)) {
    return "Opening accumulated cannot be more than cost less residual value.";
  }
  if (v.opening_through && v.depreciation_start && v.opening_through < v.depreciation_start.slice(0, 7)) {
    return "The opening figure runs to a month before depreciation starts.";
  }
  return null;
}

/**
 * Creates or edits an asset. A draft can be changed freely. Once a month of
 * depreciation is on the ledger for it, the figures that depreciation was
 * worked out from are pinned: a new life or residual is a change of
 * estimate, a new branch is a transfer, a wrong cost is a correction, each
 * with its own record, and nothing posted is rewritten.
 */
export async function saveAsset(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requireFaPoster();
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
      posting_branch_id: str(fd, "posting_branch_id") || null,
      quantity: str(fd, "quantity").replace(/,/g, "") || "1",
      depreciation_start: str(fd, "depreciation_start") || null,
      opening_accumulated: str(fd, "opening_accumulated").replace(/,/g, "") || null,
      opening_through: str(fd, "opening_through") || null,
    };
    // The assigned branch is the default; naming it again is no exception.
    if (v.posting_branch_id === v.branch_id) v.posting_branch_id = null;
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
    const history = checkHistory(v);
    if (history) return { error: history };

    const [cat] = await sql`select id, is_active from fa_category where id = ${v.category_id} and company_id = ${co}`;
    if (!cat) return { error: "Choose a category." };
    const [br] = await sql`select id from location where id = ${v.branch_id} and company_id = ${co} and parent_id is null`;
    if (!br) return { error: "Choose the branch it is used at." };
    if (v.posting_branch_id) {
      const [pb] = await sql`select id from location where id = ${v.posting_branch_id} and company_id = ${co} and parent_id is null`;
      if (!pb) return { error: "Choose the branch its depreciation posts to." };
    }
    await assertFaBranch(user, v.branch_id, v.posting_branch_id);
    const [dup] = await sql`select id from fixed_asset where company_id = ${co} and code = ${v.code}
                             and id <> ${id ?? "00000000-0000-0000-0000-000000000000"}`;
    if (dup) return { error: `Code ${v.code} is already another asset's.` };

    await sql.begin(async (tx) => {
      if (!id) {
        const [a] = await tx`
          insert into fixed_asset (company_id, code, name, category_id, branch_id, posting_branch_id, site, serial_no, notes,
                                   acquisition_date, in_service_date, acquisition_cost, residual_value,
                                   useful_life_months, start_convention, status, created_by,
                                   quantity, depreciation_start, opening_accumulated, opening_through)
          values (${co}, ${v.code}, ${v.name}, ${v.category_id}, ${v.branch_id}, ${v.posting_branch_id}, ${v.site}, ${v.serial_no}, ${v.notes},
                  ${v.acquisition_date}, ${v.in_service_date}, ${v.acquisition_cost}, ${v.residual_value},
                  ${v.useful_life_months}, ${v.start_convention}, ${intent === "activate" ? "ACTIVE" : "DRAFT"}, ${user.id},
                  ${v.quantity}, ${v.depreciation_start ? v.depreciation_start + "-01" : null}, ${v.opening_accumulated},
                  ${v.opening_through ? v.opening_through + "-01" : null})
          returning id`;
        savedId = a.id;
        await tx`insert into fa_event (company_id, asset_id, event_type, event_date, to_branch_id, created_by, detail)
                 values (${co}, ${a.id}, 'CREATED', ${v.acquisition_date}, ${v.branch_id}, ${user.id},
                         ${tx.json({ cost: v.acquisition_cost, life: v.useful_life_months })})`;
        if (intent === "activate") await tx`insert into fa_event (company_id, asset_id, event_type, event_date, created_by)
                 values (${co}, ${a.id}, 'ACTIVATED', ${v.in_service_date}, ${user.id})`;
        await syncUnits(tx, co, [a.id]);
        return;
      }
      const [old] = await tx`
        select f.*, to_char(f.acquisition_date, 'YYYY-MM-DD') as acq, to_char(f.in_service_date, 'YYYY-MM-DD') as svc,
               to_char(f.depreciation_start, 'YYYY-MM') as dstart, f.opening_accumulated::text as oacc, to_char(f.opening_through, 'YYYY-MM') as othru,
               f.acquisition_cost::text as cost, f.residual_value::text as resid,
               exists (select 1 from fa_depreciation d where d.asset_id = f.id and d.journal_line_id is not null) as posted
          from fixed_asset f where f.id = ${id} and f.company_id = ${co} for update`;
      if (!old) throw new Error("That asset is not in this company.");
      await assertFaBranch(user, old.branch_id);
      if (old.status === "DISPOSED") throw new Error("A disposed asset keeps its record as it was.");
      const before: Record<string, unknown> = {
        category_id: old.category_id, acquisition_date: old.acq, in_service_date: old.svc,
        acquisition_cost: old.cost, residual_value: old.resid, useful_life_months: old.useful_life_months,
        start_convention: old.start_convention, branch_id: old.branch_id, posting_branch_id: old.posting_branch_id,
        depreciation_start: old.dstart, opening_accumulated: old.oacc, opening_through: old.othru,
      };
      const same = (k: (typeof PINNED)[number]) => k === "acquisition_cost" || k === "residual_value" || k === "opening_accumulated"
        ? units(String(before[k] ?? "0")) === units(String(v[k] ?? "0")) : String(before[k] ?? "") === String(v[k] ?? "");
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
               posting_branch_id = ${v.posting_branch_id},
               site = ${v.site}, serial_no = ${v.serial_no}, notes = ${v.notes},
               acquisition_date = ${v.acquisition_date}, in_service_date = ${v.in_service_date},
               acquisition_cost = ${v.acquisition_cost}, residual_value = ${v.residual_value},
               useful_life_months = ${v.useful_life_months}, start_convention = ${v.start_convention},
               quantity = ${v.quantity}, depreciation_start = ${v.depreciation_start ? v.depreciation_start + "-01" : null},
               opening_accumulated = ${v.opening_accumulated}, opening_through = ${v.opening_through ? v.opening_through + "-01" : null},
               status = ${status}, updated_at = now()
         where id = ${id}`;
      await tx`insert into fa_event (company_id, asset_id, event_type, event_date, created_by, detail)
               values (${co}, ${id}, 'UPDATED', fn_shop_today(), ${user.id},
                       ${tx.json({ changed: [
                         ...changed.map((k) => ({ field: k, from: String(before[k] ?? ""), to: String(v[k] ?? "") })),
                         ...plain.map((k) => ({ field: k, from: String(old[k] ?? ""), to: String(v[k] ?? "") }))] })})`;
      if (status !== old.status) await tx`insert into fa_event (company_id, asset_id, event_type, event_date, created_by)
               values (${co}, ${id}, 'ACTIVATED', ${v.in_service_date}, ${user.id})`;
      // Units follow a new code, cost or quantity until depreciation or a split pins them.
      await syncUnits(tx, co, [id]);
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/fixed-assets", "layout");
  redirect(`/fixed-assets/register?toast=${encodeURIComponent(id ? "Asset saved" : "Asset added")}&saved=${savedId}`);
}

/** Active ↔ inactive, and the removal of a draft nothing has touched. */
export async function setAssetStatus(fd: FormData) {
  const user = await requireFaPoster();
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
    await assertFaBranch(user, a.branch_id);
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
                     fn_shop_today(), ${user.id})`;
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
  const user = await requireFaPoster();
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
      await assertFaBranch(user, a.branch_id);
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

type Allocation = { assetId: string; kind: "DEPRECIATION" | "CORRECTION" | "ACQUISITION" | "OPENING"; month?: string; amount: string };

/**
 * Ties one posted journal line to assets: an acquisition (a debit on the
 * asset account), a month of depreciation history (a credit on the
 * accumulated-depreciation account), or a correction (either side of it).
 * One line can be split across several assets; the database refuses links
 * that add up to more than the line. Nothing is posted or reposted.
 */
export async function linkJournalLine(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requireFaPoster();
  const co = user.companyId;
  const lineId = str(fd, "line_id");
  try {
    if (!(await isCompanyLevel())) return { error: "Linking the ledger's historical journals is company-level work; ask someone who sees every branch." };
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
        await assertFaBranch(user, a.branch_id);
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
          if ((al.kind === "DEPRECIATION" || al.kind === "OPENING") && !credit) throw new Error(`${at}depreciation history is a credit to accumulated depreciation; link a debit as a correction.`);
          if (al.kind === "OPENING") {
            const [has] = await tx`select to_char(period_month, 'YYYY-MM') as m from fa_depreciation where asset_id = ${a.id} and source = 'OPENING'`;
            if (has) throw new Error(`${at}${a.code} already has its opening depreciation (to ${has.m}).`);
            const [later] = await tx`select to_char(min(period_month), 'YYYY-MM') as m from fa_depreciation where asset_id = ${a.id} and period_month <= ${al.month + "-01"} and source in ('RUN', 'HISTORICAL')`;
            if (later?.m) throw new Error(`${at}${a.code} already has ${later.m} on the ledger; the opening figure covers the months before anything posted.`);
          }
          const [held] = al.kind === "DEPRECIATION" || al.kind === "OPENING" ? await tx`
            select x.source, coalesce(d.doc_no, je.entry_no) as no from fa_depreciation x
              left join journal_line jl on jl.id = x.journal_line_id left join journal_entry je on je.id = jl.journal_entry_id
              left join document d on d.id = je.source_id
             where x.asset_id = ${a.id} and x.period_month = ${al.month + "-01"} and x.source in ('RUN', 'HISTORICAL', 'OPENING')` : [];
          if (held) throw new Error(`${at}${a.code} ${al.month} is already carried by ${held.no ?? "a draft run"}. Link the difference as a correction instead.`);
          await tx`insert into fa_depreciation (company_id, asset_id, period_month, source, amount, journal_line_id, is_link, created_by, note)
                   values (${co}, ${a.id}, ${al.month + "-01"}, ${al.kind === "DEPRECIATION" ? "HISTORICAL" : al.kind === "OPENING" ? "OPENING" : "CORRECTION"},
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
  const user = await requireFaPoster();
  const co = user.companyId;
  if (!(await isCompanyLevel())) throw new Error("Unlinking historical journals is company-level work.");
  const id = str(fd, "id"), type = str(fd, "type");
  await sql.begin(async (tx) => {
    const [row] = type === "DEP"
      ? await tx`select x.asset_id, x.is_link, f.branch_id from fa_depreciation x join fixed_asset f on f.id = x.asset_id
                  where x.id = ${id} and x.company_id = ${co}`
      : await tx`select k.asset_id, true as is_link, f.branch_id from fa_journal_link k join fixed_asset f on f.id = k.asset_id
                  where k.id = ${id} and k.company_id = ${co}`;
    if (!row) throw new Error("That link is not in this company.");
    await assertFaBranch(user, row.branch_id);
    if (!row.is_link) throw new Error("Posted depreciation is not unlinked; record a correction instead.");
    if (type === "DEP") await tx`delete from fa_depreciation where id = ${id}`;
    else await tx`delete from fa_journal_link where id = ${id}`;
    await tx`insert into fa_event (company_id, asset_id, event_type, event_date, created_by, detail)
             values (${co}, ${row.asset_id}, 'HISTORY_UNLINKED', fn_shop_today(), ${user.id}, ${tx.json({ link: id })})`;
  });
  revalidatePath("/fixed-assets", "layout");
}

// --------------------------------------------------------- review & post --

async function postingMode(co: string) {
  const [s] = await sql`select posting_mode from fa_setting where company_id = ${co}`;
  return (s?.posting_mode ?? "REVIEW") as "MANUAL" | "REVIEW" | "AUTO";
}

/** Prepares a branch's month as a draft run: the review step. */
export async function prepareDepreciation(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requireFaPoster();
  const co = user.companyId;
  const branchId = str(fd, "branch_id"), month = str(fd, "month");
  try {
    await assertFaBranch(user, branchId);
    if ((await postingMode(co)) === "MANUAL") return { error: "Posting is set to Manual: link the journals you post yourself in Journal Reconciliation, or change the mode in Settings." };
    const { draftRun, currentMonth } = await import("./fa-post");
    await draftRun(co, branchId, month, user.id, "REVIEW", currentMonth());
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/fixed-assets", "layout");
  return { ok: true };
}

/** Approves and posts a draft run through the journal voucher engine. */
export async function postDepreciation(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requireFaPoster();
  const co = user.companyId;
  const runId = str(fd, "run_id");
  let message = "";
  try {
    const [r] = await sql`select branch_id from fa_run where id = ${runId} and company_id = ${co}`;
    if (!r) return { error: "That run is not in this company." };
    await assertFaBranch(user, r.branch_id);
    if ((await postingMode(co)) === "MANUAL") return { error: "Posting is set to Manual; change the mode in Settings to post from here." };
    const { postRun, currentMonth } = await import("./fa-post");
    const res = await postRun(co, runId, user.id, currentMonth());
    message = res.already ? `Already posted as ${res.docNo}` : `Posted ${res.docNo}`;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/fixed-assets", "layout");
  revalidatePath("/finance", "layout");
  return { ok: true, draftId: message };
}

/** Discards a draft run; nothing was posted, so nothing needs reversing. */
export async function discardDepreciation(fd: FormData) {
  const user = await requireFaPoster();
  const [r] = await sql`select branch_id from fa_run where id = ${str(fd, "run_id")} and company_id = ${user.companyId}`;
  if (!r) throw new Error("That run is not in this company.");
  await assertFaBranch(user, r.branch_id);
  const { cancelRun } = await import("./fa-post");
  await cancelRun(user.companyId, str(fd, "run_id"));
  revalidatePath("/fixed-assets", "layout");
}

// -------------------------------------------------------------- settings --

/** Posting mode, start convention and the disposal gain/loss accounts. */
export async function saveFaSettings(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("settings.manage");
  const co = user.companyId;
  try {
    const mode = str(fd, "posting_mode"), conv = str(fd, "start_convention");
    if (!["MANUAL", "REVIEW"].includes(mode)) return { error: "Choose Manual or Review & post. Automatic posting needs a scheduled job and is not available yet." };
    if (!["NEXT_MONTH", "SAME_MONTH", "DAILY"].includes(conv)) return { error: "Choose when depreciation starts." };
    const gain = str(fd, "gain_account_id") || null, loss = str(fd, "loss_account_id") || null;
    for (const [id, type, what] of [[gain, "REVENUE", "gain"], [loss, "EXPENSE", "loss"]] as const) {
      if (!id) continue;
      const [a] = await sql`select account_type, is_postable, is_active from account where id = ${id} and company_id = ${co}`;
      if (!a || !a.is_postable || !a.is_active) return { error: `The ${what} account must be an active, postable account.` };
      if (a.account_type !== type) return { error: `The ${what} account should be a ${type === "REVENUE" ? "revenue (other income)" : "expense"} account.` };
    }
    await sql`
      insert into fa_setting (company_id, posting_mode, start_convention, gain_account_id, loss_account_id)
      values (${co}, ${mode}, ${conv}, ${gain}, ${loss})
      on conflict (company_id) do update set posting_mode = excluded.posting_mode, start_convention = excluded.start_convention,
        gain_account_id = excluded.gain_account_id, loss_account_id = excluded.loss_account_id, updated_at = now()`;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/fixed-assets", "layout");
  return { ok: true };
}

/**
 * A category's three accounts and default life. Accounts change only while
 * nothing has posted under the category: what posted stays on the accounts
 * it posted to, and a new mapping would split one asset across two.
 */
export async function saveFaCategory(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("settings.manage");
  const co = user.companyId;
  const id = str(fd, "id") || null;
  try {
    const v = { code: str(fd, "code").toUpperCase(), name: str(fd, "name"), asset_class: str(fd, "asset_class") || "TANGIBLE",
      asset: str(fd, "asset_account_id"), accum: str(fd, "accum_account_id"), expense: str(fd, "expense_account_id"),
      life: str(fd, "default_life_months") ? Number(str(fd, "default_life_months")) : null, active: fd.get("is_active") === "on" };
    if (!v.code || !v.name) return { error: "Give the category a code and a name." };
    if (!["TANGIBLE", "INTANGIBLE"].includes(v.asset_class)) return { error: "Choose tangible or intangible." };
    if (v.life !== null && (!Number.isInteger(v.life) || v.life < 1 || v.life > 1200)) return { error: "Default life is 1 to 1200 months." };
    if (new Set([v.asset, v.accum, v.expense]).size !== 3) return { error: "The asset, accumulated-depreciation and expense accounts must be three different accounts." };
    const accts = await sql`select id, account_type, is_postable, is_active, is_cash_account, is_bank_account, is_control
                              from account where company_id = ${co} and id = any(${[v.asset, v.accum, v.expense]})`;
    const by = new Map((accts as any[]).map((a) => [a.id, a]));
    for (const [aid, want, what] of [[v.asset, "ASSET", "asset"], [v.accum, "ASSET", "accumulated-depreciation"], [v.expense, "EXPENSE", "expense"]] as const) {
      const a = by.get(aid);
      if (!a || !a.is_postable || !a.is_active) return { error: `Choose an active, postable ${what} account.` };
      if (a.account_type !== want) return { error: `The ${what} account should be an ${want.toLowerCase()} account.` };
      if (a.is_cash_account || a.is_bank_account || a.is_control) return { error: `The ${what} account cannot be a cash, bank or control account.` };
    }
    await sql.begin(async (tx) => {
      if (!id) {
        await tx`insert into fa_category (company_id, code, name, asset_class, asset_account_id, accum_account_id, expense_account_id, default_life_months, is_active)
                 values (${co}, ${v.code}, ${v.name}, ${v.asset_class}, ${v.asset}, ${v.accum}, ${v.expense}, ${v.life}, ${v.active})`;
        return;
      }
      const [old] = await tx`
        select c.asset_account_id, c.accum_account_id, c.expense_account_id,
               exists (select 1 from fa_depreciation x join fixed_asset f on f.id = x.asset_id where f.category_id = c.id and x.journal_line_id is not null)
            or exists (select 1 from fa_journal_link k join fixed_asset f on f.id = k.asset_id where f.category_id = c.id) as used
          from fa_category c where c.id = ${id} and c.company_id = ${co} for update`;
      if (!old) throw new Error("That category is not in this company.");
      const moved = old.asset_account_id !== v.asset || old.accum_account_id !== v.accum || old.expense_account_id !== v.expense;
      if (moved && old.used) throw new Error("Journals already carry this category's assets, so its accounts stay as they are. Make a new category for new assets.");
      await tx`update fa_category set code = ${v.code}, name = ${v.name}, asset_class = ${v.asset_class}, asset_account_id = ${v.asset},
                 accum_account_id = ${v.accum}, expense_account_id = ${v.expense}, default_life_months = ${v.life}, is_active = ${v.active}
               where id = ${id}`;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: /fa_category_company_id_code_key/.test(msg) ? "That code is another category's." : msg };
  }
  revalidatePath("/fixed-assets", "layout");
  return { ok: true };
}

// ------------------------------------------------- transfers and disposals --

export async function transferAssetAction(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requireFaPoster();
  const assetId = str(fd, "id");
  let docNo: string | null = null;
  try {
    const [a] = await sql`select branch_id, posting_branch_id from fixed_asset where id = ${assetId} and company_id = ${user.companyId}`;
    if (!a) return { error: "That asset is not in this company." };
    // Both ends of the move are the person's to authorise.
    await assertFaBranch(user, a.branch_id, a.posting_branch_id, str(fd, "to_branch_id"));
    const date = str(fd, "date");
    if (!DATE.test(date)) return { error: "Enter the date it moves." };
    const { transferAsset } = await import("./fa-move");
    const { splitUnits } = await import("./fa-split");
    // Some of a group's units: split them off and move that part, in one transaction.
    const units = fd.getAll("unit").map(String).filter(Boolean);
    ({ docNo } = await sql.begin(async (tx) => {
      const target = units.length ? await splitUnits(tx, user.companyId, user.id, assetId, units) : assetId;
      return transferAsset(user.companyId, user.id, { assetId: target, toBranchId: str(fd, "to_branch_id"), date, note: str(fd, "note") || null }, tx);
    }));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/fixed-assets", "layout");
  redirect(`/fixed-assets/${assetId}?toast=${encodeURIComponent(docNo ? `Transferred · ${docNo}` : "Transferred")}`);
}

export async function disposeAssetAction(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requireFaPoster();
  const assetId = str(fd, "id");
  let docNo = "";
  try {
    const [a] = await sql`select branch_id, posting_branch_id from fixed_asset where id = ${assetId} and company_id = ${user.companyId}`;
    if (!a) return { error: "That asset is not in this company." };
    await assertFaBranch(user, a.branch_id, a.posting_branch_id);
    const date = str(fd, "date"), reason = str(fd, "reason");
    const proceeds = str(fd, "proceeds").replace(/,/g, "") || "0";
    if (!DATE.test(date)) return { error: "Enter the disposal date." };
    if (!reason) return { error: "Say why it is disposed of." };
    if (!MONEY.test(proceeds)) return { error: "Enter the proceeds as an amount, or 0." };
    const { disposeAsset } = await import("./fa-move");
    const { splitUnits } = await import("./fa-split");
    const units = fd.getAll("unit").map(String).filter(Boolean);
    ({ docNo } = await sql.begin(async (tx) => {
      const target = units.length ? await splitUnits(tx, user.companyId, user.id, assetId, units) : assetId;
      return disposeAsset(user.companyId, user.id, { assetId: target, date, reason, proceeds, proceedsAccountId: str(fd, "proceeds_account_id") || null }, tx);
    }));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/fixed-assets", "layout");
  redirect(`/fixed-assets/${assetId}?toast=${encodeURIComponent(`Disposed · ${docNo}`)}`);
}

// ------------------------------------------------------------- import --

export type FaImportResult =
  | { ok: true; imported: { line: number; code: string; id: string; name: string }[]; skipped: { line: number; name: string; reason: string }[] }
  | { ok: false; error: string };

/**
 * The pasted register, saved as real assets. The review the page showed runs
 * again here against the database, and only rows that are included and need
 * nothing more are saved. Each becomes an active asset whose schedule comes
 * from the engine; no purchase, payment or depreciation journal is posted.
 */
export async function importAssets(input: { drafts: DraftRow[]; subMap: Record<string, string>; branchId: string | null; year: number }): Promise<FaImportResult> {
  const user = await requireFaPoster();
  const co = user.companyId;
  try {
    return await heavy("import.assets", { id: user.id, companyId: co }, async () => {
      const [cats, branches, existing, [setting]] = await Promise.all([
        sql`select c.id, c.name, (select h.name from account a join account h on h.id = a.parent_id where a.id = c.asset_account_id) as "group"
               from fa_category c where c.company_id = ${co} and c.is_active`,
        sql`select id, name from location where company_id = ${co} and parent_id is null and is_active`,
        sql`select code, name, acquisition_cost::float as cost, to_char(acquisition_date, 'YYYY-MM-DD') as acquired from fixed_asset where company_id = ${co}`,
        sql`select start_convention from fa_setting where company_id = ${co}`,
      ]);
      const drafts = (input.drafts ?? []).slice(0, 2000);
      const rows = reviewRows(drafts, { categories: cats as never, branches: branches as never, existing: existing as never, subMap: input.subMap ?? {},
        branchId: input.branchId, convention: (setting?.start_convention ?? "SAME_MONTH") as Convention, year: input.year, nbvMonth: null });
      const skipped = rows.filter((r) => !r.include || r.status === "attention")
        .map((r) => ({ line: r.line, name: r.name, reason: !r.include ? "Left out" : r.issues.filter((i) => i.level === "attention").map((i) => i.text).join(" ") }));
      const take = rows.filter((r) => r.include && r.status !== "attention");
      // One permission check for every branch the batch touches, not one per row.
      await assertFaBranch(user, ...new Set(take.map((r) => r.branchId)));
      const today = todayLocal();
      const imported: { line: number; code: string; id: string; name: string }[] = [];
      if (take.length) await sql.begin(async (tx) => {
        // The next codes, read once under the transaction; then every asset and every event in one statement each.
        const [mx] = await tx`select coalesce(max(substring(code from '^FA-(\\d+)$')::int), 0) as n from fixed_asset where company_id = ${co}`;
        const first = Number(mx.n);
        const assets = take.map((r, i) => ({
          company_id: co, code: `FA-${String(first + i + 1).padStart(4, "0")}`, name: r.name.slice(0, 200), category_id: r.category!.id,
          branch_id: r.branchId, notes: r.notes || null, acquisition_date: r.acquired, in_service_date: r.inService ?? r.acquired,
          acquisition_cost: r.cost!.toFixed(4), residual_value: r.residual.toFixed(4), useful_life_months: r.life, status: "ACTIVE",
          created_by: user.id, quantity: (r.qty ?? 1).toFixed(4), depreciation_start: r.start ? r.start + "-01" : null,
          opening_accumulated: r.opening ? r.opening.toFixed(4) : null,
          opening_through: r.opening && r.openingThrough ? r.openingThrough + "-01" : null,
          source_ref: `Import ${today} · row ${r.no || r.line}`,
        }));
        const made = await tx`insert into fixed_asset ${tx(assets)} returning id, code`;
        const idOf = new Map((made as any[]).map((m) => [m.code as string, m.id as string]));
        const events = take.flatMap((r, i) => {
          const id = idOf.get(assets[i].code)!;
          return [
            { company_id: co, asset_id: id, event_type: "CREATED", event_date: r.acquired, to_branch_id: r.branchId, created_by: user.id,
              detail: tx.json({ cost: r.cost, life: r.life, imported: true, row: r.no || r.line }) },
            { company_id: co, asset_id: id, event_type: "ACTIVATED", event_date: assets[i].in_service_date, to_branch_id: null, created_by: user.id,
              detail: tx.json({ imported: true }) },
          ];
        });
        await tx`insert into fa_event ${tx(events)}`;
        await syncUnits(tx, co, [...idOf.values()]);
        take.forEach((r, i) => imported.push({ line: r.line, code: assets[i].code, id: idOf.get(assets[i].code)!, name: r.name }));
      });
      revalidatePath("/fixed-assets", "layout");
      return { ok: true as const, imported, skipped };
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

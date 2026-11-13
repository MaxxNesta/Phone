"use server";

import { str } from "./input";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "./db";
import { requirePermission, can } from "./auth";
import { assertMyBranch, seenLocations } from "./branch-scope";
import { postOnce } from "./idempotency";
import { voidDocument } from "./posting";
import type { ActionResult } from "./actions";
import { createAdvance, repayAdvance, createRuns, saveSlip, postRun, payRun, nextEmployeeCode, type SlipLineInput } from "./hr";
import { KINDS, KIND_ACCOUNT, type Kind } from "./hr-calc";

const MONEY = /^\d{1,14}(\.\d{1,4})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const opt = (fd: FormData, k: string) => str(fd, k) || null;
const amount = (v: string) => v.replace(/,/g, "");
const err = (e: unknown): ActionResult => ({ error: e instanceof Error ? e.message : String(e) });
const toast = (path: string, msg: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}toast=${encodeURIComponent(msg)}`);

async function employeeBranch(co: string, id: string) {
  const [e] = await sql`select branch_id from employee where id = ${id} and company_id = ${co}`;
  if (!e) throw new Error("That employee no longer exists");
  await assertMyBranch(e.branch_id);
  return e.branch_id as string;
}
async function runBranch(co: string, id: string) {
  const [r] = await sql`select branch_id, status, document_id from hr_payroll_run where id = ${id} and company_id = ${co}`;
  if (!r) throw new Error("That payroll no longer exists");
  await assertMyBranch(r.branch_id);
  return r as { branch_id: string; status: string; document_id: string | null };
}

// ------------------------------------------------------------ employees --

export async function saveEmployee(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("hr.employees.edit");
  const co = user.companyId;
  let id = str(fd, "id");
  try {
    const name = str(fd, "full_name"), branch = str(fd, "branch_id");
    const status = str(fd, "status") || "ACTIVE", pay = str(fd, "pay_method") || "CASH";
    if (!name) return { error: "Enter the employee's name." };
    if (!branch) return { error: "Choose the branch they work at." };
    if (!["ACTIVE", "INACTIVE"].includes(status) || !["CASH", "BANK"].includes(pay)) return { error: "Choose a status and a payment method." };
    const joined = opt(fd, "joined_on");
    if (joined && !DATE.test(joined)) return { error: "Enter the joining date as a date." };
    await assertMyBranch(branch);
    if (id) await employeeBranch(co, id);
    const login = opt(fd, "user_id");
    if (login) {
      const [u] = await sql`select 1 from app_user where id = ${login} and company_id = ${co}`;
      if (!u) return { error: "That login is not in this company." };
    }
    // Bank details are pay data: kept as they are by someone who may not see salaries.
    const bank = can(user, "hr.salary.view");
    const v = {
      full_name: name, phone: opt(fd, "phone"), branch_id: branch, department: opt(fd, "department"), position: opt(fd, "position"),
      joined_on: joined, status, pay_method: pay, notes: opt(fd, "notes"), user_id: login,
      ...(bank ? { bank_name: opt(fd, "bank_name"), bank_account_name: opt(fd, "bank_account_name"), bank_account_no: opt(fd, "bank_account_no") } : {}),
    };
    if (id) {
      await sql`update employee set ${sql(v)}, updated_at = now() where id = ${id} and company_id = ${co}`;
    } else {
      const code = (str(fd, "code") || (await nextEmployeeCode(co))).toUpperCase();
      const [r] = await sql`insert into employee ${sql({ ...v, company_id: co, code })} returning id`;
      id = r.id;
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/employee_company_id_code_key/.test(m)) return { error: "Another employee already has that ID." };
    if (/employee_one_login/.test(m)) return { error: "That login is already linked to another employee." };
    return { error: m };
  }
  revalidatePath("/hr", "layout");
  return toast(`/hr/employees/${id}`, "Employee saved");
}

/** New salary settings from a date. Older rows stay as they were. */
export async function saveSalary(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("hr.salary.edit");
  const co = user.companyId, emp = str(fd, "employee_id");
  try {
    await employeeBranch(co, emp);
    const from = str(fd, "effective_from"), basic = amount(str(fd, "basic"));
    if (!DATE.test(from)) return { error: "Enter the date these settings start." };
    if (!MONEY.test(basic)) return { error: "Enter the basic monthly salary." };
    const names = fd.getAll("allowance_name").map(String), amts = fd.getAll("allowance_amount").map((a) => amount(String(a).trim()));
    const allowances = names.map((n, i) => ({ name: n.trim(), amount: amts[i] })).filter((a) => a.name || a.amount);
    for (const a of allowances) {
      if (!a.name || !MONEY.test(a.amount) || Number(a.amount) <= 0) return { error: "Each allowance needs a name and an amount above zero." };
    }
    await sql.begin(async (tx) => {
      const [s] = await tx`insert into hr_salary (company_id, employee_id, effective_from, basic, notes, created_by)
                           values (${co}, ${emp}, ${from}, ${basic}, ${opt(fd, "notes")}, ${user.id}) returning id`;
      if (allowances.length) await tx`insert into hr_salary_allowance ${tx(allowances.map((a) => ({ salary_id: s.id, ...a })))}`;
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { error: /hr_salary_employee_id_effective_from_key/.test(m) ? "Settings already start on that date. Choose another date." : m };
  }
  revalidatePath(`/hr/employees/${emp}`);
  return toast(`/hr/employees/${emp}`, "Salary settings saved");
}

// ------------------------------------------------------------- advances --

export async function createAdvanceAction(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("hr.advances");
  const co = user.companyId;
  let advId = "";
  try {
    const emp = str(fd, "employee_id"), date = str(fd, "advance_date"), amt = amount(str(fd, "amount"));
    const method = str(fd, "recovery_method") as "FULL" | "FIXED" | "MANUAL", fixed = amount(str(fd, "recovery_amount"));
    const first = str(fd, "first_period"), money = str(fd, "money_account_id");
    if (!emp) return { error: "Choose the employee." };
    if (!DATE.test(date)) return { error: "Enter the date the advance was paid." };
    if (!MONEY.test(amt) || Number(amt) <= 0) return { error: "Enter the amount paid." };
    if (!money) return { error: "Choose the till or bank account it was paid from." };
    if (!["FULL", "FIXED", "MANUAL"].includes(method)) return { error: "Choose how it is recovered." };
    if (method === "FIXED" && (!MONEY.test(fixed) || Number(fixed) <= 0)) return { error: "Enter the amount to recover each payroll." };
    if (!MONTH.test(first)) return { error: "Choose the first payroll month to recover from." };
    await employeeBranch(co, emp);
    const done = await postOnce(co, str(fd, "idempotency_key"), async (tx) => {
      const a = await createAdvance(tx, { co, userId: user.id, employeeId: emp, date, amount: amt, moneyAccountId: money,
        reference: opt(fd, "reference"), note: opt(fd, "note"), method, fixed: method === "FIXED" ? fixed : null, firstPeriod: first });
      return { id: a.documentId, docNo: a.no };
    });
    const [a] = await sql`select id from hr_advance where document_id = ${done.id}`;
    advId = a.id;
  } catch (e) {
    return err(e);
  }
  revalidatePath("/hr", "layout");
  return toast(`/hr/advances/${advId}`, "Advance paid");
}

export async function repayAdvanceAction(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("hr.advances");
  const co = user.companyId, id = str(fd, "advance_id");
  try {
    const date = str(fd, "date"), amt = amount(str(fd, "amount")), money = str(fd, "money_account_id");
    if (!DATE.test(date)) return { error: "Enter the date it was repaid." };
    if (!MONEY.test(amt) || Number(amt) <= 0) return { error: "Enter the amount repaid." };
    if (!money) return { error: "Choose the till or bank account it was paid into." };
    const [a] = await sql`select employee_id from hr_advance where id = ${id} and company_id = ${co}`;
    if (!a) return { error: "That advance no longer exists." };
    await employeeBranch(co, a.employee_id);
    await postOnce(co, str(fd, "idempotency_key"), async (tx) => {
      const r = await repayAdvance(tx, { co, advanceId: id, date, amount: amt, moneyAccountId: money });
      return { id: r.documentId, docNo: "" };
    });
  } catch (e) {
    return err(e);
  }
  revalidatePath("/hr", "layout");
  return toast(`/hr/advances/${id}`, "Repayment recorded");
}

// -------------------------------------------------------------- payroll --

export async function createRunAction(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("hr.payroll.prepare");
  const co = user.companyId;
  let to = "/hr/payroll", msg = "";
  try {
    const ps = str(fd, "period_start"), pe = str(fd, "period_end"), pd = str(fd, "posting_date");
    const kind = str(fd, "kind") === "SUPPLEMENTARY" ? "SUPPLEMENTARY" : "REGULAR";
    if (!DATE.test(ps) || !DATE.test(pe) || pe < ps) return { error: "Enter the period: a start and an end on or after it." };
    if (!DATE.test(pd)) return { error: "Enter the posting date." };
    const branch = str(fd, "branch_id");
    let branches: string[];
    if (branch === "ALL") {
      const seen = await seenLocations();
      branches = (await sql`select id from location where company_id = ${co} and parent_id is null and is_active
                              ${seen ? sql`and id = any(${seen})` : sql``} order by code`).map((b) => b.id);
    } else {
      if (!branch) return { error: "Choose a branch." };
      await assertMyBranch(branch);
      branches = [branch];
    }
    const made = await sql.begin((tx) => createRuns(tx, { co, userId: user.id, kind, periodStart: ps, periodEnd: pe, postingDate: pd,
      branchIds: branches, notes: opt(fd, "notes") }));
    if (made.length === 1) to = `/hr/payroll/${made[0].id}`;
    const skipped = made.flatMap((m) => m.skipped);
    msg = `${made.map((m) => `${m.no}: ${m.staff} staff`).join(", ")} prepared${skipped.length ? `. Left out: ${skipped.slice(0, 6).join(", ")}${skipped.length > 6 ? "…" : ""}` : ""}`;
  } catch (e) {
    return err(e);
  }
  revalidatePath("/hr/payroll");
  return toast(to, msg);
}

/** A draft payslip's lines, as typed. Per-person pay, so salaries permission too. */
export async function saveSlipAction(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("hr.payroll.prepare");
  await requirePermission("hr.salary.view");
  const co = user.companyId, id = str(fd, "slip_id");
  try {
    const [s] = await sql`select run_id from hr_payslip where id = ${id} and company_id = ${co}`;
    if (!s) return { error: "That payslip no longer exists." };
    await runBranch(co, s.run_id);
    const kinds = fd.getAll("kind").map(String), labels = fd.getAll("label").map(String);
    const amts = fd.getAll("amount").map((a) => amount(String(a).trim())), advs = fd.getAll("advance_id").map(String);
    const lines: SlipLineInput[] = [];
    for (let i = 0; i < kinds.length; i++) {
      if (!amts[i]) continue;
      if (!KINDS.includes(kinds[i] as Kind)) return { error: "Unknown payslip line." };
      if (!MONEY.test(amts[i])) return { error: `${labels[i] || kinds[i]}: enter an amount like 150000 or 150000.50.` };
      if (["OTHER_EARNING", "OTHER_DEDUCTION"].includes(kinds[i]) && Number(amts[i]) > 0 && !labels[i].trim()) {
        return { error: "Describe each other earning or deduction." };
      }
      lines.push({ kind: kinds[i] as Kind, label: labels[i] ?? "", amount: amts[i], advanceId: advs[i] || null });
    }
    await sql.begin((tx) => saveSlip(tx, co, id, lines));
  } catch (e) {
    return err(e);
  }
  revalidatePath("/hr", "layout");
  return toast(`/hr/payslips/${id}`, "Payslip saved");
}

export async function removeSlipAction(fd: FormData) {
  const user = await requirePermission("hr.payroll.prepare");
  const co = user.companyId, id = str(fd, "slip_id");
  const [s] = await sql`select s.run_id, r.status from hr_payslip s join hr_payroll_run r on r.id = s.run_id where s.id = ${id} and s.company_id = ${co}`;
  if (!s || s.status !== "DRAFT") throw new Error("Only a draft payroll's payslips can be removed");
  await runBranch(co, s.run_id);
  await sql`delete from hr_payslip where id = ${id}`;
  revalidatePath(`/hr/payroll/${s.run_id}`);
  toast(`/hr/payroll/${s.run_id}`, "Removed from this payroll");
}

export async function discardRunAction(fd: FormData) {
  const user = await requirePermission("hr.payroll.prepare");
  const co = user.companyId, id = str(fd, "run_id");
  const r = await runBranch(co, id);
  if (r.status !== "DRAFT") throw new Error("A posted payroll is reversed, not discarded");
  await sql`delete from hr_payroll_run where id = ${id} and status = 'DRAFT'`;
  revalidatePath("/hr/payroll");
  toast("/hr/payroll", "Draft payroll discarded");
}

export async function postRunAction(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("hr.payroll.post");
  const co = user.companyId, id = str(fd, "run_id");
  let no = "";
  try {
    await runBranch(co, id);
    no = (await sql.begin((tx) => postRun(tx, co, id, user.id))).docNo;
  } catch (e) {
    return err(e);
  }
  revalidatePath("/hr", "layout");
  return toast(`/hr/payroll/${id}`, `Posted as ${no}`);
}

/** Pays all that is unpaid, or the payslips ticked (choosing people needs salaries permission). */
export async function payRunAction(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("hr.payroll.pay");
  const co = user.companyId, id = str(fd, "run_id");
  let msg = "";
  try {
    const date = str(fd, "date"), money = str(fd, "money_account_id");
    // A batch unless individual payment was chosen; choosing employees is a payroll user's call.
    const individual = str(fd, "mode") === "individual";
    const picked = individual ? fd.getAll("slip_id").map(String).filter(Boolean) : [];
    if (individual) {
      await requirePermission("hr.salary.view");
      if (!picked.length) return { error: "Tick the employees to pay separately, or untick the option to pay the batch." };
    }
    if (!DATE.test(date)) return { error: "Enter the payment date." };
    if (!money) return { error: "Choose the till or bank account paid from." };
    await runBranch(co, id);
    const done = await postOnce(co, str(fd, "idempotency_key"), async (tx) => {
      const p = await payRun(tx, { co, runId: id, slipIds: picked.length ? picked : null, date, moneyAccountId: money });
      return { id: p.documentId, docNo: p.docNo };
    });
    msg = `Paid by ${done.docNo}`;
  } catch (e) {
    return err(e);
  }
  revalidatePath("/hr", "layout");
  return toast(`/hr/payroll/${id}`, msg);
}

/** Voids the run's journal through the usual void; the run then reads Reversed and its recoveries stop counting. */
export async function reverseRunAction(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("hr.payroll.post");
  const co = user.companyId, id = str(fd, "run_id");
  try {
    const r = await runBranch(co, id);
    if (!r.document_id) return { error: "A draft has nothing to reverse; discard it instead." };
    await voidDocument({ documentId: r.document_id, reason: opt(fd, "reason") ?? "Payroll reversed" });
  } catch (e) {
    return err(e);
  }
  revalidatePath("/hr", "layout");
  return toast(`/hr/payroll/${id}`, "Payroll reversed");
}

// ------------------------------------------------------------- settings --

const TYPES: Record<string, string[]> = {
  advance_account_id: ["ASSET"], payable_account_id: ["LIABILITY"],
  basic_account_id: ["EXPENSE"], allowance_account_id: ["EXPENSE"], overtime_account_id: ["EXPENSE"],
  commission_account_id: ["EXPENSE"], bonus_account_id: ["EXPENSE"], other_earning_account_id: ["EXPENSE"],
  tax_account_id: ["LIABILITY"], statutory_account_id: ["LIABILITY"], other_deduction_account_id: ["LIABILITY", "ASSET", "REVENUE"],
};

export async function saveHrSettings(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("settings.manage");
  const co = user.companyId;
  try {
    const v: Record<string, string | null> = {};
    for (const k of Object.values(KIND_ACCOUNT).concat("payable_account_id")) {
      const id = opt(fd, k);
      if (id) {
        const [a] = await sql`select account_type::text as t, is_postable, is_active, is_control, is_cash_account, is_bank_account
                                from account where id = ${id} and company_id = ${co}`;
        if (!a || !a.is_postable || !a.is_active || a.is_control || a.is_cash_account || a.is_bank_account) {
          return { error: "Choose active, postable accounts that are not a till, a bank or a control account." };
        }
        if (!TYPES[k].includes(a.t)) return { error: `${k.replace(/_account_id$/, "").replace(/_/g, " ")}: choose a ${TYPES[k].join(" or ").toLowerCase()} account.` };
      }
      v[k] = id;
    }
    await sql`insert into hr_setting ${sql({ company_id: co, ...v })}
              on conflict (company_id) do update set ${sql(v)}, updated_at = now()`;
  } catch (e) {
    return err(e);
  }
  revalidatePath("/hr", "layout");
  return { ok: true };
}

import type { TransactionSql } from "postgres";
import { sql } from "./db";
import { postJournalVoucher, postCashVoucher, postBankVoucher } from "./posting";
import { toUnits, fromUnits } from "./fa-engine";
import { slipTotals, suggestRecovery, runJournal, KIND_LABEL, KINDS, type Kind, type Line } from "./hr-calc";

/**
 * HR & Payroll (migration 0186): reads, and the postings that reach the
 * ledger. Every posting takes the transaction it runs in and one company-wide
 * lock, so two people cannot post one run, pay one payslip or recover one
 * advance twice. Money reaches the books only through lib/posting.ts.
 */

type Db = TransactionSql | typeof sql;
// ponytail: one lock per company for all HR postings; split per run/advance if payroll ever gets busy.
const lock = (tx: TransactionSql, co: string) => tx`select pg_advisory_xact_lock(hashtextextended(${`hr:${co}`}, 0))`;
const num = (u: bigint) => Number(fromUnits(u));
const where = (seen: string[] | null, col: string) => (seen ? sql`and ${sql(col)} = any(${seen})` : sql``);

export const EMPLOYEE_STATUS = { ACTIVE: "Active", INACTIVE: "Inactive" } as const;
export const RECOVERY_LABEL = { FULL: "Full, next payroll", FIXED: "Fixed amount per payroll", MANUAL: "Manual" } as const;
export const RUN_STATE_LABEL = { DRAFT: "Draft", POSTED: "Posted", PARTIAL: "Partially paid", PAID: "Paid", REVERSED: "Reversed" } as const;
export type RunState = keyof typeof RUN_STATE_LABEL;
/** The FA status chips, reused: draft grey, posted blue, partial amber, paid green, reversed outline. */
export const RUN_STATE_CLASS: Record<RunState, string> = {
  DRAFT: "fa-pill none", POSTED: "fa-pill ready", PARTIAL: "fa-pill partial", PAID: "fa-pill posted", REVERSED: "fa-pill exception",
};

export function runState(r: { status: string; journal_status: string | null; net: string | number; paid: string | number }): RunState {
  if (r.status === "DRAFT") return "DRAFT";
  if (r.journal_status !== "POSTED") return "REVERSED";
  const net = Number(r.net), paid = Number(r.paid);
  if (paid > 0 && paid >= net) return "PAID";
  return paid > 0 ? "PARTIAL" : "POSTED";
}

/** The next free code in a PREFIX-0001 series. */
async function nextCode(db: Db, co: string, table: "employee" | "hr_advance" | "hr_payroll_run", col: string, prefix: string) {
  const [r] = await db`
    select coalesce(max(substring(${db(col)} from ${`^${prefix}-(\\d+)$`})::int), 0) + 1 as n
      from ${db(table)} where company_id = ${co}`;
  return `${prefix}-${String(r.n).padStart(4, "0")}`;
}
export const nextEmployeeCode = (co: string) => nextCode(sql, co, "employee", "code", "EMP");

// ------------------------------------------------------------- settings --

export type HrSettings = Record<string, string | null>;
export async function hrSettings(co: string, db: Db = sql): Promise<HrSettings> {
  const [s] = await db`select * from hr_setting where company_id = ${co}`;
  return (s ?? {}) as HrSettings;
}

/** Postable, active accounts that are not a till or a bank, for the settings pickers. */
export async function hrAccounts(co: string) {
  return (await sql`
    select id, code, name, account_type::text as type from account
     where company_id = ${co} and is_postable and is_active and not is_control
       and not coalesce(is_cash_account, false) and not coalesce(is_bank_account, false)
     order by code`) as unknown as { id: string; code: string; name: string; type: string }[];
}

/** Tills and bank accounts, for paying an advance or salaries. */
export async function moneyAccounts(co: string) {
  return (await sql`
    select id, code, name, coalesce(is_bank_account, false) as bank from account
     where company_id = ${co} and is_postable and is_active and (is_cash_account or is_bank_account)
     order by code`) as unknown as { id: string; code: string; name: string; bank: boolean }[];
}

// ------------------------------------------------------------ employees --

export type EmployeeRow = {
  id: string; code: string; full_name: string; phone: string | null; branch_id: string; branch: string;
  department: string | null; position: string | null; joined_on: string | null; status: "ACTIVE" | "INACTIVE";
  pay_method: "CASH" | "BANK"; bank_name: string | null; bank_account_name: string | null; bank_account_no: string | null;
  notes: string | null; user_id: string | null; login: string | null;
};

export async function employeeList(co: string, seen: string[] | null) {
  return (await sql`
    select e.id, e.code, e.full_name, e.phone, e.branch_id, l.name as branch, e.department, e.position,
           to_char(e.joined_on, 'YYYY-MM-DD') as joined_on, e.status, e.pay_method,
           -- Bank details only on the employee's own page, for those who may see pay.
           null as bank_name, null as bank_account_name, null as bank_account_no, e.notes, e.user_id, u.name as login
      from employee e join location l on l.id = e.branch_id left join app_user u on u.id = e.user_id
     where e.company_id = ${co} ${where(seen, "e.branch_id")}
     order by e.code`) as unknown as EmployeeRow[];
}

export async function employee(co: string, id: string) {
  const [e] = await sql`
    select e.id, e.code, e.full_name, e.phone, e.branch_id, l.name as branch, e.department, e.position,
           to_char(e.joined_on, 'YYYY-MM-DD') as joined_on, e.status, e.pay_method, e.bank_name, e.bank_account_name,
           e.bank_account_no, e.notes, e.user_id, u.name as login
      from employee e join location l on l.id = e.branch_id left join app_user u on u.id = e.user_id
     where e.company_id = ${co} and e.id = ${id}`;
  return (e ?? null) as EmployeeRow | null;
}

export type SalaryRow = { id: string; effective_from: string; basic: string; notes: string | null; allowances: { name: string; amount: string }[] };
export async function salaryHistory(employeeId: string) {
  return (await sql`
    select s.id, to_char(s.effective_from, 'YYYY-MM-DD') as effective_from, s.basic::text as basic, s.notes,
           coalesce(json_agg(json_build_object('name', a.name, 'amount', a.amount::text) order by a.name)
                    filter (where a.id is not null), '[]') as allowances
      from hr_salary s left join hr_salary_allowance a on a.salary_id = s.id
     where s.employee_id = ${employeeId}
     group by s.id order by s.effective_from desc`) as unknown as SalaryRow[];
}

// ------------------------------------------------------------- advances --

export type AdvanceRow = {
  id: string; advance_no: string; employee_id: string; employee_code: string; employee_name: string; branch_id: string; branch: string;
  advance_date: string; amount: string; recovered: string; repaid: string; outstanding: string; recovery_method: keyof typeof RECOVERY_LABEL;
  recovery_amount: string | null; first_period: string; reference: string | null; note: string | null;
  document_id: string; doc_no: string; doc_status: string;
};
export const advanceState = (a: Pick<AdvanceRow, "doc_status" | "outstanding" | "recovered" | "repaid">) =>
  a.doc_status !== "POSTED" ? "VOID" : Number(a.outstanding) <= 0 ? "SETTLED" : Number(a.recovered) + Number(a.repaid) > 0 ? "PARTIAL" : "OPEN";
export const ADVANCE_STATE: Record<string, [string, string]> = {
  OPEN: ["Outstanding", "fa-pill due"], PARTIAL: ["Partly recovered", "fa-pill partial"],
  SETTLED: ["Recovered", "fa-pill posted"], VOID: ["Voided", "fa-pill exception"],
};

export async function advanceList(co: string, seen: string[] | null, employeeId?: string) {
  return (await sql`
    select a.id, a.advance_no, a.employee_id, a.employee_code, a.employee_name, a.branch_id, l.name as branch,
           to_char(a.advance_date, 'YYYY-MM-DD') as advance_date, a.amount::text, a.recovered::text, a.repaid::text,
           a.outstanding::text, a.recovery_method, a.recovery_amount::text, to_char(a.first_period, 'YYYY-MM') as first_period,
           a.reference, a.note, a.document_id, a.doc_no, a.doc_status
      from v_hr_advance a join location l on l.id = a.branch_id
     where a.company_id = ${co} ${where(seen, "a.branch_id")}
       ${employeeId ? sql`and a.employee_id = ${employeeId}` : sql``}
     order by a.advance_date desc, a.advance_no desc`) as unknown as AdvanceRow[];
}

/** What has come back on one advance: payroll recoveries and repayments, voided ones marked. */
export async function advanceHistory(advanceId: string) {
  return (await sql`
    select 'PAYROLL' as how, r.id as run_id, r.run_no as ref, to_char(r.posting_date, 'YYYY-MM-DD') as date, l.amount::text,
           d.id as doc_id, d.doc_no, d.status as doc_status
      from hr_payslip_line l join hr_payslip s on s.id = l.payslip_id join hr_payroll_run r on r.id = s.run_id
      join document d on d.id = r.document_id
     where l.advance_id = ${advanceId}
    union all
    select 'REPAID', null, d.doc_no, to_char(d.doc_date, 'YYYY-MM-DD'), x.amount::text, d.id, d.doc_no, d.status
      from hr_advance_repayment x join document d on d.id = x.document_id
     where x.advance_id = ${advanceId}
     order by 4, 3`) as unknown as { how: string; run_id: string | null; ref: string; date: string; amount: string; doc_id: string; doc_no: string; doc_status: string }[];
}

async function postMoneyVoucher(tx: TransactionSql, co: string, moneyAccountId: string, input: Parameters<typeof postCashVoucher>[0]) {
  const [m] = await tx`select is_cash_account, is_bank_account from account
                        where id = ${moneyAccountId} and company_id = ${co} and is_active and is_postable`;
  if (!m || !(m.is_cash_account || m.is_bank_account)) throw new Error("Choose a till or a bank account");
  return m.is_bank_account ? postBankVoucher(input, tx) : postCashVoucher(input, tx);
}

export type NewAdvance = {
  co: string; userId: string | null; employeeId: string; date: string; amount: string; moneyAccountId: string;
  reference: string | null; note: string | null; method: "FULL" | "FIXED" | "MANUAL"; fixed: string | null; firstPeriod: string;
};

/** Pays an advance out: Dr Employee Salary Advance, Cr the till or bank, at the employee's branch. */
export async function createAdvance(tx: TransactionSql, a: NewAdvance) {
  await lock(tx, a.co);
  const [e] = await tx`select id, code, branch_id, status from employee where id = ${a.employeeId} and company_id = ${a.co}`;
  if (!e) throw new Error("That employee no longer exists");
  if (e.status !== "ACTIVE") throw new Error(`${e.code} is inactive`);
  const s = await hrSettings(a.co, tx);
  if (!s.advance_account_id) throw new Error("Set the Employee Salary Advance account in HR & Payroll → Settings first");
  const no = await nextCode(tx, a.co, "hr_advance", "advance_no", "ADV");
  const amount = num(toUnits(a.amount));
  const doc = await postMoneyVoucher(tx, a.co, a.moneyAccountId, {
    companyId: a.co, docDate: a.date, locationId: e.branch_id, reference: a.reference ?? no,
    memo: `Salary advance ${no} · ${e.code}`,
    lines: [{ accountId: s.advance_account_id, amount }, { accountId: a.moneyAccountId, amount: -amount }],
  });
  const [row] = await tx`
    insert into hr_advance (company_id, advance_no, employee_id, advance_date, amount, document_id, recovery_method,
                            recovery_amount, first_period, reference, note, created_by)
    values (${a.co}, ${no}, ${e.id}, ${a.date}, ${a.amount}, ${doc.id}, ${a.method}, ${a.method === "FIXED" ? a.fixed : null},
            ${a.firstPeriod + "-01"}, ${a.reference}, ${a.note}, ${a.userId})
    returning id`;
  return { id: row.id as string, no, documentId: doc.id };
}

/** Money paid back outside payroll: Dr the till or bank, Cr Employee Salary Advance. */
export async function repayAdvance(tx: TransactionSql, r: { co: string; advanceId: string; date: string; amount: string; moneyAccountId: string }) {
  await lock(tx, r.co);
  const [a] = await tx`select id, advance_no, employee_code, branch_id, outstanding::text, doc_status from v_hr_advance
                        where id = ${r.advanceId} and company_id = ${r.co}`;
  if (!a) throw new Error("That advance no longer exists");
  if (a.doc_status !== "POSTED") throw new Error(`${a.advance_no} was voided`);
  if (toUnits(r.amount) > toUnits(a.outstanding)) throw new Error(`Only ${Number(a.outstanding).toLocaleString("en-US")} is outstanding on ${a.advance_no}`);
  const s = await hrSettings(r.co, tx);
  if (!s.advance_account_id) throw new Error("Set the Employee Salary Advance account first");
  const amount = num(toUnits(r.amount));
  const doc = await postMoneyVoucher(tx, r.co, r.moneyAccountId, {
    companyId: r.co, docDate: r.date, locationId: a.branch_id, reference: a.advance_no,
    memo: `Advance repaid ${a.advance_no} · ${a.employee_code}`,
    lines: [{ accountId: r.moneyAccountId, amount }, { accountId: s.advance_account_id, amount: -amount }],
  });
  await tx`insert into hr_advance_repayment (company_id, advance_id, document_id, amount)
           values (${r.co}, ${a.id}, ${doc.id}, ${r.amount})`;
  return { documentId: doc.id };
}

// -------------------------------------------------------------- payroll --

export type RunRow = {
  id: string; run_no: string; kind: "REGULAR" | "SUPPLEMENTARY"; period_start: string; period_end: string; posting_date: string;
  branch_id: string; branch: string; status: "DRAFT" | "POSTED"; document_id: string | null; doc_no: string | null;
  journal_status: string | null; notes: string | null; staff: number; gross: string; deductions: string; net: string; paid: string;
};

const RUN_SELECT = sql`
  select r.id, r.run_no, r.kind, to_char(r.period_start, 'YYYY-MM-DD') as period_start, to_char(r.period_end, 'YYYY-MM-DD') as period_end,
         to_char(r.posting_date, 'YYYY-MM-DD') as posting_date, r.branch_id, l.name as branch, r.status, r.document_id,
         d.doc_no, d.status as journal_status, r.notes, count(s.id)::int as staff,
         coalesce(sum(s.gross), 0)::text as gross, coalesce(sum(s.deductions), 0)::text as deductions,
         coalesce(sum(s.net), 0)::text as net, coalesce(sum(s.paid), 0)::text as paid
    from hr_payroll_run r join location l on l.id = r.branch_id
    left join document d on d.id = r.document_id
    left join v_hr_payslip s on s.run_id = r.id`;

export async function runList(co: string, seen: string[] | null) {
  return (await sql`${RUN_SELECT}
     where r.company_id = ${co} ${where(seen, "r.branch_id")}
     group by r.id, l.name, d.doc_no, d.status
     order by r.period_start desc, r.run_no desc`) as unknown as RunRow[];
}

export async function run(co: string, id: string) {
  const [r] = await sql`${RUN_SELECT} where r.company_id = ${co} and r.id = ${id} group by r.id, l.name, d.doc_no, d.status`;
  return (r ?? null) as RunRow | null;
}

export type SlipRow = {
  id: string; run_id: string; run_no: string; run_kind: string; employee_id: string; employee_code: string; employee_name: string;
  department: string | null; position: string | null; branch_id: string; period_start: string; period_end: string; posting_date: string;
  run_status: string; journal_status: string | null; gross: string; deductions: string; net: string; paid: string;
};
const SLIP_SELECT = sql`
  select s.id, s.run_id, s.run_no, s.run_kind, s.employee_id, s.employee_code, s.employee_name, s.department, s.position, s.branch_id,
         to_char(s.period_start, 'YYYY-MM-DD') as period_start, to_char(s.period_end, 'YYYY-MM-DD') as period_end,
         to_char(s.posting_date, 'YYYY-MM-DD') as posting_date, s.run_status, s.journal_status,
         s.gross::text, s.deductions::text, s.net::text, s.paid::text
    from v_hr_payslip s`;

export async function slipList(co: string, seen: string[] | null, by: { runId?: string; employeeId?: string } = {}) {
  return (await sql`${SLIP_SELECT}
     where s.company_id = ${co} ${where(seen, "s.branch_id")}
       ${by.runId ? sql`and s.run_id = ${by.runId}` : sql``}
       ${by.employeeId ? sql`and s.employee_id = ${by.employeeId}` : sql``}
     order by s.period_start desc, s.run_no desc, s.employee_code`) as unknown as SlipRow[];
}

export async function slip(co: string, id: string) {
  const [s] = await sql`${SLIP_SELECT} where s.company_id = ${co} and s.id = ${id}`;
  if (!s) return null;
  const lines = await sql`
    select l.kind, l.label, l.amount::text, l.advance_id, a.advance_no
      from hr_payslip_line l left join hr_advance a on a.id = l.advance_id
     where l.payslip_id = ${id} order by l.seq, l.kind`;
  return { ...(s as unknown as SlipRow), lines: lines as unknown as { kind: Kind; label: string; amount: string; advance_id: string | null; advance_no: string | null }[] };
}

/** The live advances an employee could repay through a payslip, oldest first. */
export async function openAdvances(employeeIds: string[], db: Db = sql) {
  return (await db`
    select id, employee_id, advance_no, outstanding::text, recovery_method, recovery_amount::text,
           to_char(first_period, 'YYYY-MM-DD') as first_period
      from v_hr_advance
     where employee_id = any(${employeeIds}) and doc_status = 'POSTED' and outstanding > 0
     order by advance_date, advance_no`) as unknown as
    { id: string; employee_id: string; advance_no: string; outstanding: string; recovery_method: "FULL" | "FIXED" | "MANUAL"; recovery_amount: string | null; first_period: string }[];
}

export type NewRun = {
  co: string; userId: string | null; kind: "REGULAR" | "SUPPLEMENTARY"; periodStart: string; periodEnd: string;
  postingDate: string; branchIds: string[]; notes: string | null;
};

/**
 * Prepares a draft run per branch: every active employee with salary
 * settings in force by the period's end, their basic and allowances copied
 * from those settings, and advance recoveries suggested. A regular run leaves
 * out anyone already in another regular run (draft or posted) for an
 * overlapping period. Nothing is prorated: joiners and leavers are adjusted
 * on the draft by hand.
 */
export async function createRuns(tx: TransactionSql, n: NewRun) {
  await lock(tx, n.co);
  const made: { id: string; no: string; staff: number; skipped: string[] }[] = [];
  for (const branchId of n.branchIds) {
    const no = await nextCode(tx, n.co, "hr_payroll_run", "run_no", "PRL");
    const [r] = await tx`
      insert into hr_payroll_run (company_id, run_no, kind, period_start, period_end, posting_date, branch_id, notes, created_by)
      values (${n.co}, ${no}, ${n.kind}, ${n.periodStart}, ${n.periodEnd}, ${n.postingDate}, ${branchId}, ${n.notes}, ${n.userId})
      returning id`;
    const staff = await tx`
      select e.id, e.code, e.full_name, e.department, e.position, sal.id as salary_id, sal.basic::text as basic,
             exists (select 1 from hr_payslip s join hr_payroll_run o on o.id = s.run_id
                      left join document od on od.id = o.document_id
                      where s.employee_id = e.id and o.id <> ${r.id} and o.kind = 'REGULAR' and ${n.kind} = 'REGULAR'
                        and (o.status = 'DRAFT' or od.status = 'POSTED')
                        and o.period_start <= ${n.periodEnd} and o.period_end >= ${n.periodStart}) as taken
        from employee e
        left join lateral (select id, basic from hr_salary where employee_id = e.id and effective_from <= ${n.periodEnd}
                            order by effective_from desc limit 1) sal on true
       where e.company_id = ${n.co} and e.branch_id = ${branchId} and e.status = 'ACTIVE'
       order by e.code`;
    const skipped = staff.filter((e) => !e.salary_id || e.taken).map((e) => `${e.code}${e.taken ? " (already in a regular run)" : " (no salary settings)"}`);
    const take = staff.filter((e) => e.salary_id && !e.taken);
    if (take.length) {
      const allowances = await tx`select salary_id, name, amount::text from hr_salary_allowance
                                   where salary_id = any(${take.map((e) => e.salary_id)}) order by name`;
      const advances = n.kind === "REGULAR" ? await openAdvances(take.map((e) => e.id), tx) : [];
      const slips = await tx`insert into hr_payslip ${tx(take.map((e) => ({
        company_id: n.co, run_id: r.id, employee_id: e.id, employee_code: e.code, employee_name: e.full_name,
        department: e.department, position: e.position, salary_id: e.salary_id })))} returning id, employee_id`;
      const slipOf = new Map(slips.map((s) => [s.employee_id, s.id]));
      const lines: Record<string, unknown>[] = [];
      for (const e of take) {
        const payslip_id = slipOf.get(e.id);
        const earn: { kind: Kind; label: string; amount: string }[] = [];
        // A supplementary run starts empty: its bonus or correction is typed in.
        if (n.kind === "REGULAR") {
          if (toUnits(e.basic) > 0n) earn.push({ kind: "BASIC", label: KIND_LABEL.BASIC, amount: e.basic });
          for (const a of allowances.filter((a) => a.salary_id === e.salary_id)) earn.push({ kind: "ALLOWANCE", label: a.name, amount: a.amount });
        }
        earn.forEach((l, i) => lines.push({ payslip_id, seq: i, ...l, advance_id: null }));
        const gross = earn.reduce((t, l) => t + toUnits(l.amount), 0n);
        const mine = advances.filter((a) => a.employee_id === e.id);
        for (const s of suggestRecovery(mine.map((a) => ({ id: a.id, outstanding: toUnits(a.outstanding), method: a.recovery_method,
          fixed: a.recovery_amount ? toUnits(a.recovery_amount) : null, firstPeriod: a.first_period })), n.periodStart, gross)) {
          const a = mine.find((x) => x.id === s.id)!;
          lines.push({ payslip_id, seq: 100 + lines.length, kind: "ADVANCE", label: `Advance ${a.advance_no}`, amount: fromUnits(s.amount), advance_id: a.id });
        }
      }
      if (lines.length) await tx`insert into hr_payslip_line ${tx(lines as never)}`;
    }
    made.push({ id: r.id, no, staff: take.length, skipped });
  }
  return made;
}

export type SlipLineInput = { kind: Kind; label: string; amount: string; advanceId: string | null };

/** Replaces a draft payslip's lines, after checking advances and that net pay stays at or above zero. */
export async function saveSlip(tx: TransactionSql, co: string, slipId: string, input: SlipLineInput[]) {
  await lock(tx, co);
  const [s] = await tx`select s.id, s.employee_id, r.status from hr_payslip s join hr_payroll_run r on r.id = s.run_id
                        where s.id = ${slipId} and s.company_id = ${co} for update of r`;
  if (!s) throw new Error("That payslip no longer exists");
  if (s.status !== "DRAFT") throw new Error("This payroll is posted; its payslips cannot change");
  const lines = input.filter((l) => toUnits(l.amount) > 0n);
  for (const l of lines) if (!KINDS.includes(l.kind)) throw new Error("Unknown payslip line");
  const adv = lines.filter((l) => l.kind === "ADVANCE");
  if (adv.length) {
    const open = await openAdvances([s.employee_id], tx);
    const asked = new Map<string, bigint>();
    for (const l of adv) asked.set(l.advanceId!, (asked.get(l.advanceId!) ?? 0n) + toUnits(l.amount));
    for (const [id, amt] of asked) {
      const a = open.find((o) => o.id === id);
      if (!a) throw new Error("That advance is not open for this employee");
      if (amt > toUnits(a.outstanding)) throw new Error(`${a.advance_no}: only ${Number(a.outstanding).toLocaleString("en-US")} is outstanding`);
    }
  }
  const t = slipTotals(lines.map((l) => ({ kind: l.kind, amount: toUnits(l.amount) })));
  if (t.net < 0n) throw new Error(`Deductions are ${Number(fromUnits(-t.net)).toLocaleString("en-US")} more than gross pay. Net pay cannot be negative.`);
  await tx`delete from hr_payslip_line where payslip_id = ${slipId}`;
  if (lines.length) await tx`insert into hr_payslip_line ${tx(lines.map((l, i) => ({
    payslip_id: slipId, seq: i, kind: l.kind, label: l.label.trim() || KIND_LABEL[l.kind], amount: l.amount,
    advance_id: l.kind === "ADVANCE" ? l.advanceId : null })))}`;
  return t;
}

/**
 * Posts a draft run as one journal voucher at its branch: earnings debit
 * their expense accounts, recoveries credit the advance account, withholdings
 * their payables, net pay Salary Payable. One line per account, so the ledger
 * never shows one person's pay.
 */
export async function postRun(tx: TransactionSql, co: string, runId: string, userId: string | null) {
  await lock(tx, co);
  const [r] = await tx`select id, run_no, kind, status, branch_id, to_char(period_start, 'YYYY-MM-DD') as ps,
                              to_char(period_end, 'YYYY-MM-DD') as pe, to_char(posting_date, 'YYYY-MM-DD') as pd
                         from hr_payroll_run where id = ${runId} and company_id = ${co} for update`;
  if (!r) throw new Error("That payroll no longer exists");
  if (r.status !== "DRAFT") throw new Error(`${r.run_no} is already posted`);
  const rows = await tx`select s.id as slip, s.employee_id, s.employee_code, l.kind, l.amount::text, l.advance_id
                          from hr_payslip s join hr_payslip_line l on l.payslip_id = s.id where s.run_id = ${runId}`;
  if (rows.length === 0) throw new Error("This payroll has no pay on it");
  const all: Line[] = rows.map((x) => ({ kind: x.kind, amount: toUnits(x.amount), advanceId: x.advance_id }));
  for (const slip of new Set(rows.map((x) => x.slip))) {
    const mine = rows.filter((x) => x.slip === slip);
    if (slipTotals(mine.map((x) => ({ kind: x.kind, amount: toUnits(x.amount) }))).net < 0n) {
      throw new Error(`${mine[0].employee_code}: net pay is negative`);
    }
  }
  if (r.kind === "REGULAR") {
    const dup = await tx`
      select s.employee_code, o.run_no from hr_payslip s join hr_payroll_run o on o.id = s.run_id
        join document d on d.id = o.document_id and d.status = 'POSTED'
       where o.company_id = ${co} and o.kind = 'REGULAR' and o.id <> ${runId}
         and o.period_start <= ${r.pe} and o.period_end >= ${r.ps}
         and s.employee_id in (select employee_id from hr_payslip where run_id = ${runId})
       limit 5`;
    if (dup.length) throw new Error(`Already paid for this period: ${dup.map((d) => `${d.employee_code} in ${d.run_no}`).join(", ")}`);
  }
  const asked = new Map<string, { amount: bigint; employee: string }>();
  for (const x of rows.filter((x) => x.advance_id)) {
    const p = asked.get(x.advance_id) ?? { amount: 0n, employee: x.employee_id };
    asked.set(x.advance_id, { amount: p.amount + toUnits(x.amount), employee: x.employee_id });
  }
  if (asked.size) {
    await tx`select id from hr_advance where id = any(${[...asked.keys()]}) for update`;
    const live = await tx`select id, advance_no, employee_id, outstanding::text, doc_status from v_hr_advance where id = any(${[...asked.keys()]})`;
    for (const [id, a] of asked) {
      const v = live.find((l) => l.id === id);
      if (!v || v.doc_status !== "POSTED" || v.employee_id !== a.employee) throw new Error(`An advance on this payroll was voided or belongs to someone else`);
      if (a.amount > toUnits(v.outstanding)) throw new Error(`${v.advance_no}: only ${Number(v.outstanding).toLocaleString("en-US")} is outstanding`);
    }
  }
  const s = await hrSettings(co, tx);
  const j = runJournal(all, s, s.payable_account_id ?? null);
  if (j.missing.length) throw new Error(`Set these accounts in HR & Payroll → Settings: ${j.missing.join(", ")}`);
  const doc = await postJournalVoucher({
    companyId: co, docDate: r.pd, locationId: r.branch_id, reference: r.run_no,
    memo: `Payroll ${r.run_no} · ${r.ps} to ${r.pe}`,
    lines: j.lines.map((l) => ({ accountId: l.accountId, amount: num(l.amount), locationId: r.branch_id })),
  }, tx);
  await tx`update hr_payroll_run set status = 'POSTED', document_id = ${doc.id}, posted_by = ${userId}, posted_at = now() where id = ${runId}`;
  return { documentId: doc.id, docNo: doc.docNo };
}

/**
 * Pays a posted run's net pay, in full per payslip: all that is unpaid, or the
 * payslips chosen. One voucher, Dr Salary Payable, Cr the till or bank.
 */
export async function payRun(tx: TransactionSql, p: { co: string; runId: string; slipIds: string[] | null; date: string; moneyAccountId: string }) {
  await lock(tx, p.co);
  const [r] = await tx`select r.id, r.run_no, r.branch_id, r.status, d.status as journal_status
                         from hr_payroll_run r left join document d on d.id = r.document_id
                        where r.id = ${p.runId} and r.company_id = ${p.co}`;
  if (!r) throw new Error("That payroll no longer exists");
  if (r.status !== "POSTED" || r.journal_status !== "POSTED") throw new Error(`${r.run_no} is not posted`);
  const due = (await tx`select id, employee_code, (net - paid)::text as due from v_hr_payslip
                          where run_id = ${p.runId} and net > paid
                            ${p.slipIds ? tx`and id = any(${p.slipIds})` : tx``}`) as unknown as { id: string; employee_code: string; due: string }[];
  if (due.length === 0) throw new Error("Nothing is left to pay on the payslips chosen");
  const total = due.reduce((t, d) => t + toUnits(d.due), 0n);
  const s = await hrSettings(p.co, tx);
  if (!s.payable_account_id) throw new Error("Set the Salary Payable account first");
  const doc = await postMoneyVoucher(tx, p.co, p.moneyAccountId, {
    companyId: p.co, docDate: p.date, locationId: r.branch_id, reference: r.run_no,
    memo: `Salaries ${r.run_no} · ${due.length} staff`,
    lines: [{ accountId: s.payable_account_id, amount: num(total) }, { accountId: p.moneyAccountId, amount: -num(total) }],
  });
  await tx`insert into hr_salary_payment ${tx(due.map((d) => ({ company_id: p.co, payslip_id: d.id, document_id: doc.id, amount: d.due })))}`;
  return { documentId: doc.id, docNo: doc.docNo, total: fromUnits(total), staff: due.length };
}

/** The run's journal, account by account, as posted. */
export async function runJournalLines(documentId: string) {
  return (await sql`
    select a.code, a.name, sum(greatest(jl.base_amount, 0))::text as debit, sum(greatest(-jl.base_amount, 0))::text as credit
      from document d join journal_line jl on jl.journal_entry_id = d.journal_entry_id join account a on a.id = jl.account_id
     where d.id = ${documentId}
     group by a.code, a.name order by sum(jl.base_amount) desc, a.code`) as unknown as { code: string; name: string; debit: string; credit: string }[];
}

/** Salary payments against a run, voucher by voucher. */
export async function runPayments(runId: string) {
  return (await sql`
    select d.id, d.doc_no, to_char(d.doc_date, 'YYYY-MM-DD') as date, d.status, count(*)::int as staff, sum(x.amount)::text as amount
      from hr_salary_payment x join hr_payslip s on s.id = x.payslip_id join document d on d.id = x.document_id
     where s.run_id = ${runId}
     group by d.id order by d.doc_date, d.doc_no`) as unknown as { id: string; doc_no: string; date: string; status: string; staff: number; amount: string }[];
}

/** What a voucher is in HR & Payroll, for its document page: no amounts, just the way back. */
export async function hrLinksFor(documentId: string) {
  return (await sql`
    select 'Salary advance' as what, a.advance_no as ref, '/hr/advances/' || a.id as href from hr_advance a where a.document_id = ${documentId}
    union all
    select 'Advance repayment', a.advance_no, '/hr/advances/' || a.id from hr_advance_repayment x join hr_advance a on a.id = x.advance_id where x.document_id = ${documentId}
    union all
    select 'Payroll', r.run_no, '/hr/payroll/' || r.id from hr_payroll_run r where r.document_id = ${documentId}
    union all
    select distinct 'Salary payment', r.run_no, '/hr/payroll/' || r.id from hr_salary_payment x join hr_payslip s on s.id = x.payslip_id
      join hr_payroll_run r on r.id = s.run_id where x.document_id = ${documentId}`) as unknown as { what: string; ref: string; href: string }[];
}

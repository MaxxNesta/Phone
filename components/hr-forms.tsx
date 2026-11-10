"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import type { ActionResult } from "@/lib/actions";
import { useNotice } from "@/components/toast";

type Action = (p: unknown, fd: FormData) => Promise<ActionResult>;
type Opt = { id: string; code?: string; name: string };
const label = (o: Opt) => (o.code ? `${o.code} · ${o.name}` : o.name);

/** The FA forms' wiring: action state, the toast, and the error banner. */
function useForm(action: Action, ok?: string, confirmFirst?: string) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action as never, null);
  useNotice(state, ok ? { ok } : {});
  const alert = state && "error" in state ? <div className="alert" role="alert">{state.error}</div> : null;
  // Submitted by hand rather than through action=, which resets every field
  // once the action returns: a refused save would wipe what was typed.
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (confirmFirst && !confirm(confirmFirst)) return;
    const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => formAction(fd));
  };
  return { onSubmit, pending, alert };
}
const Key = () => { const [k] = useState(() => crypto.randomUUID()); return <input type="hidden" name="idempotency_key" value={k} />; };
const Money = ({ name, value, required, max }: { name: string; value?: string; required?: boolean; max?: string }) => (
  <span className="ie-money"><i>MMK</i><input name={name} defaultValue={value} inputMode="decimal" required={required} placeholder={max ? `up to ${max}` : undefined} /></span>
);
const Pick = ({ name, list, value, required, empty = "Choose…" }: { name: string; list: Opt[]; value?: string | null; required?: boolean; empty?: string }) => (
  <select name={name} defaultValue={value ?? ""} required={required}>
    <option value="">{empty}</option>{list.map((o) => <option key={o.id} value={o.id}>{label(o)}</option>)}
  </select>
);

// ------------------------------------------------------------ employees --

export type EmployeeValue = {
  id?: string; code: string; full_name: string; phone: string | null; branch_id: string; department: string | null; position: string | null;
  joined_on: string | null; status: string; pay_method: string; bank_name: string | null; bank_account_name: string | null;
  bank_account_no: string | null; notes: string | null; user_id: string | null;
};

export function EmployeeForm({ action, value, branches, logins, showBank }: {
  action: Action; value: EmployeeValue; branches: Opt[]; logins: Opt[]; showBank: boolean;
}) {
  const { onSubmit, pending, alert } = useForm(action);
  const [pay, setPay] = useState(value.pay_method);
  const v = value;
  return (
    <form onSubmit={onSubmit} className="ie-form">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <header className="ie-title">
        <h1>{v.id ? "Edit employee" : "Add employee"}</h1>
        <p>{v.id ? `${v.code} · ${v.full_name}` : "A person on the payroll. This does not create a login."}</p>
      </header>
      {alert}
      <div className="ie-main">
        <section className="ie-card">
          <h3>Employee</h3>
          <div className="ie-grid3">
            <label className="ie-field"><span>Full name</span><input name="full_name" defaultValue={v.full_name} required maxLength={200} autoFocus={!v.id} /></label>
            <label className="ie-field"><span>Employee ID</span>
              <input name="code" defaultValue={v.code} className="mono" style={{ textTransform: "uppercase" }} disabled={Boolean(v.id)} /></label>
            <label className="ie-field"><span>Phone</span><input name="phone" defaultValue={v.phone ?? ""} inputMode="tel" /></label>
          </div>
          <div className="ie-grid3" style={{ marginTop: "var(--s2)" }}>
            <label className="ie-field"><span>Branch</span><Pick name="branch_id" list={branches} value={v.branch_id} required /></label>
            <label className="ie-field"><span>Department</span><input name="department" defaultValue={v.department ?? ""} /></label>
            <label className="ie-field"><span>Position</span><input name="position" defaultValue={v.position ?? ""} /></label>
          </div>
          <div className="ie-grid3" style={{ marginTop: "var(--s2)" }}>
            <label className="ie-field"><span>Joining date</span><input type="date" name="joined_on" defaultValue={v.joined_on ?? ""} /></label>
            <label className="ie-field"><span>Status</span>
              <select name="status" defaultValue={v.status}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label>
            <label className="ie-field"><span>Linked login <small className="fa-muted">(optional)</small></span>
              <Pick name="user_id" list={logins} value={v.user_id} empty="None" /></label>
          </div>
        </section>
        <section className="ie-card">
          <h3>Payment</h3>
          <div className="ie-grid4">
            <label className="ie-field"><span>Paid by</span>
              <select name="pay_method" value={pay} onChange={(e) => setPay(e.target.value)}><option value="CASH">Cash</option><option value="BANK">Bank transfer</option></select></label>
            {showBank && pay === "BANK" && <>
              <label className="ie-field"><span>Bank</span><input name="bank_name" defaultValue={v.bank_name ?? ""} /></label>
              <label className="ie-field"><span>Account name</span><input name="bank_account_name" defaultValue={v.bank_account_name ?? ""} /></label>
              <label className="ie-field"><span>Account number</span><input name="bank_account_no" defaultValue={v.bank_account_no ?? ""} className="mono" /></label>
            </>}
          </div>
          {!showBank && <p className="ie-note">Bank details are kept with salaries; only someone who may see salaries can view or change them.</p>}
        </section>
        <section className="ie-card">
          <h3>Notes</h3>
          <label className="ie-field"><span>Anything worth keeping with the record</span><textarea name="notes" rows={3} defaultValue={v.notes ?? ""} /></label>
        </section>
      </div>
      <footer className="ie-bar">
        <Link className="ie-btn" href={v.id ? `/hr/employees/${v.id}` : "/hr/employees"}><ArrowLeft size={15} aria-hidden="true" /> Back</Link>
        <span className="ie-bar-note" />
        <button type="submit" className="ie-btn primary" disabled={pending}>{pending ? "Saving…" : "Save employee"}</button>
      </footer>
    </form>
  );
}

export function SalaryForm({ action, employeeId, latest, today }: {
  action: Action; employeeId: string; today: string;
  latest: { basic: string; allowances: { name: string; amount: string }[] } | null;
}) {
  const { onSubmit, pending, alert } = useForm(action);
  const [rows, setRows] = useState(latest?.allowances.length ? latest.allowances : [{ name: "", amount: "" }]);
  return (
    <form onSubmit={onSubmit} className="fas-form">
      <input type="hidden" name="employee_id" value={employeeId} />
      {alert}
      <div className="ie-grid3">
        <label className="ie-field"><span>Effective from</span><input type="date" name="effective_from" defaultValue={today} required /></label>
        <label className="ie-field"><span>Basic monthly salary</span><Money name="basic" value={latest ? String(Number(latest.basic)) : ""} required /></label>
        <label className="ie-field"><span>Notes</span><input name="notes" /></label>
      </div>
      <table className="ie-table">
        <thead><tr><th>Recurring allowance</th><th className="r">Amount (MMK)</th><th /></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i}>
            <td><input name="allowance_name" defaultValue={r.name} placeholder="e.g. Transport" aria-label="Allowance name" /></td>
            <td className="r"><input name="allowance_amount" defaultValue={r.amount ? String(Number(r.amount)) : ""} inputMode="decimal" aria-label="Allowance amount" /></td>
            <td><button type="button" className="linkish" onClick={() => setRows(rows.filter((_, k) => k !== i))} aria-label="Remove allowance"><Trash2 size={14} /></button></td>
          </tr>))}</tbody>
      </table>
      <p className="ie-note">A change starts from its date and leaves earlier settings, and posted payslips, as they were.</p>
      <div className="fa-head-actions">
        <button type="button" className="ie-btn" onClick={() => setRows([...rows, { name: "", amount: "" }])}><Plus size={14} aria-hidden="true" /> Add allowance</button>
        <button className="ie-btn primary" disabled={pending}>{pending ? "Saving…" : "Save salary settings"}</button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------- advances --

export function AdvanceForm({ action, employees, money, today, employeeId }: {
  action: Action; employees: Opt[]; money: Opt[]; today: string; employeeId?: string;
}) {
  const { onSubmit, pending, alert } = useForm(action);
  const [method, setMethod] = useState("FULL");
  return (
    <form onSubmit={onSubmit} className="ie-form">
      <Key />
      <header className="ie-title"><h1>Salary advance</h1><p>Money paid to an employee now, recovered from later payrolls.</p></header>
      {alert}
      <div className="ie-main">
        <section className="ie-card">
          <h3>Advance</h3>
          <div className="ie-grid3">
            <label className="ie-field"><span>Employee</span><Pick name="employee_id" list={employees} value={employeeId} required /></label>
            <label className="ie-field"><span>Date</span><input type="date" name="advance_date" defaultValue={today} required /></label>
            <label className="ie-field"><span>Amount</span><Money name="amount" required /></label>
          </div>
          <div className="ie-grid3" style={{ marginTop: "var(--s2)" }}>
            <label className="ie-field"><span>Paid from</span><Pick name="money_account_id" list={money} required /></label>
            <label className="ie-field"><span>Reference</span><input name="reference" /></label>
            <label className="ie-field"><span>Note</span><input name="note" /></label>
          </div>
        </section>
        <section className="ie-card">
          <h3>Recovery</h3>
          <div className="ie-grid3">
            <label className="ie-field"><span>Recover</span>
              <select name="recovery_method" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="FULL">In full, in one payroll</option>
                <option value="FIXED">A fixed amount each payroll</option>
                <option value="MANUAL">Manually, as decided on each payroll</option>
              </select></label>
            {method === "FIXED" && <label className="ie-field"><span>Each payroll</span><Money name="recovery_amount" required /></label>}
            <label className="ie-field"><span>From payroll month</span><input type="month" name="first_period" defaultValue={today.slice(0, 7)} required /></label>
          </div>
          <p className="ie-note">Payroll suggests the recovery; it can be changed on the draft payslip, and never takes more than is outstanding.</p>
        </section>
      </div>
      <footer className="ie-bar">
        <Link className="ie-btn" href="/hr/advances"><ArrowLeft size={15} aria-hidden="true" /> Back</Link>
        <span className="ie-bar-note" />
        <button type="submit" className="ie-btn primary" disabled={pending}>{pending ? "Posting…" : "Pay advance"}</button>
      </footer>
    </form>
  );
}

export function RepayForm({ action, advanceId, money, today, outstanding }: { action: Action; advanceId: string; money: Opt[]; today: string; outstanding: string }) {
  const { onSubmit, pending, alert } = useForm(action);
  return (
    <form onSubmit={onSubmit} className="fas-form">
      <Key /><input type="hidden" name="advance_id" value={advanceId} />
      {alert}
      <label className="ie-field"><span>Date</span><input type="date" name="date" defaultValue={today} required /></label>
      <label className="ie-field"><span>Amount</span><Money name="amount" required max={outstanding} /></label>
      <label className="ie-field"><span>Paid into</span><Pick name="money_account_id" list={money} required /></label>
      <div><button className="ie-btn primary" disabled={pending}>{pending ? "Posting…" : "Record repayment"}</button></div>
    </form>
  );
}

// -------------------------------------------------------------- payroll --

export function RunForm({ action, branches, period }: { action: Action; branches: Opt[]; period: { start: string; end: string } }) {
  const { onSubmit, pending, alert } = useForm(action);
  return (
    <form onSubmit={onSubmit} className="ie-form">
      <header className="ie-title"><h1>New payroll</h1><p>A draft per branch, filled from each employee&apos;s salary settings and open advances.</p></header>
      {alert}
      <div className="ie-main">
        <section className="ie-card">
          <h3>Period</h3>
          <div className="ie-grid4">
            <label className="ie-field"><span>Period start</span><input type="date" name="period_start" defaultValue={period.start} required /></label>
            <label className="ie-field"><span>Period end</span><input type="date" name="period_end" defaultValue={period.end} required /></label>
            <label className="ie-field"><span>Posting date</span><input type="date" name="posting_date" defaultValue={period.end} required /></label>
            <label className="ie-field"><span>Kind</span>
              <select name="kind" defaultValue="REGULAR"><option value="REGULAR">Regular monthly</option><option value="SUPPLEMENTARY">Supplementary (bonus, correction)</option></select></label>
          </div>
          <div className="ie-grid3" style={{ marginTop: "var(--s2)" }}>
            <label className="ie-field"><span>Branch</span>
              <select name="branch_id" defaultValue={branches.length === 1 ? branches[0].id : "ALL"} required>
                {branches.length > 1 && <option value="ALL">All my branches (one run each)</option>}
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></label>
            <label className="ie-field"><span>Notes</span><input name="notes" /></label>
          </div>
          <p className="ie-note">Active employees with salary settings are included; remove anyone on the draft. Nothing is prorated: adjust joiners and leavers on their payslip. A regular run leaves out anyone already in a regular run for this period.</p>
        </section>
      </div>
      <footer className="ie-bar">
        <Link className="ie-btn" href="/hr/payroll"><ArrowLeft size={15} aria-hidden="true" /> Back</Link>
        <span className="ie-bar-note" />
        <button type="submit" className="ie-btn primary" disabled={pending}>{pending ? "Preparing…" : "Prepare draft"}</button>
      </footer>
    </form>
  );
}

type SlipLine = { kind: string; label: string; amount: string; advance_id: string | null };
const EARN_KINDS = [["BASIC", "Basic salary"], ["OVERTIME", "Overtime"], ["COMMISSION", "Commission"], ["BONUS", "Bonus"]] as const;
const DED_KINDS = [["TAX", "Income tax"], ["STATUTORY", "Employee contribution"]] as const;

/** A draft payslip: every amount editable, totals as you type, net never below zero. */
export function SlipForm({ action, slipId, lines, advances }: {
  action: Action; slipId: string; lines: SlipLine[];
  advances: { id: string; advance_no: string; outstanding: string }[];
}) {
  const { onSubmit, pending, alert } = useForm(action);
  const one = (k: string) => lines.find((l) => l.kind === k);
  const [allow, setAllow] = useState(lines.filter((l) => l.kind === "ALLOWANCE").map((l) => ({ label: l.label, amount: l.amount })));
  const [tot, setTot] = useState({ gross: 0, ded: 0 });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (ref.current) recalc(ref.current); }, [allow.length]);
  const recalc = (f: HTMLFormElement) => {
    const fd = new FormData(f), k = fd.getAll("kind").map(String), a = fd.getAll("amount").map((x) => Number(String(x).replace(/,/g, "")) || 0);
    const earn = new Set(["BASIC", "ALLOWANCE", "OVERTIME", "COMMISSION", "BONUS", "OTHER_EARNING"]);
    setTot({ gross: k.reduce((t, x, i) => t + (earn.has(x) ? a[i] : 0), 0), ded: k.reduce((t, x, i) => t + (earn.has(x) ? 0 : a[i]), 0) });
  };
  const n = (s?: string) => (s ? String(Number(s)) : "");
  const row = (kind: string, text: React.ReactNode, amt: string, extra?: { label?: string; editLabel?: boolean; advance?: string; max?: string }) => (
    <tr key={kind + (extra?.advance ?? "") + (extra?.label ?? "")}>
      <td>{extra?.editLabel
        ? <input name="label" defaultValue={extra.label} aria-label="Description"
          placeholder={kind === "ALLOWANCE" ? "Allowance name" : kind === "OTHER_EARNING" ? "Other earning: describe" : "Other deduction: describe"} />
        : <><input type="hidden" name="label" value={extra?.label ?? ""} />{text}</>}
        <input type="hidden" name="kind" value={kind} /><input type="hidden" name="advance_id" value={extra?.advance ?? ""} /></td>
      <td className="r"><input name="amount" defaultValue={amt} inputMode="decimal" placeholder={extra?.max ? `up to ${Number(extra.max).toLocaleString("en-US")}` : "0"} aria-label="Amount" /></td>
    </tr>
  );
  const fmt = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (
    <form onSubmit={onSubmit} className="fas-form" onInput={(e) => recalc(e.currentTarget)} ref={ref}>
      <input type="hidden" name="slip_id" value={slipId} />
      {alert}
      <div className="fa-grid">
        <table className="ie-table">
          <thead><tr><th>Earnings</th><th className="r">MMK</th></tr></thead>
          <tbody>
            {row("BASIC", "Basic salary", n(one("BASIC")?.amount))}
            {allow.map((a, i) => row("ALLOWANCE", null, n(a.amount), { label: a.label, editLabel: true }))}
            {EARN_KINDS.slice(1).map(([k, t]) => row(k, t, n(one(k)?.amount)))}
            {row("OTHER_EARNING", null, n(one("OTHER_EARNING")?.amount), { label: one("OTHER_EARNING")?.label ?? "", editLabel: true })}
          </tbody>
          <tfoot><tr><th>Gross pay</th><th className="r">{fmt(tot.gross)}</th></tr></tfoot>
        </table>
        <table className="ie-table">
          <thead><tr><th>Deductions</th><th className="r">MMK</th></tr></thead>
          <tbody>
            {advances.map((a) => row("ADVANCE", `Advance ${a.advance_no}`, n(lines.find((l) => l.advance_id === a.id)?.amount),
              { label: `Advance ${a.advance_no}`, advance: a.id, max: a.outstanding }))}
            {DED_KINDS.map(([k, t]) => row(k, t, n(one(k)?.amount)))}
            {row("OTHER_DEDUCTION", null, n(one("OTHER_DEDUCTION")?.amount), { label: one("OTHER_DEDUCTION")?.label ?? "", editLabel: true })}
          </tbody>
          <tfoot>
            <tr><th>Total deductions</th><th className="r">{fmt(tot.ded)}</th></tr>
            <tr><th>Net pay</th><th className="r" style={{ color: tot.gross - tot.ded < 0 ? "var(--bad)" : undefined }}>{fmt(tot.gross - tot.ded)}</th></tr>
          </tfoot>
        </table>
      </div>
      <p className="ie-note">Tax and contributions are entered by hand; MTK does not calculate them. An advance can be recovered up to what is outstanding.</p>
      <div className="fa-head-actions">
        <button type="button" className="ie-btn" onClick={() => setAllow([...allow, { label: "", amount: "" }])}><Plus size={14} aria-hidden="true" /> Add allowance</button>
        <button className="ie-btn primary" disabled={pending}>{pending ? "Saving…" : "Save payslip"}</button>
      </div>
    </form>
  );
}

export function PostRunForm({ action, runId }: { action: Action; runId: string }) {
  const { onSubmit, pending, alert } = useForm(action, undefined, "Post this payroll to the ledger? Payslips are then fixed.");
  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="run_id" value={runId} />{alert}
      <button className="ie-btn primary" disabled={pending}>{pending ? "Posting…" : "Post payroll"}</button>
    </form>
  );
}

/** Pays the run. Ticked payslips (the checkboxes in the table, form="hr-pay") or, with none ticked, all that is unpaid. */
export function PayForm({ action, runId, money, today, due }: { action: Action; runId: string; money: Opt[]; today: string; due: string }) {
  const { onSubmit, pending, alert } = useForm(action);
  return (
    <form id="hr-pay" onSubmit={onSubmit} className="fas-form">
      <Key /><input type="hidden" name="run_id" value={runId} />
      {alert}
      <label className="ie-field"><span>Payment date</span><input type="date" name="date" defaultValue={today} required /></label>
      <label className="ie-field"><span>Paid from</span><Pick name="money_account_id" list={money} required /></label>
      <p className="ie-note">Pays the payslips ticked in the table, in full, or with none ticked everything unpaid ({due} MMK), as one voucher.</p>
      <div><button className="ie-btn primary" disabled={pending}>{pending ? "Posting…" : "Record payment"}</button></div>
    </form>
  );
}

export function ReverseRunForm({ action, runId }: { action: Action; runId: string }) {
  const { onSubmit, pending, alert } = useForm(action, undefined, "Reverse this payroll? Its journal is voided and its advance recoveries stop counting.");
  return (
    <form onSubmit={onSubmit} className="fas-form">
      <input type="hidden" name="run_id" value={runId} />{alert}
      <label className="ie-field"><span>Reason</span><input name="reason" required /></label>
      <div><button className="ie-btn" disabled={pending}>{pending ? "Reversing…" : "Reverse payroll"}</button></div>
    </form>
  );
}

// ------------------------------------------------------------- settings --

const SETTINGS: [string, string, string][] = [
  ["advance_account_id", "Employee Salary Advance", "asset"], ["payable_account_id", "Salary Payable", "liability"],
  ["basic_account_id", "Basic salary expense", "expense"], ["allowance_account_id", "Allowances expense", "expense"],
  ["overtime_account_id", "Overtime expense", "expense"], ["commission_account_id", "Commission expense", "expense"],
  ["bonus_account_id", "Bonus expense", "expense"], ["other_earning_account_id", "Other earnings expense", "expense"],
  ["tax_account_id", "Income tax withheld (payable)", "liability"], ["statutory_account_id", "Employee contributions (payable)", "liability"],
  ["other_deduction_account_id", "Other deductions", "any"],
];

export function HrSettingsForm({ action, value, accounts }: {
  action: Action; value: Record<string, string | null>; accounts: (Opt & { type: string })[];
}) {
  const { onSubmit, pending, alert } = useForm(action, "Settings saved.");
  const of = (t: string) => accounts.filter((a) => t === "any" ? a.type !== "EXPENSE" : a.type === t.toUpperCase());
  return (
    <form onSubmit={onSubmit} className="fas-form">
      {alert}
      <div className="ie-grid3">
        {SETTINGS.map(([k, l, t]) => (
          <label key={k} className="ie-field"><span>{l}</span><Pick name={k} list={of(t)} value={value[k]} empty="Not set" /></label>
        ))}
      </div>
      <p className="ie-note">Payroll runs monthly. Accounts are chosen from your chart; none are created. A payroll will not post while an account it needs is not set.</p>
      <div><button className="ie-btn primary" disabled={pending}>{pending ? "Saving…" : "Save settings"}</button></div>
    </form>
  );
}

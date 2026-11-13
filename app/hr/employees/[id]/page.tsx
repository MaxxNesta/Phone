import { todayLocal } from "@/lib/format";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, HandCoins, Wallet, FileText, CalendarDays } from "lucide-react";
import { requirePermission, can } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { employee, salaryHistory, advanceList, slipList, advanceState, ADVANCE_STATE, EMPLOYEE_STATUS, RECOVERY_LABEL } from "@/lib/hr";
import { kyat } from "@/lib/hr-calc";
import { saveSalary } from "@/lib/hr-actions";
import { SalaryForm } from "@/components/hr-forms";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { KpiCard } from "@/components/kpi-card";

export const metadata = { title: "Employee" };

/** One employee: profile, salary settings and their history, advances, payslips. Pay is shown only to those who may see it. */
export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("hr.employees.view");
  const co = user.companyId;
  const seen = await seenLocations();
  const e = await employee(co, (await params).id);
  if (!e || (seen && !seen.includes(e.branch_id))) notFound();
  const pay = can(user, "hr.salary.view"), adv = can(user, "hr.advances");
  const [salaries, advances, slips] = await Promise.all([
    pay ? salaryHistory(e.id) : [], adv ? advanceList(co, seen, e.id) : [], pay ? slipList(co, seen, { employeeId: e.id }) : []]);
  const current = salaries.find((s) => s.effective_from <= todayLocal()) ?? null;
  const outstanding = advances.filter((a) => a.doc_status === "POSTED").reduce((t, a) => t + Number(a.outstanding), 0);
  const today = todayLocal();

  return (
    <div className="fa">
      <Breadcrumbs trail={[{ label: "HR & Payroll", href: "/hr" }, { label: "Employees", href: "/hr/employees" }, { label: e.code }]} />
      <div className="fa-head">
        <div>
          <h1>{e.full_name} <span className={`fa-status ${e.status.toLowerCase()}`}>{EMPLOYEE_STATUS[e.status]}</span></h1>
          <p>{e.code} · {[e.position, e.department, e.branch].filter(Boolean).join(" · ")}</p>
        </div>
        <span className="fa-head-actions">
          {adv && e.status === "ACTIVE" && <Link className="ie-btn" href={`/hr/advances/new?employee=${e.id}`}><HandCoins size={14} aria-hidden="true" /> New advance</Link>}
          {can(user, "hr.employees.edit") && <Link className="ie-btn" href={`/hr/employees/${e.id}/edit`}><Pencil size={14} aria-hidden="true" /> Edit</Link>}
        </span>
      </div>

      {(pay || adv) && (
        <div className="kpis kpis-tiled kpis-compact fa-kpis">
          {pay && <KpiCard icon={<Wallet size={16} aria-hidden="true" />} label="Basic salary" value={current ? kyat(current.basic) : "—"} unit={current ? "MMK" : undefined}
            hint={current ? `Monthly, from ${current.effective_from}.` : "No salary settings yet."} />}
          {pay && <KpiCard icon={<CalendarDays size={16} aria-hidden="true" />} label="Allowances" value={current ? kyat(current.allowances.reduce((t, a) => t + Number(a.amount), 0)) : "—"} unit={current ? "MMK" : undefined}
            hint="Recurring allowances in the current settings." />}
          {adv && <KpiCard icon={<HandCoins size={16} aria-hidden="true" />} label="Advance outstanding" value={kyat(outstanding)} unit="MMK" tone={outstanding > 0 ? "warn" : undefined}
            hint="Advances paid less what payrolls and repayments have recovered." />}
          {pay && <KpiCard icon={<FileText size={16} aria-hidden="true" />} label="Payslips" value={slips.length} hint="Draft and posted payslips." />}
        </div>
      )}

      <div className="fa-grid wide-left">
        <div className="fa-side">
          {pay && (
            <section className="card fa-panel">
              <div className="fa-panel-head"><h2>Salary settings</h2><span className="fa-muted">Monthly</span></div>
              {salaries.length === 0 ? <p className="fa-muted">No salary settings yet. This employee is left out of payroll until they have some.</p> : (
                <table className="ie-table">
                  <thead><tr><th>From</th><th className="r">Basic</th><th>Allowances</th><th>Notes</th></tr></thead>
                  <tbody>{salaries.map((s) => (
                    <tr key={s.id}>
                      <td className="nowrap">{s.effective_from}{s === current && <span className="fa-pill ready" style={{ marginLeft: 6 }}>Current</span>}</td>
                      <td className="r">{kyat(s.basic)}</td>
                      <td>{s.allowances.length ? s.allowances.map((a) => `${a.name} ${kyat(a.amount)}`).join(" · ") : "—"}</td>
                      <td>{s.notes ?? "—"}</td>
                    </tr>))}</tbody>
                </table>
              )}
              {can(user, "hr.salary.edit") && (
                <details style={{ marginTop: "var(--s2)" }}>
                  <summary className="ie-link">Change salary settings</summary>
                  <SalaryForm action={saveSalary} employeeId={e.id} today={today} latest={salaries[0] ?? null} />
                </details>
              )}
            </section>
          )}

          {adv && (
            <section className="card fa-panel">
              <div className="fa-panel-head"><h2>Salary advances</h2></div>
              {advances.length === 0 ? <p className="fa-muted">No advances.</p> : (
                <table className="ie-table">
                  <thead><tr><th>Advance</th><th>Date</th><th>Recovery</th><th className="r">Amount</th><th className="r">Outstanding</th><th>Status</th></tr></thead>
                  <tbody>{advances.map((a) => {
                    const [l, c] = ADVANCE_STATE[advanceState(a)];
                    return (
                      <tr key={a.id}>
                        <td><Link href={`/hr/advances/${a.id}`} className="fa-jlink">{a.advance_no}</Link></td>
                        <td className="nowrap">{a.advance_date}</td>
                        <td>{RECOVERY_LABEL[a.recovery_method]}</td>
                        <td className="r">{kyat(a.amount)}</td>
                        <td className="r"><strong>{kyat(a.outstanding)}</strong></td>
                        <td><span className={c}>{l}</span></td>
                      </tr>);
                  })}</tbody>
                </table>
              )}
            </section>
          )}

          {pay && (
            <section className="card fa-panel">
              <div className="fa-panel-head"><h2>Payslips</h2></div>
              {slips.length === 0 ? <p className="fa-muted">No payslips yet.</p> : (
                <table className="ie-table">
                  <thead><tr><th>Payroll</th><th>Period</th><th className="r">Gross</th><th className="r">Net</th><th className="r">Paid</th><th /></tr></thead>
                  <tbody>{slips.map((s) => (
                    <tr key={s.id}>
                      <td>{s.run_no}{s.run_status === "DRAFT" ? <span className="fa-muted"> · draft</span> : s.journal_status !== "POSTED" ? <span className="fa-muted"> · reversed</span> : null}</td>
                      <td className="nowrap">{s.period_start} – {s.period_end}</td>
                      <td className="r">{kyat(s.gross)}</td>
                      <td className="r"><strong>{kyat(s.net)}</strong></td>
                      <td className="r">{kyat(s.paid)}</td>
                      <td><Link href={`/hr/payslips/${s.id}`} className="fa-jlink">Payslip</Link></td>
                    </tr>))}</tbody>
                </table>
              )}
            </section>
          )}
        </div>

        <div className="fa-side">
          <section className="card fa-panel">
            <div className="fa-panel-head"><h2>Details</h2></div>
            <dl className="fad-facts">
              <div><dt>Employee ID</dt><dd>{e.code}</dd></div>
              <div><dt>Phone</dt><dd>{e.phone ?? "—"}</dd></div>
              <div><dt>Branch</dt><dd>{e.branch}</dd></div>
              <div><dt>Department</dt><dd>{e.department ?? "—"}</dd></div>
              <div><dt>Position</dt><dd>{e.position ?? "—"}</dd></div>
              <div><dt>Joined</dt><dd>{e.joined_on ?? "—"}</dd></div>
              <div><dt>Paid by</dt><dd>{e.pay_method === "BANK" ? "Bank transfer" : "Cash"}</dd></div>
              {pay && e.pay_method === "BANK" && <div><dt>Bank</dt><dd>{[e.bank_name, e.bank_account_name, e.bank_account_no].filter(Boolean).join(" · ") || "—"}</dd></div>}
              <div><dt>Linked login</dt><dd>{e.login ?? "None"}</dd></div>
            </dl>
          </section>
          {e.notes && (
            <section className="card fa-panel">
              <div className="fa-panel-head"><h2>Notes</h2></div>
              <p className="fad-notes-text">{e.notes}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

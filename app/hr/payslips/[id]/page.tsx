import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { sql } from "@/lib/db";
import { slip, openAdvances } from "@/lib/hr";
import { kyat, isEarning } from "@/lib/hr-calc";
import { saveSlipAction } from "@/lib/hr-actions";
import { SlipForm } from "@/components/hr-forms";
import { PrintButton } from "@/components/print-button";
import { Breadcrumbs } from "@/components/breadcrumbs";

export const metadata = { title: "Payslip" };

/** A payslip: editable while its run is a draft, then a printable record. No public link: it needs salaries permission and the branch. */
export default async function PayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("hr.salary.view");
  const co = user.companyId;
  const s = await slip(co, (await params).id);
  const seen = await seenLocations();
  if (!s || (seen && !seen.includes(s.branch_id))) notFound();
  const draft = s.run_status === "DRAFT";
  const [[company], [branch]] = await Promise.all([
    sql`select name from company where id = ${co}`, sql`select name from location where id = ${s.branch_id}`]);
  const editable = draft && can(user, "hr.payroll.prepare");
  // Open advances plus any this draft already recovers from, with what is outstanding.
  const advances = editable ? await openAdvances([s.employee_id]) : [];
  const earnings = s.lines.filter((l) => isEarning(l.kind)), deductions = s.lines.filter((l) => !isEarning(l.kind));
  const status = draft ? "Draft" : s.journal_status !== "POSTED" ? "Reversed"
    : Number(s.paid) >= Number(s.net) ? "Paid" : Number(s.paid) > 0 ? `Partially paid (${kyat(s.paid)})` : "Unpaid";

  return (
    <div className="fa">
      <div className="noprint"><Breadcrumbs trail={[{ label: "HR & Payroll", href: "/hr" }, { label: "Payroll", href: "/hr/payroll" },
        { label: s.run_no, href: `/hr/payroll/${s.run_id}` }, { label: s.employee_code }]} /></div>
      <div className="fa-head">
        <div>
          <h1>Payslip · {s.employee_name}</h1>
          <p>{company.name} · {s.run_no} · {s.period_start} to {s.period_end}</p>
        </div>
        {!draft && <span className="fa-head-actions noprint"><PrintButton /></span>}
      </div>

      {editable ? (
        <section className="card fa-panel">
          <SlipForm action={saveSlipAction} slipId={s.id}
            lines={s.lines.map((l) => ({ kind: l.kind, label: l.label, amount: l.amount, advance_id: l.advance_id }))}
            advances={advances.map((a) => ({ id: a.id, advance_no: a.advance_no, outstanding: a.outstanding }))} />
        </section>
      ) : (
        <div className="fa-grid wide-left">
          <section className="card fa-panel">
            <table className="ie-table">
              <thead><tr><th>Earnings</th><th className="r">MMK</th></tr></thead>
              <tbody>{earnings.map((l, i) => <tr key={i}><td>{l.label}</td><td className="r">{kyat(l.amount)}</td></tr>)}</tbody>
              <tfoot><tr><th>Gross pay</th><th className="r">{kyat(s.gross)}</th></tr></tfoot>
            </table>
            <table className="ie-table" style={{ marginTop: "var(--s3)" }}>
              <thead><tr><th>Deductions</th><th className="r">MMK</th></tr></thead>
              <tbody>{deductions.length ? deductions.map((l, i) => <tr key={i}><td>{l.label}</td><td className="r">{kyat(l.amount)}</td></tr>)
                : <tr><td className="fa-muted">None</td><td /></tr>}</tbody>
              <tfoot>
                <tr><th>Total deductions</th><th className="r">{kyat(s.deductions)}</th></tr>
                <tr><th>Net pay</th><th className="r">{kyat(s.net)}</th></tr>
              </tfoot>
            </table>
          </section>
          <div className="fa-side">
            <section className="card fa-panel">
              <div className="fa-panel-head"><h2>Employee</h2></div>
              <dl className="fad-facts">
                <div><dt>Name</dt><dd>{s.employee_name}</dd></div>
                <div><dt>Employee ID</dt><dd>{s.employee_code}</dd></div>
                <div><dt>Branch</dt><dd>{branch.name}</dd></div>
                <div><dt>Position</dt><dd>{s.position ?? "—"}</dd></div>
                <div><dt>Period</dt><dd>{s.period_start} to {s.period_end}</dd></div>
                <div><dt>Payment</dt><dd>{status}</dd></div>
              </dl>
            </section>
          </div>
        </div>
      )}
      {draft && !editable && <p className="fa-muted">This payroll is still a draft.</p>}
      <p className="noprint"><Link href={`/hr/payroll/${s.run_id}`} className="fa-jlink">Back to {s.run_no}</Link></p>
    </div>
  );
}

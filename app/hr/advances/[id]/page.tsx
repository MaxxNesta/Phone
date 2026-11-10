import Link from "next/link";
import { notFound } from "next/navigation";
import { HandCoins, Undo2, Hourglass } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { sql } from "@/lib/db";
import { advanceHistory, advanceState, moneyAccounts, ADVANCE_STATE, RECOVERY_LABEL, type AdvanceRow } from "@/lib/hr";
import { kyat } from "@/lib/hr-calc";
import { repayAdvanceAction } from "@/lib/hr-actions";
import { RepayForm } from "@/components/hr-forms";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { KpiCard } from "@/components/kpi-card";

export const metadata = { title: "Salary advance" };

/** One advance: what was paid, what has come back and how, and a cash or bank repayment. */
export default async function AdvancePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("hr.advances");
  const co = user.companyId;
  const id = (await params).id;
  const [a] = (await sql`
    select a.id, a.advance_no, a.employee_id, a.employee_code, a.employee_name, a.branch_id, l.name as branch,
           to_char(a.advance_date, 'YYYY-MM-DD') as advance_date, a.amount::text, a.recovered::text, a.repaid::text, a.outstanding::text,
           a.recovery_method, a.recovery_amount::text, to_char(a.first_period, 'YYYY-MM') as first_period, a.reference, a.note,
           a.document_id, a.doc_no, a.doc_status
      from v_hr_advance a join location l on l.id = a.branch_id where a.id = ${id} and a.company_id = ${co}`) as unknown as AdvanceRow[];
  const seen = await seenLocations();
  if (!a || (seen && !seen.includes(a.branch_id))) notFound();
  const [history, money] = await Promise.all([advanceHistory(a.id), moneyAccounts(co)]);
  const state = advanceState(a);
  const [label, cls] = ADVANCE_STATE[state];

  return (
    <div className="fa">
      <Breadcrumbs trail={[{ label: "HR & Payroll", href: "/hr" }, { label: "Salary Advances", href: "/hr/advances" }, { label: a.advance_no }]} />
      <div className="fa-head">
        <div>
          <h1>{a.advance_no} <span className={cls}>{label}</span></h1>
          <p><Link href={`/hr/employees/${a.employee_id}`} className="fa-jlink">{a.employee_code}</Link> {a.employee_name} · {a.branch}</p>
        </div>
      </div>

      <div className="kpis kpis-tiled kpis-compact fa-kpis">
        <KpiCard icon={<HandCoins size={16} aria-hidden="true" />} label="Paid" value={kyat(a.amount)} unit="MMK" hint={`On ${a.advance_date}, voucher ${a.doc_no}.`} />
        <KpiCard icon={<Undo2 size={16} aria-hidden="true" />} label="Recovered" value={kyat(Number(a.recovered) + Number(a.repaid))} unit="MMK"
          hint={`${kyat(a.recovered)} through payroll, ${kyat(a.repaid)} repaid.`} />
        <KpiCard icon={<Hourglass size={16} aria-hidden="true" />} label="Outstanding" value={kyat(a.outstanding)} unit="MMK" tone={state === "OPEN" || state === "PARTIAL" ? "warn" : undefined}
          hint="What the employee still owes." />
      </div>

      <div className="fa-grid wide-left">
        <section className="card fa-panel">
          <div className="fa-panel-head"><h2>Recovery history</h2></div>
          {history.length === 0 ? <p className="fa-muted">Nothing recovered yet.</p> : (
            <table className="ie-table">
              <thead><tr><th>Date</th><th>How</th><th>Voucher</th><th className="r">Amount</th><th>Status</th></tr></thead>
              <tbody>{history.map((h, i) => (
                <tr key={i}>
                  <td className="nowrap">{h.date}</td>
                  <td>{h.how === "PAYROLL" ? <>Payroll <Link href={`/hr/payroll/${h.run_id}`} className="fa-jlink">{h.ref}</Link></> : "Repaid"}</td>
                  <td><Link href={`/documents/${h.doc_id}`} className="fa-jlink">{h.doc_no}</Link></td>
                  <td className="r">{kyat(h.amount)}</td>
                  <td><span className={h.doc_status === "POSTED" ? "fa-pill posted" : "fa-pill exception"}>{h.doc_status === "POSTED" ? "Counted" : "Voided"}</span></td>
                </tr>))}</tbody>
            </table>
          )}
        </section>

        <div className="fa-side">
          <section className="card fa-panel">
            <div className="fa-panel-head"><h2>Details</h2></div>
            <dl className="fad-facts">
              <div><dt>Date</dt><dd>{a.advance_date}</dd></div>
              <div><dt>Voucher</dt><dd><Link href={`/documents/${a.document_id}`} className="fa-jlink">{a.doc_no}</Link></dd></div>
              <div><dt>Recovery</dt><dd>{RECOVERY_LABEL[a.recovery_method]}{a.recovery_amount ? ` · ${kyat(a.recovery_amount)} each` : ""}</dd></div>
              <div><dt>From payroll</dt><dd>{a.first_period}</dd></div>
              {a.reference && <div><dt>Reference</dt><dd>{a.reference}</dd></div>}
              {a.note && <div><dt>Note</dt><dd>{a.note}</dd></div>}
            </dl>
          </section>
          {(state === "OPEN" || state === "PARTIAL") && (
            <section className="card fa-panel">
              <div className="fa-panel-head"><h2>Repay in cash or by bank</h2></div>
              <RepayForm action={repayAdvanceAction} advanceId={a.id} money={money} today={new Date().toISOString().slice(0, 10)} outstanding={kyat(a.outstanding)} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

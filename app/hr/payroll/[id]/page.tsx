import Link from "next/link";
import { notFound } from "next/navigation";
import { Users, Wallet, MinusCircle, Hourglass, Trash2 } from "lucide-react";
import { requireUser, can } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { sql } from "@/lib/db";
import { toUnits } from "@/lib/fa-engine";
import { run, runState, slipList, hrSettings, moneyAccounts, runJournalLines, runPayments, RUN_STATE_LABEL, RUN_STATE_CLASS } from "@/lib/hr";
import { kyat, runJournal, type Kind } from "@/lib/hr-calc";
import { postRunAction, payRunAction, reverseRunAction, discardRunAction, removeSlipAction } from "@/lib/hr-actions";
import { PostRunForm, PayForm, ReverseRunForm } from "@/components/hr-forms";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { KpiCard } from "@/components/kpi-card";

export const metadata = { title: "Payroll" };

/**
 * One run. Per-person pay only with salaries permission; the journal only
 * with payroll accounting. A draft shows the journal it would post.
 */
export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const pay = can(user, "hr.salary.view"), acct = can(user, "hr.payroll.accounting"), prep = can(user, "hr.payroll.prepare");
  if (!pay && !acct && !prep) notFound();
  const co = user.companyId;
  const seen = await seenLocations();
  const r = await run(co, (await params).id);
  if (!r || (seen && !seen.includes(r.branch_id))) notFound();
  const state = runState(r);
  const draft = state === "DRAFT", live = ["POSTED", "PARTIAL", "PAID"].includes(state);
  const unpaid = Number(r.net) - Number(r.paid);
  // A run of one is that person's pay: without salaries permission its figures stay hidden.
  const masked = r.staff === 1 && !pay;

  const [slips, payments, money, journal] = await Promise.all([
    pay ? slipList(co, seen, { runId: r.id }) : [],
    !draft && (acct || pay || can(user, "hr.payroll.pay")) ? runPayments(r.id) : [],
    live && unpaid > 0 && can(user, "hr.payroll.pay") ? moneyAccounts(co) : [],
    acct && !masked ? (r.document_id ? runJournalLines(r.document_id).then((lines) => ({ missing: [] as string[], lines })) : draftJournal(co, r.id)) : null,
  ]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="fa">
      <Breadcrumbs trail={[{ label: "HR & Payroll", href: "/hr" }, { label: "Payroll", href: "/hr/payroll" }, { label: r.run_no }]} />
      <div className="fa-head">
        <div>
          <h1>{r.run_no} <span className={RUN_STATE_CLASS[state]}>{RUN_STATE_LABEL[state]}</span></h1>
          <p>{r.kind === "REGULAR" ? "Regular" : "Supplementary"} · {r.period_start} to {r.period_end} · posting {r.posting_date} · {r.branch}</p>
        </div>
        {draft && (
          <span className="fa-head-actions">
            {prep && <form action={discardRunAction}><input type="hidden" name="run_id" value={r.id} /><button className="ie-btn"><Trash2 size={14} aria-hidden="true" /> Discard draft</button></form>}
            {can(user, "hr.payroll.post") && <PostRunForm action={postRunAction} runId={r.id} />}
          </span>
        )}
      </div>

      {masked && <div className="alert" role="note">This run pays one employee, so its totals are that person&apos;s pay. They are shown only to those who may see salaries.</div>}
      {!masked && <div className="kpis kpis-tiled kpis-compact fa-kpis">
        <KpiCard icon={<Users size={16} aria-hidden="true" />} label="Staff" value={r.staff} hint="Payslips on this run." />
        <KpiCard icon={<Wallet size={16} aria-hidden="true" />} label="Gross pay" value={kyat(r.gross)} unit="MMK" hint="Basic, allowances, overtime, commission, bonus and other earnings." />
        <KpiCard icon={<MinusCircle size={16} aria-hidden="true" />} label="Deductions" value={kyat(r.deductions)} unit="MMK" hint="Advance recoveries, tax, contributions and other deductions." />
        <KpiCard icon={<Hourglass size={16} aria-hidden="true" />} label={draft ? "Net pay" : "Unpaid"} value={kyat(draft ? r.net : unpaid)} unit="MMK" tone={live && unpaid > 0 ? "warn" : undefined}
          hint={draft ? "What staff will be owed once posted." : `Net pay ${kyat(r.net)}, paid ${kyat(r.paid)}.`} />
      </div>}

      <div className="fa-grid wide-left">
        <section className="card fa-panel">
          <div className="fa-panel-head"><h2>Payslips</h2>{draft && pay && <span className="fa-muted">Open a payslip to change it</span>}</div>
          {!pay ? <p className="fa-muted">Each person&apos;s pay is shown only to those who may see salaries.</p>
            : slips.length === 0 ? <p className="fa-muted">No one is on this run.</p> : (
            <table className="ie-table">
              <thead><tr>
                {live && unpaid > 0 && pay && can(user, "hr.payroll.pay") && <th aria-label="Pay separately" />}
                <th>Employee</th><th className="r">Gross</th><th className="r">Deductions</th><th className="r">Net</th>{!draft && <th className="r">Paid</th>}<th /></tr></thead>
              <tbody>{slips.map((s) => (
                <tr key={s.id}>
                  {live && unpaid > 0 && pay && can(user, "hr.payroll.pay") && <td>{Number(s.net) > Number(s.paid) &&
                    <input type="checkbox" name="slip_id" value={s.id} form="hr-pay" aria-label={`Pay ${s.employee_code} separately`} />}</td>}
                  <td><Link href={`/hr/employees/${s.employee_id}`} className="fa-jlink">{s.employee_code}</Link> {s.employee_name}</td>
                  <td className="r">{kyat(s.gross)}</td>
                  <td className="r">{kyat(s.deductions)}</td>
                  <td className="r"><strong>{kyat(s.net)}</strong></td>
                  {!draft && <td className="r">{kyat(s.paid)}</td>}
                  <td className="nowrap">
                    <Link href={`/hr/payslips/${s.id}`} className="fa-jlink">{draft ? "Edit" : "Payslip"}</Link>
                    {draft && prep && <form action={removeSlipAction} style={{ display: "inline", marginLeft: 8 }}>
                      <input type="hidden" name="slip_id" value={s.id} /><button className="linkish" aria-label={`Remove ${s.employee_code}`}>Remove</button></form>}
                  </td>
                </tr>))}</tbody>
            </table>
          )}
        </section>

        <div className="fa-side">
          {journal && (
            <section className="card fa-panel">
              <div className="fa-panel-head">
                <h2>{draft ? "Journal to post" : "Journal"}</h2>
                {r.document_id && (r.staff === 1 && !pay ? <span className="fa-muted">{r.doc_no} · restricted</span>
                  : <Link href={`/documents/${r.document_id}`} className="fa-jlink">{r.doc_no}</Link>)}
              </div>
              {journal.missing.length > 0 ? (
                <div className="alert" role="alert">Set these accounts in <Link href="/hr/settings">Settings</Link> before posting: {journal.missing.join(", ")}.</div>
              ) : (
                <table className="ie-table">
                  <thead><tr><th>Account</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
                  <tbody>{journal.lines.map((l) => (
                    <tr key={l.code}><td><span className="code">{l.code}</span> {l.name}</td><td className="r">{Number(l.debit) ? kyat(l.debit) : ""}</td><td className="r">{Number(l.credit) ? kyat(l.credit) : ""}</td></tr>))}
                  </tbody>
                </table>
              )}
              <p className="ie-note">One line per account at {r.branch}: the ledger carries payroll in total, never per person.</p>
            </section>
          )}

          {!draft && (payments.length > 0 || money.length > 0) && (
            <section className="card fa-panel">
              <div className="fa-panel-head"><h2>Salary payments</h2></div>
              {payments.length > 0 && (
                <table className="ie-table">
                  <thead><tr><th>Voucher</th><th>Date</th>{pay && <th className="r">Staff</th>}<th className="r">Amount</th></tr></thead>
                  <tbody>{payments.map((p) => (
                    <tr key={p.id}>
                      {/* An individual payment's voucher is one person's pay: opened by payroll users only. */}
                      <td>{p.individual && !pay ? <>{p.doc_no} <span className="fa-muted">· restricted</span></>
                        : <Link href={`/documents/${p.id}`} className="fa-jlink">{p.doc_no}</Link>}{p.status !== "POSTED" && <span className="fa-muted"> · voided</span>}</td>
                      <td className="nowrap">{p.date}</td>{pay && <td className="r">{p.staff}</td>}<td className="r">{p.individual && !pay ? "—" : kyat(p.amount)}</td>
                    </tr>))}</tbody>
                </table>
              )}
              {money.length > 0 && <PayForm action={payRunAction} runId={r.id} money={money} today={today} due={masked ? "restricted" : kyat(unpaid)} canSplit={pay} />}
            </section>
          )}

          {live && can(user, "hr.payroll.post") && (
            <section className="card fa-panel">
              <div className="fa-panel-head"><h2>Reverse</h2></div>
              <p className="fa-muted">Voids the journal. Salary payments must be voided first. Prepare a new run for the corrected pay.</p>
              <ReverseRunForm action={reverseRunAction} runId={r.id} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** What a draft would post, from the same arithmetic the posting uses. */
async function draftJournal(co: string, runId: string) {
  const [sums, s] = await Promise.all([
    sql`select l.kind, sum(l.amount)::text as amount from hr_payslip_line l join hr_payslip p on p.id = l.payslip_id
         where p.run_id = ${runId} group by l.kind`,
    hrSettings(co),
  ]);
  const j = runJournal(sums.map((x) => ({ kind: x.kind as Kind, amount: toUnits(x.amount) })), s, s.payable_account_id ?? null);
  if (j.missing.length) return { missing: j.missing, lines: [] };
  const names = await sql`select id, code, name from account where id = any(${j.lines.map((l) => l.accountId)})`;
  return {
    missing: [] as string[],
    lines: j.lines.map((l) => {
      const a = names.find((n) => n.id === l.accountId)!;
      const v = Number(l.amount) / 10_000;
      return { code: a.code as string, name: a.name as string, debit: String(Math.max(v, 0)), credit: String(Math.max(-v, 0)) };
    }),
  };
}

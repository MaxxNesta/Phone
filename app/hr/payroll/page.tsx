import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, FileClock, Wallet, Hourglass, Users } from "lucide-react";
import { HelpHint } from "@/components/help-hint";
import { requireUser, can } from "@/lib/auth";
import { seenLocations, seenBranches } from "@/lib/branch-scope";
import { faBranches } from "@/lib/fixed-assets";
import { runList, runState, RUN_STATE_LABEL, RUN_STATE_CLASS } from "@/lib/hr";
import { kyat } from "@/lib/hr-calc";
import { DataTable, type DataRow } from "@/components/data-table";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { KpiCard } from "@/components/kpi-card";

export const metadata = { title: "Payroll" };

/** Payroll runs: totals per run and branch only, so payroll accounting can open it without seeing anyone's pay. */
export default async function Payroll() {
  const user = await requireUser();
  if (!["hr.salary.view", "hr.payroll.accounting", "hr.payroll.prepare"].some((p) => can(user, p as never))) notFound();
  const co = user.companyId;
  const [rows, branches] = await Promise.all([runList(co, await seenLocations()), faBranches(co).then(seenBranches)]);
  const multiBranch = branches.length > 1;
  const states = rows.map((r) => runState(r));
  const live = rows.filter((_, i) => ["POSTED", "PARTIAL", "PAID"].includes(states[i]));
  const unpaid = live.reduce((t, r) => t + Number(r.net) - Number(r.paid), 0);
  const latest = live[0];

  const data: DataRow[] = rows.map((r, i) => {
    const s = states[i];
    return {
      key: r.id,
      searchText: [r.run_no, r.branch, r.doc_no, r.notes, r.period_start, r.period_end].filter(Boolean).join(" ").toLowerCase(),
      facet: { status: s, branch: r.branch_id, kind: r.kind },
      sort: { no: r.run_no, period: r.period_start, posting: r.posting_date, branch: r.branch, staff: r.staff, gross: Number(r.gross),
              deductions: Number(r.deductions), net: Number(r.net), paid: Number(r.paid), status: s },
      csv: { no: r.run_no, kind: r.kind === "REGULAR" ? "Regular" : "Supplementary", period: `${r.period_start} to ${r.period_end}`,
             posting: r.posting_date, branch: r.branch, staff: r.staff, gross: r.gross, deductions: r.deductions, net: r.net, paid: r.paid,
             journal: r.doc_no ?? "", status: RUN_STATE_LABEL[s] },
      node: (
        <tr key={r.id}>
          <td className="code"><Link href={`/hr/payroll/${r.id}`}>{r.run_no}</Link></td>
          <td>{r.kind === "REGULAR" ? "Regular" : "Supplementary"}</td>
          <td className="nowrap">{r.period_start} – {r.period_end}</td>
          <td className="nowrap">{r.posting_date}</td>
          {multiBranch && <td>{r.branch}</td>}
          <td className="r">{r.staff}</td>
          <td className="r">{kyat(r.gross)}</td>
          <td className="r">{kyat(r.deductions)}</td>
          <td className="r"><strong>{kyat(r.net)}</strong></td>
          <td className="r">{kyat(r.paid)}</td>
          <td>{r.doc_no ?? "—"}</td>
          <td><span className={RUN_STATE_CLASS[s]}>{RUN_STATE_LABEL[s]}</span></td>
        </tr>
      ),
    };
  });

  return (
    <div className="fa">
      <Breadcrumbs trail={[{ label: "HR & Payroll", href: "/hr" }, { label: "Payroll" }]} />
      <div className="fa-head">
        <div><h1>Payroll <HelpHint label="About Payroll">Monthly runs: prepared as a draft, posted as one journal per branch, then paid.</HelpHint></h1></div>
        {can(user, "hr.payroll.prepare") && <div className="fa-head-actions"><Link className="ie-btn primary" href="/hr/payroll/new"><Plus size={15} aria-hidden="true" /> New payroll</Link></div>}
      </div>

      <div className="kpis kpis-tiled kpis-compact fa-kpis">
        <KpiCard icon={<FileClock size={16} aria-hidden="true" />} label="Drafts" value={states.filter((s) => s === "DRAFT").length} hint="Prepared, not yet posted." />
        <KpiCard icon={<Hourglass size={16} aria-hidden="true" />} label="Unpaid net pay" value={kyat(unpaid)} unit="MMK" tone={unpaid > 0 ? "warn" : undefined}
          hint="Salary payable on posted runs not yet paid out." />
        <KpiCard icon={<Wallet size={16} aria-hidden="true" />} label="Latest net pay" value={latest ? kyat(latest.net) : "—"} unit={latest ? "MMK" : undefined}
          hint={latest ? `${latest.run_no}, ${latest.period_start} to ${latest.period_end}.` : "No posted run yet."} />
        <KpiCard icon={<Users size={16} aria-hidden="true" />} label="Staff on latest" value={latest ? latest.staff : "—"} hint="Payslips on the latest posted run." />
      </div>

      <section className="card">
        {rows.length === 0 ? (
          <div className="fa-empty">
            <strong>No payroll yet</strong>
            <span>Set the accounts in Settings, give employees salary settings, then prepare the month&apos;s payroll.</span>
            {can(user, "hr.payroll.prepare") && <Link className="ie-btn primary" href="/hr/payroll/new"><Plus size={15} aria-hidden="true" /> New payroll</Link>}
          </div>
        ) : (
          <DataTable
            rows={data}
            storageKey="hr-payroll"
            csvFilename="payroll-runs.csv"
            searchPlaceholder="Search run, branch, journal…"
            defaultSort={{ key: "period", dir: "desc" }}
            defaultHidden={["deductions", "journal"]}
            filters={[
              { key: "status", allLabel: "All statuses", label: "Status", options: Object.entries(RUN_STATE_LABEL).map(([k, l]) => ({ value: k, label: l })) },
              ...(multiBranch ? [{ key: "branch", allLabel: "All branches", label: "Branch", options: branches.map((b) => ({ value: b.id, label: b.name })) }] : []),
              { key: "kind", allLabel: "All kinds", label: "Kind", options: [{ value: "REGULAR", label: "Regular" }, { value: "SUPPLEMENTARY", label: "Supplementary" }] },
            ]}
            columns={[
              { key: "no", label: "Run", sortable: true },
              { key: "kind", label: "Kind" },
              { key: "period", label: "Period", sortable: true },
              { key: "posting", label: "Posting date", sortable: true },
              ...(multiBranch ? [{ key: "branch", label: "Branch", sortable: true }] : []),
              { key: "staff", label: "Staff", sortable: true, align: "r" as const },
              { key: "gross", label: "Gross (MMK)", sortable: true, align: "r" as const },
              { key: "deductions", label: "Deductions", sortable: true, align: "r" as const },
              { key: "net", label: "Net", sortable: true, align: "r" as const },
              { key: "paid", label: "Paid", sortable: true, align: "r" as const },
              { key: "journal", label: "Journal" },
              { key: "status", label: "Status", sortable: true },
            ]}
          />
        )}
      </section>
    </div>
  );
}

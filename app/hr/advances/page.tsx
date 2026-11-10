import Link from "next/link";
import { Plus, HandCoins, Hourglass, Undo2, Users } from "lucide-react";
import { HelpHint } from "@/components/help-hint";
import { requirePermission } from "@/lib/auth";
import { seenLocations, seenBranches } from "@/lib/branch-scope";
import { faBranches } from "@/lib/fixed-assets";
import { advanceList, advanceState, ADVANCE_STATE, RECOVERY_LABEL } from "@/lib/hr";
import { kyat } from "@/lib/hr-calc";
import { DataTable, type DataRow } from "@/components/data-table";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { KpiCard } from "@/components/kpi-card";

export const metadata = { title: "Salary Advances" };

export default async function Advances() {
  const user = await requirePermission("hr.advances");
  const co = user.companyId;
  const [rows, branches] = await Promise.all([advanceList(co, await seenLocations()), faBranches(co).then(seenBranches)]);
  const multiBranch = branches.length > 1;
  const live = rows.filter((r) => r.doc_status === "POSTED");
  const open = live.filter((r) => Number(r.outstanding) > 0);
  const sum = (k: "amount" | "outstanding" | "recovered" | "repaid", list = live) => list.reduce((t, r) => t + Number(r[k]), 0);

  const data: DataRow[] = rows.map((r) => {
    const state = advanceState(r);
    const [label, cls] = ADVANCE_STATE[state];
    return {
      key: r.id,
      searchText: [r.advance_no, r.employee_code, r.employee_name, r.reference, r.doc_no].filter(Boolean).join(" ").toLowerCase(),
      facet: { status: state, branch: r.branch_id, method: r.recovery_method },
      sort: { no: r.advance_no, date: r.advance_date, employee: r.employee_name, branch: r.branch, amount: Number(r.amount),
              recovered: Number(r.recovered) + Number(r.repaid), outstanding: Number(r.outstanding), status: state },
      csv: { no: r.advance_no, date: r.advance_date, employee: `${r.employee_code} ${r.employee_name}`, branch: r.branch,
             amount: r.amount, recovered: String(Number(r.recovered) + Number(r.repaid)), outstanding: r.outstanding,
             method: RECOVERY_LABEL[r.recovery_method], voucher: r.doc_no, status: label },
      node: (
        <tr key={r.id}>
          <td className="code"><Link href={`/hr/advances/${r.id}`}>{r.advance_no}</Link></td>
          <td className="nowrap">{r.advance_date}</td>
          <td className="wrap"><Link href={`/hr/employees/${r.employee_id}`} className="fa-jlink">{r.employee_code}</Link> {r.employee_name}</td>
          {multiBranch && <td>{r.branch}</td>}
          <td className="r">{kyat(r.amount)}</td>
          <td className="r">{kyat(Number(r.recovered) + Number(r.repaid))}</td>
          <td className="r"><strong>{kyat(r.outstanding)}</strong></td>
          <td>{RECOVERY_LABEL[r.recovery_method]}</td>
          <td>{r.doc_no}</td>
          <td><span className={cls}>{label}</span></td>
        </tr>
      ),
    };
  });

  return (
    <div className="fa">
      <Breadcrumbs trail={[{ label: "HR & Payroll", href: "/hr" }, { label: "Salary Advances" }]} />
      <div className="fa-head">
        <div><h1>Salary Advances <HelpHint label="About Salary Advances">Money paid to staff ahead of payday, recovered through payroll or repaid in cash.</HelpHint></h1></div>
        <div className="fa-head-actions"><Link className="ie-btn primary" href="/hr/advances/new"><Plus size={15} aria-hidden="true" /> New advance</Link></div>
      </div>

      <div className="kpis kpis-tiled kpis-compact fa-kpis">
        <KpiCard icon={<Hourglass size={16} aria-hidden="true" />} label="Outstanding" value={kyat(sum("outstanding"))} unit="MMK" tone={open.length ? "warn" : undefined}
          hint="Still owed by staff: advances paid less recoveries and repayments." />
        <KpiCard icon={<Users size={16} aria-hidden="true" />} label="Open advances" value={open.length} hint={`${new Set(open.map((r) => r.employee_id)).size} employees owe something.`} />
        <KpiCard icon={<HandCoins size={16} aria-hidden="true" />} label="Paid out" value={kyat(sum("amount"))} unit="MMK" hint="Every advance not voided." />
        <KpiCard icon={<Undo2 size={16} aria-hidden="true" />} label="Recovered" value={kyat(sum("recovered") + sum("repaid"))} unit="MMK" hint="Through posted payrolls and repayments." />
      </div>

      <section className="card">
        {rows.length === 0 ? (
          <div className="fa-empty">
            <strong>No salary advances</strong>
            <span>An advance is paid from a till or bank and recovered from later payrolls.</span>
            <Link className="ie-btn primary" href="/hr/advances/new"><Plus size={15} aria-hidden="true" /> New advance</Link>
          </div>
        ) : (
          <DataTable
            rows={data}
            storageKey="hr-advances"
            csvFilename="salary-advances.csv"
            searchPlaceholder="Search advance, employee, reference…"
            defaultSort={{ key: "date", dir: "desc" }}
            defaultHidden={["method", "voucher"]}
            filters={[
              { key: "status", allLabel: "All statuses", label: "Status", options: Object.entries(ADVANCE_STATE).map(([k, [l]]) => ({ value: k, label: l })) },
              ...(multiBranch ? [{ key: "branch", allLabel: "All branches", label: "Branch", options: branches.map((b) => ({ value: b.id, label: b.name })) }] : []),
              { key: "method", allLabel: "All recovery", label: "Recovery", options: Object.entries(RECOVERY_LABEL).map(([k, l]) => ({ value: k, label: l })) },
            ]}
            columns={[
              { key: "no", label: "Advance", sortable: true },
              { key: "date", label: "Date", sortable: true },
              { key: "employee", label: "Employee", sortable: true },
              ...(multiBranch ? [{ key: "branch", label: "Branch", sortable: true }] : []),
              { key: "amount", label: "Original (MMK)", sortable: true, align: "r" as const },
              { key: "recovered", label: "Recovered", sortable: true, align: "r" as const },
              { key: "outstanding", label: "Outstanding", sortable: true, align: "r" as const },
              { key: "method", label: "Recovery" },
              { key: "voucher", label: "Voucher" },
              { key: "status", label: "Status", sortable: true },
            ]}
          />
        )}
      </section>
    </div>
  );
}

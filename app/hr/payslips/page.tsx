import Link from "next/link";
import { FileText, Wallet, Hourglass } from "lucide-react";
import { HelpHint } from "@/components/help-hint";
import { requirePermission } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { slipList, type SlipRow } from "@/lib/hr";
import { kyat } from "@/lib/hr-calc";
import { DataTable, type DataRow } from "@/components/data-table";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { KpiCard } from "@/components/kpi-card";

export const metadata = { title: "Payslips" };

const STATE: Record<string, [string, string]> = {
  DRAFT: ["Draft", "fa-pill none"], UNPAID: ["Unpaid", "fa-pill due"], PARTIAL: ["Partially paid", "fa-pill partial"],
  PAID: ["Paid", "fa-pill posted"], REVERSED: ["Reversed", "fa-pill exception"],
};
const slipState = (s: SlipRow) => s.run_status === "DRAFT" ? "DRAFT" : s.journal_status !== "POSTED" ? "REVERSED"
  : Number(s.paid) >= Number(s.net) ? "PAID" : Number(s.paid) > 0 ? "PARTIAL" : "UNPAID";

export default async function Payslips() {
  const user = await requirePermission("hr.salary.view");
  const rows = await slipList(user.companyId, await seenLocations());
  const posted = rows.filter((s) => ["UNPAID", "PARTIAL", "PAID"].includes(slipState(s)));
  const runs = [...new Map(rows.map((r) => [r.run_id, r.run_no])).entries()];

  const data: DataRow[] = rows.map((s) => {
    const st = slipState(s);
    return {
      key: s.id,
      searchText: [s.run_no, s.employee_code, s.employee_name, s.position, s.department].filter(Boolean).join(" ").toLowerCase(),
      facet: { status: st, run: s.run_id },
      sort: { run: s.run_no, period: s.period_start, employee: s.employee_name, gross: Number(s.gross), deductions: Number(s.deductions),
              net: Number(s.net), paid: Number(s.paid), status: st },
      csv: { run: s.run_no, period: `${s.period_start} to ${s.period_end}`, employee: `${s.employee_code} ${s.employee_name}`,
             gross: s.gross, deductions: s.deductions, net: s.net, paid: s.paid, status: STATE[st][0] },
      node: (
        <tr key={s.id}>
          <td className="code"><Link href={`/hr/payslips/${s.id}`}>{s.run_no}</Link></td>
          <td className="nowrap">{s.period_start} – {s.period_end}</td>
          <td className="wrap"><Link href={`/hr/employees/${s.employee_id}`} className="fa-jlink">{s.employee_code}</Link> {s.employee_name}</td>
          <td className="r">{kyat(s.gross)}</td>
          <td className="r">{kyat(s.deductions)}</td>
          <td className="r"><strong>{kyat(s.net)}</strong></td>
          <td className="r">{kyat(s.paid)}</td>
          <td><span className={STATE[st][1]}>{STATE[st][0]}</span></td>
        </tr>
      ),
    };
  });

  return (
    <div className="fa">
      <Breadcrumbs trail={[{ label: "HR & Payroll", href: "/hr" }, { label: "Payslips" }]} />
      <div className="fa-head">
        <div><h1>Payslips <HelpHint label="About Payslips">One per employee per payroll run. Confidential: only those who may see salaries can open them.</HelpHint></h1></div>
      </div>
      <div className="kpis kpis-tiled kpis-compact fa-kpis">
        <KpiCard icon={<FileText size={16} aria-hidden="true" />} label="Posted payslips" value={posted.length} hint="On posted payroll runs." />
        <KpiCard icon={<Wallet size={16} aria-hidden="true" />} label="Net pay" value={kyat(posted.reduce((t, s) => t + Number(s.net), 0))} unit="MMK" hint="On posted payslips." />
        <KpiCard icon={<Hourglass size={16} aria-hidden="true" />} label="Unpaid" value={kyat(posted.reduce((t, s) => t + Number(s.net) - Number(s.paid), 0))} unit="MMK" hint="Net pay not yet paid out." />
      </div>
      <section className="card">
        {rows.length === 0 ? (
          <div className="fa-empty"><strong>No payslips yet</strong><span>Payslips are made when a payroll is prepared.</span></div>
        ) : (
          <DataTable
            rows={data}
            storageKey="hr-payslips"
            csvFilename="payslips.csv"
            searchPlaceholder="Search run, employee…"
            defaultSort={{ key: "period", dir: "desc" }}
            filters={[
              { key: "status", allLabel: "All statuses", label: "Status", options: Object.entries(STATE).map(([k, [l]]) => ({ value: k, label: l })) },
              { key: "run", allLabel: "All runs", label: "Run", options: runs.map(([id, no]) => ({ value: id, label: no })) },
            ]}
            columns={[
              { key: "run", label: "Run", sortable: true },
              { key: "period", label: "Period", sortable: true },
              { key: "employee", label: "Employee", sortable: true },
              { key: "gross", label: "Gross (MMK)", sortable: true, align: "r" as const },
              { key: "deductions", label: "Deductions", sortable: true, align: "r" as const },
              { key: "net", label: "Net", sortable: true, align: "r" as const },
              { key: "paid", label: "Paid", sortable: true, align: "r" as const },
              { key: "status", label: "Status", sortable: true },
            ]}
          />
        )}
      </section>
    </div>
  );
}

import Link from "next/link";
import { Plus, Users, UserCheck, Building2, Banknote } from "lucide-react";
import { HelpHint } from "@/components/help-hint";
import { requirePermission, can } from "@/lib/auth";
import { seenLocations, seenBranches } from "@/lib/branch-scope";
import { faBranches } from "@/lib/fixed-assets";
import { employeeList, EMPLOYEE_STATUS } from "@/lib/hr";
import { DataTable, type DataRow } from "@/components/data-table";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { KpiCard } from "@/components/kpi-card";

export const metadata = { title: "Employees" };

export default async function Employees() {
  const user = await requirePermission("hr.employees.view");
  const co = user.companyId;
  const [rows, branches] = await Promise.all([employeeList(co, await seenLocations()), faBranches(co).then(seenBranches)]);
  const canEdit = can(user, "hr.employees.edit");
  const multiBranch = branches.length > 1;
  const departments = [...new Set(rows.map((r) => r.department).filter(Boolean))].sort() as string[];
  const active = rows.filter((r) => r.status === "ACTIVE");

  const data: DataRow[] = rows.map((r) => ({
    key: r.id,
    searchText: [r.code, r.full_name, r.phone, r.department, r.position, r.branch].filter(Boolean).join(" ").toLowerCase(),
    facet: { status: r.status, branch: r.branch_id, department: r.department ?? "" },
    sort: { code: r.code, name: r.full_name, branch: r.branch, department: r.department ?? "", position: r.position ?? "",
            joined: r.joined_on ?? "", status: r.status },
    csv: { code: r.code, name: r.full_name, phone: r.phone ?? "", branch: r.branch, department: r.department ?? "",
           position: r.position ?? "", joined: r.joined_on ?? "", pay: r.pay_method === "BANK" ? "Bank" : "Cash",
           login: r.login ?? "", status: EMPLOYEE_STATUS[r.status] },
    node: (
      <tr key={r.id}>
        <td className="code"><Link href={`/hr/employees/${r.id}`}>{r.code}</Link></td>
        <td className="wrap"><strong className="fa-name">{r.full_name}</strong></td>
        <td>{r.phone ?? "—"}</td>
        {multiBranch && <td>{r.branch}</td>}
        <td>{r.department ?? "—"}</td>
        <td>{r.position ?? "—"}</td>
        <td className="nowrap">{r.joined_on ?? "—"}</td>
        <td>{r.pay_method === "BANK" ? "Bank" : "Cash"}</td>
        <td>{r.login ?? "—"}</td>
        <td><span className={`fa-status ${r.status.toLowerCase()}`}>{EMPLOYEE_STATUS[r.status]}</span></td>
      </tr>
    ),
  }));

  return (
    <div className="fa">
      <Breadcrumbs trail={[{ label: "HR & Payroll", href: "/hr" }, { label: "Employees" }]} />
      <div className="fa-head">
        <div><h1>Employees <HelpHint label="About Employees">People on the payroll. An employee is not a login and takes no seat; a login can be linked.</HelpHint></h1></div>
        {canEdit && <div className="fa-head-actions"><Link className="ie-btn primary" href="/hr/employees/new"><Plus size={15} aria-hidden="true" /> Add employee</Link></div>}
      </div>

      <div className="kpis kpis-tiled kpis-compact fa-kpis">
        <KpiCard icon={<Users size={16} aria-hidden="true" />} label="Employees" value={rows.length} hint="Everyone on the list, active or not." />
        <KpiCard icon={<UserCheck size={16} aria-hidden="true" />} label="Active" value={active.length} hint="Included when a payroll is prepared." />
        <KpiCard icon={<Building2 size={16} aria-hidden="true" />} label="Branches" value={new Set(active.map((r) => r.branch_id)).size} hint="Branches with active employees." />
        <KpiCard icon={<Banknote size={16} aria-hidden="true" />} label="Paid by bank" value={active.filter((r) => r.pay_method === "BANK").length} hint="Active employees paid by bank transfer; the rest in cash." />
      </div>

      <section className="card">
        {rows.length === 0 ? (
          <div className="fa-empty">
            <strong>No employees yet</strong>
            <span>Add the people you pay. Their salary settings come next, on their page.</span>
            {canEdit && <Link className="ie-btn primary" href="/hr/employees/new"><Plus size={15} aria-hidden="true" /> Add the first employee</Link>}
          </div>
        ) : (
          <DataTable
            rows={data}
            storageKey="hr-employees"
            csvFilename="employees.csv"
            searchPlaceholder="Search ID, name, phone, position…"
            defaultSort={{ key: "code", dir: "asc" }}
            defaultHidden={["pay", "login"]}
            filters={[
              { key: "status", allLabel: "All statuses", label: "Status", options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }] },
              ...(multiBranch ? [{ key: "branch", allLabel: "All branches", label: "Branch", options: branches.map((b) => ({ value: b.id, label: b.name })) }] : []),
              { key: "department", allLabel: "All departments", label: "Department", options: departments.map((d) => ({ value: d, label: d })) },
            ]}
            columns={[
              { key: "code", label: "ID", sortable: true },
              { key: "name", label: "Name", sortable: true },
              { key: "phone", label: "Phone" },
              ...(multiBranch ? [{ key: "branch", label: "Branch", sortable: true }] : []),
              { key: "department", label: "Department", sortable: true },
              { key: "position", label: "Position", sortable: true },
              { key: "joined", label: "Joined", sortable: true },
              { key: "pay", label: "Paid by" },
              { key: "login", label: "Login" },
              { key: "status", label: "Status", sortable: true },
            ]}
          />
        )}
      </section>
    </div>
  );
}

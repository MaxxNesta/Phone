import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { sql } from "@/lib/db";
import { seenBranches, seenLocations } from "@/lib/branch-scope";
import { faBranches } from "@/lib/fixed-assets";
import { employee } from "@/lib/hr";
import { saveEmployee } from "@/lib/hr-actions";
import { EmployeeForm } from "@/components/hr-forms";
import { Breadcrumbs } from "@/components/breadcrumbs";

export const metadata = { title: "Edit employee" };

export default async function EditEmployee({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("hr.employees.edit");
  const co = user.companyId;
  const e = await employee(co, (await params).id);
  const seen = await seenLocations();
  if (!e || (seen && !seen.includes(e.branch_id))) notFound();
  const showBank = can(user, "hr.salary.view");
  const [branches, logins] = await Promise.all([faBranches(co).then(seenBranches),
    sql`select id, name from app_user where company_id = ${co} and is_active order by name`]);
  return (
    <div className="fa">
      <Breadcrumbs trail={[{ label: "HR & Payroll", href: "/hr" }, { label: "Employees", href: "/hr/employees" }, { label: e.code, href: `/hr/employees/${e.id}` }, { label: "Edit" }]} />
      <EmployeeForm action={saveEmployee} branches={branches} logins={logins as never} showBank={showBank}
        value={showBank ? e : { ...e, bank_name: null, bank_account_name: null, bank_account_no: null }} />
    </div>
  );
}

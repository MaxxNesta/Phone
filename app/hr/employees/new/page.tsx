import { requirePermission, can } from "@/lib/auth";
import { sql } from "@/lib/db";
import { seenBranches } from "@/lib/branch-scope";
import { faBranches } from "@/lib/fixed-assets";
import { nextEmployeeCode } from "@/lib/hr";
import { saveEmployee } from "@/lib/hr-actions";
import { EmployeeForm } from "@/components/hr-forms";
import { Breadcrumbs } from "@/components/breadcrumbs";

export const metadata = { title: "Add employee" };

export default async function NewEmployee() {
  const user = await requirePermission("hr.employees.edit");
  const co = user.companyId;
  const [branches, code, logins] = await Promise.all([faBranches(co).then(seenBranches), nextEmployeeCode(co),
    sql`select id, name from app_user where company_id = ${co} and is_active order by name`]);
  return (
    <div className="fa">
      <Breadcrumbs trail={[{ label: "HR & Payroll", href: "/hr" }, { label: "Employees", href: "/hr/employees" }, { label: "Add employee" }]} />
      <EmployeeForm action={saveEmployee} branches={branches} logins={logins as never} showBank={can(user, "hr.salary.view")}
        value={{ code, full_name: "", phone: null, branch_id: branches.length === 1 ? branches[0].id : "", department: null, position: null,
                 joined_on: null, status: "ACTIVE", pay_method: "CASH", bank_name: null, bank_account_name: null, bank_account_no: null,
                 notes: null, user_id: null }} />
    </div>
  );
}

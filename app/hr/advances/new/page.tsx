import { requirePermission } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { employeeList, moneyAccounts } from "@/lib/hr";
import { createAdvanceAction } from "@/lib/hr-actions";
import { AdvanceForm } from "@/components/hr-forms";
import { Breadcrumbs } from "@/components/breadcrumbs";

export const metadata = { title: "New salary advance" };

export default async function NewAdvance({ searchParams }: { searchParams: Promise<{ employee?: string }> }) {
  const user = await requirePermission("hr.advances");
  const co = user.companyId;
  const [staff, money] = await Promise.all([employeeList(co, await seenLocations()), moneyAccounts(co)]);
  return (
    <div className="fa">
      <Breadcrumbs trail={[{ label: "HR & Payroll", href: "/hr" }, { label: "Salary Advances", href: "/hr/advances" }, { label: "New advance" }]} />
      <AdvanceForm action={createAdvanceAction} money={money} today={new Date().toISOString().slice(0, 10)}
        employeeId={(await searchParams).employee}
        employees={staff.filter((e) => e.status === "ACTIVE").map((e) => ({ id: e.id, code: e.code, name: e.full_name }))} />
    </div>
  );
}

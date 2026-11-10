import { requirePermission } from "@/lib/auth";
import { seenBranches } from "@/lib/branch-scope";
import { faBranches } from "@/lib/fixed-assets";
import { createRunAction } from "@/lib/hr-actions";
import { RunForm } from "@/components/hr-forms";
import { Breadcrumbs } from "@/components/breadcrumbs";

export const metadata = { title: "New payroll" };

export default async function NewPayroll() {
  const user = await requirePermission("hr.payroll.prepare");
  const branches = await faBranches(user.companyId).then(seenBranches);
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return (
    <div className="fa">
      <Breadcrumbs trail={[{ label: "HR & Payroll", href: "/hr" }, { label: "Payroll", href: "/hr/payroll" }, { label: "New payroll" }]} />
      <RunForm action={createRunAction} branches={branches}
        period={{ start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }} />
    </div>
  );
}

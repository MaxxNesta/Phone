import { redirect } from "next/navigation";
import { requireUser, can } from "@/lib/auth";

/** HR & Payroll has no overview: straight to the first list this person may open. */
export default async function Hr() {
  const u = await requireUser();
  if (can(u, "hr.employees.view")) redirect("/hr/employees");
  if (can(u, "hr.advances")) redirect("/hr/advances");
  redirect("/hr/payroll");
}

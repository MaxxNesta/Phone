import { requirePermission } from "@/lib/auth";
import { hrSettings, hrAccounts } from "@/lib/hr";
import { saveHrSettings } from "@/lib/hr-actions";
import { HrSettingsForm } from "@/components/hr-forms";
import { HelpHint } from "@/components/help-hint";
import { Breadcrumbs } from "@/components/breadcrumbs";

export const metadata = { title: "HR & Payroll Settings" };

export default async function HrSettings() {
  const user = await requirePermission("settings.manage");
  const co = user.companyId;
  const [value, accounts] = await Promise.all([hrSettings(co), hrAccounts(co)]);
  return (
    <div className="fa">
      <Breadcrumbs trail={[{ label: "HR & Payroll", href: "/hr" }, { label: "Settings" }]} />
      <div className="fa-head">
        <div><h1>Settings <HelpHint label="About payroll settings">Which accounts advances, payroll and withholdings post to.</HelpHint></h1></div>
      </div>
      <section className="card fa-panel">
        <div className="fa-panel-head"><h2>Accounts</h2></div>
        <HrSettingsForm action={saveHrSettings} value={value} accounts={accounts} />
      </section>
    </div>
  );
}

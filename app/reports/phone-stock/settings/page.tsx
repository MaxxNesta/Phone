import { requirePermission } from "@/lib/auth";
import { sql } from "@/lib/db";
import { agingSettings } from "@/lib/aging";
import { saveAgingSettings } from "@/lib/actions";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { AgingSettingsForm } from "@/components/aging-settings";

export const metadata = { title: "Inventory Aging Settings" };

export default async function AgingSettingsPage() {
  const user = await requirePermission("inventory.manage");
  const [s, groups] = await Promise.all([
    agingSettings(user.companyId),
    sql`select id, name from item_group where company_id = ${user.companyId} and parent_id is null order by name`,
  ]);
  return (
    <div className="ie">
      <Breadcrumbs trail={[{ label: "Inventory" }, { label: "Inventory Aging", href: "/reports/phone-stock" }, { label: "Settings" }]} />
      <header className="ie-title">
        <h1>Inventory Aging Settings</h1>
        <p>Customize the age limits for unsold stock, and separately how sales pace is judged.</p>
      </header>
      <AgingSettingsForm action={saveAgingSettings} rules={s.rules} pace={s.pace}
        groups={(groups as any[]).map((g) => ({ id: g.id, name: g.name, thresholds: s.byGroup.get(g.id) ?? null }))} />
    </div>
  );
}

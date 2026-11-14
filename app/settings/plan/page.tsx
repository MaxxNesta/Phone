import { sql } from "@/lib/db";
import { getCompany } from "@/lib/queries";
import { setCompanyPlan, setCompanyModules, setExtraUsers } from "@/lib/actions";
import { PLAN_LIMITS, PLAN_NAME, PLAN_ORDER, planSwitchable, MODULES, CORE_MODULES, STANDARD_UP_ADDONS, type Plan } from "@/lib/plans";
import { ModuleSwitcher } from "@/components/module-switcher";
import { SeatCard } from "@/components/seat-card";
import { PlanSwitcher } from "@/components/plan-switcher";
import { HelpHint } from "@/components/help-hint";

export default async function PlanSettings() {
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;

  const [row] = (await sql`select plan, package_seats, module_seats,
      (select coalesce(jsonb_object_agg(k, n), '{}') from (
         select case when seat = 'package' then coalesce(seat_plan, c.plan) else seat end as k, count(*)::int as n
           from app_user u where u.company_id = c.id and u.is_active and u.password_hash is not null group by 1) x) as used
      from company c where c.id = ${company.id}`) as
    unknown as { plan: Plan; package_seats: Record<string, number>; module_seats: Record<string, number>; used: Record<string, number> }[];
  const rank = PLAN_ORDER.indexOf(row.plan);

  // What this company actually holds, so a limit can be read against
  // something real rather than in the abstract.
  const [counts] = (await sql`
    select count(*) filter (where parent_id is null)::int as branches,
           count(*) filter (where is_stock_location)::int as warehouses
      from location where company_id = ${company.id} and is_active`) as
    unknown as { branches: number; warehouses: number }[];

  return (
    <>
      <div className="page-head hero">
        <span className="eyebrow">Settings · Account</span>
        <h1>Package</h1>
        <HelpHint>
          Which package this company is on, its add-ons and its seats. They are
          set by your provider and shown here for reference.
          <br /><br />
          Branches and warehouses are unlimited in every package. Each
          package includes one user; more people need user seats.
        </HelpHint>
        <p className="page-sub">What your package includes, and how much of it is in use.</p>
      </div>

      <PlanSwitcher
        current={row.plan}
        limits={PLAN_LIMITS}
        have={counts}
        locked={!planSwitchable}
        action={setCompanyPlan}
      />

      <ModuleSwitcher all={MODULES} current={company.modules ?? MODULES.map((m) => m.key)}
        core={CORE_MODULES} planName={PLAN_NAME[row.plan]}
        needsStandard={row.plan === "STARTER" ? STANDARD_UP_ADDONS : []}
        locked={!planSwitchable} action={setCompanyModules} />

      <SeatCard locked={!planSwitchable} action={setExtraUsers}
        packages={PLAN_ORDER.map((p, i) => ({
          key: p, name: `${PLAN_NAME[p]} seats`,
          included: p === row.plan ? (PLAN_LIMITS[p].users ?? 1) : 0,
          bought: Number(row.package_seats?.[p] ?? 0), used: Number(row.used?.[p] ?? 0),
          blocked: i > rank ? `Upgrade the company to ${PLAN_NAME[p]} first` : undefined,
        }))}
        modules={[["sales", "Sales seats"], ["purchases", "Purchases seats"], ["inventory", "Inventory seats"]].map(([key, name]) => ({
          key, name, included: 0, bought: Number(row.module_seats?.[key] ?? 0), used: Number(row.used?.[key] ?? 0) }))} />
    </>
  );
}

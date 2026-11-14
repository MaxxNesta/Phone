import { sql } from "@/lib/db";
import { getCompany } from "@/lib/queries";
import { setCompanyPlan, setCompanyModules, setExtraUsers } from "@/lib/actions";
import { PLAN_LIMITS, PLAN_NAME, planSwitchable, MODULES, CORE_MODULES, type Plan } from "@/lib/plans";
import { ModuleSwitcher } from "@/components/module-switcher";
import { SeatCard } from "@/components/seat-card";
import { PlanSwitcher } from "@/components/plan-switcher";
import { HelpHint } from "@/components/help-hint";

export default async function PlanSettings() {
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;

  const [row] = (await sql`select plan, extra_users,
      (select count(*)::int from app_user u where u.company_id = c.id and u.is_active) as active_users
      from company c where c.id = ${company.id}`) as
    unknown as { plan: Plan; extra_users: number; active_users: number }[];

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
          Which package this company is on. In production the package is set
          by the provider; on test sites it can be switched here so each tier
          can be tried.
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
        locked={!planSwitchable} action={setCompanyModules} />

      <SeatCard included={PLAN_LIMITS[row.plan].users ?? 1} extra={row.extra_users} active={row.active_users}
        locked={!planSwitchable} action={setExtraUsers} />
    </>
  );
}

import { sql } from "@/lib/db";
import { getCompany } from "@/lib/queries";
import { setCompanyPlan } from "@/lib/actions";
import { PLAN_LIMITS, planSwitchable, type Plan } from "@/lib/plans";
import { PlanSwitcher } from "@/components/plan-switcher";
import { HelpHint } from "@/components/help-hint";

export default async function PlanSettings() {
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;

  const [row] = (await sql`select plan from company where id = ${company.id}`) as
    unknown as { plan: Plan }[];

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
          <strong>Enforced:</strong> Starter is one branch and three
          warehouses; Business is up to four branches; Enterprise has no
          limit. A company already over its limit keeps what it has and is
          refused only when it adds more.
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
    </>
  );
}

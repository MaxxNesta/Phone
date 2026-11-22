import { Crown, Gem, Star } from "lucide-react";
import { PLAN_NAME, type Plan } from "@/lib/plans";

/**
 * The company's package as a small mark beside its name: a crown for
 * Advanced, a gem for Standard, a star for Essential. It shows the
 * company's own package, not the reader's seat level.
 */
export function PlanMark({ plan }: { plan: Plan }) {
  const Icon = plan === "ENTERPRISE" ? Crown : plan === "BUSINESS" ? Gem : Star;
  const name = PLAN_NAME[plan];
  return (
    <span className={`plan-mark ${plan.toLowerCase()}`} title={`${name} package`} aria-label={`${name} package`} role="img">
      <Icon size={11} strokeWidth={2.4} aria-hidden="true" />
    </span>
  );
}

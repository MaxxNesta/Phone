import { MapPin } from "lucide-react";
import { sql } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";

/**
 * Says whose figures a page shows when the person sees only their own branch.
 * Without it a cashier reading Receivables could take one branch's total for
 * the company's. Nothing is shown to someone who sees every branch, or in a
 * company with a single branch, where there is no other scope to confuse it with.
 */
export async function BranchScope() {
  const [user, seen] = await Promise.all([currentUser(), seenLocations()]);
  if (!user || !seen) return null;
  const branches = await sql`
    select id, name from location
     where company_id = ${user.companyId} and parent_id is null and is_active`;
  if (branches.length < 2) return null;
  const mine = branches.find((b) => seen.includes(b.id as string));
  return (
    <span className="branch-scope" title="You see this branch only. An administrator can change this in Settings → Users.">
      <MapPin size={14} aria-hidden="true" />
      {mine ? `${mine.name} only` : "No branch assigned"}
    </span>
  );
}

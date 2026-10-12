import { sql } from "./db";
import { ALL_BRANCH_ROLES, type SessionUser } from "./auth-core";

/**
 * Where a person may work.
 *
 * A person belongs to a branch and works only there: every form shows that
 * branch fixed, and every posting refuses a location outside it, whatever the
 * request says. Only an administrator or a manager may work across branches,
 * and only when no branch is set for them.
 *
 * Returned as the set of location ids the person may use — the branch itself
 * and everything under it — or null for every location.
 */
export async function locationsForUser(user: Pick<SessionUser, "companyId" | "role" | "branchId">): Promise<Set<string> | null> {
  if (!user.branchId && ALL_BRANCH_ROLES.includes(user.role)) return null;
  let branchId = user.branchId;
  if (!branchId) {
    // Not yet given a branch. With one branch there is nothing to choose; with
    // several, guessing would put a cashier in a till that is not theirs.
    const branches = await sql`
      select id from location where company_id = ${user.companyId} and parent_id is null and is_active`;
    if (branches.length !== 1) return new Set();
    branchId = branches[0].id as string;
  }
  const rows = await sql`
    with recursive tree as (
      select id from location where id = ${branchId} and company_id = ${user.companyId}
      union all
      select l.id from location l join tree t on l.parent_id = t.id
    )
    select id from tree`;
  return new Set(rows.map((r) => r.id as string));
}

/**
 * What a person may see: everything if they may see every branch, otherwise
 * exactly where they may work. Kept apart from where they may post because an
 * administrator can let someone see all branches while they sell at one.
 */
export async function visibleLocationsForUser(
  user: Pick<SessionUser, "companyId" | "role" | "branchId" | "seesAllBranches">,
): Promise<Set<string> | null> {
  if (user.seesAllBranches) return null;
  return locationsForUser(user);
}

/**
 * The one branch a person limited to their own branch sees, for reports that
 * filter by branch; null when they may see every branch (or have none yet).
 */
export async function visibleBranchForUser(
  user: Pick<SessionUser, "companyId" | "role" | "branchId" | "seesAllBranches">,
): Promise<string | null> {
  const seen = await visibleLocationsForUser(user);
  if (!seen || seen.size === 0) return null;
  if (user.branchId) return user.branchId;
  const [only] = await sql`
    select id from location where company_id = ${user.companyId} and parent_id is null and is_active`;
  return (only?.id as string) ?? null;
}

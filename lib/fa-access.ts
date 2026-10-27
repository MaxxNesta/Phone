import { requirePermission, can, type SessionUser } from "./auth";
import { allowedLocations, seenLocations } from "./branch-scope";

/**
 * Who may do what in Fixed Assets. One company-wide module; each person sees
 * and posts only the branches they are authorised for, checked here on the
 * server for every page and action.
 *
 *   Owner (admin)            everything
 *   Company accountant       may post, sees every branch: reviews and posts any branch
 *   Branch accountant        may post, tied to a branch: that branch only
 *   Branch manager           a manager tied to a branch: views it, does not post
 *
 * Depreciation is a company-level accounting job, so a poster who sees every
 * branch may post for any of them, though the rest of the app keeps their
 * own postings at their branch.
 */

export function canPostFa(user: Pick<SessionUser, "role" | "branchId">) {
  if (!can(user, "accounting.post")) return false;
  return !(user.role === "MANAGER" && user.branchId);
}

/** The signed-in person, refused unless they may post fixed-asset entries. */
export async function requireFaPoster() {
  const user = await requirePermission("accounting.post");
  if (!canPostFa(user)) throw new Error("Your role views this branch's assets; posting is for an accountant.");
  return user;
}

/** Refuses a branch the person may not post for. */
export async function assertFaBranch(user: SessionUser, ...branchIds: (string | null | undefined)[]) {
  if (!canPostFa(user)) throw new Error("Your role views this branch's assets; posting is for an accountant.");
  if (user.seesAllBranches || (await allowedLocations(user)) === null) return;
  const mine = await allowedLocations(user);
  for (const id of branchIds) {
    if (id && !mine!.has(id)) throw new Error("That asset's branch is not one you are authorised for.");
  }
}

/** Company-level work (historical journals with no branch): only for someone who sees every branch. */
export async function isCompanyLevel() {
  return (await seenLocations()) === null;
}

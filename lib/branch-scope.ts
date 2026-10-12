import { cache } from "react";
import { requireUser, currentUser } from "./auth";
import { locationsForUser, visibleLocationsForUser, visibleBranchForUser } from "./branch-rule";

/** The rule (lib/branch-rule.ts), once per request. */
export const allowedLocations = cache(locationsForUser);

/** The signed-in person's allowed locations (null = all). */
export async function myLocations(): Promise<Set<string> | null> {
  const user = await currentUser();
  return user ? allowedLocations(user) : new Set();
}

/** Keeps only the rows at a location the signed-in person may use. */
export async function onlyMyLocations<T extends { id: string }>(rows: T[]): Promise<T[]> {
  const mine = await myLocations();
  return mine ? rows.filter((r) => mine.has(r.id)) : rows;
}

/**
 * Refuses a posting at a location outside the person's branch. Called by every
 * action that takes a location from the request, because a form showing only
 * one branch is no protection against a request that names another.
 */
export async function assertMyBranch(...locationIds: (string | null | undefined)[]) {
  const user = await requireUser();
  const mine = await allowedLocations(user);
  if (!mine) return;
  if (mine.size === 0) {
    throw new Error("You have not been given a branch yet. Ask an administrator to set the branch you work at.");
  }
  for (const id of locationIds) {
    if (id && !mine.has(id)) {
      throw new Error("That location belongs to another branch. You can only work at your own branch.");
    }
  }
}

const visibleFor = cache(visibleLocationsForUser);

/**
 * The locations the signed-in person may see, as a list for a query
 * (`and d.location_id = any(...)`), or null for everywhere. A person limited to
 * a branch with no branch set yet gets an empty list and so sees nothing.
 */
export async function seenLocations(): Promise<string[] | null> {
  const user = await currentUser();
  if (!user) return [];
  const seen = await visibleFor(user);
  return seen ? [...seen] : null;
}

/**
 * For a report that filters by branch: what the person asked for if they may
 * see every branch, otherwise their own branch whatever they asked for.
 */
export async function scopedBranch(requested: string | null | undefined): Promise<string | null> {
  const user = await currentUser();
  if (!user) return requested || null;
  if (!(await visibleFor(user))) return requested || null;
  return visibleBranchForUser(user);
}

/** Branch options for a report's picker: only the person's own when limited to it. */
export async function seenBranches<T extends { id: string }>(branches: T[]): Promise<T[]> {
  const seen = await seenLocations();
  return seen ? branches.filter((b) => seen.includes(b.id)) : branches;
}

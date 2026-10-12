import { cache } from "react";
import { requireUser, currentUser } from "./auth";
import { locationsForUser } from "./branch-rule";

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

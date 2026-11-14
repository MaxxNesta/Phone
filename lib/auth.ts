import { randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { sql } from "./db";
import {
  can, userForToken, tokenHash, SESSION_COOKIE, ROLE_LABEL, ROLES, authRequired, ownerUser, SESSION_HOURS, SESSION_IDLE_MINUTES,
  type Permission, type SessionUser,
} from "./auth-core";

export * from "./auth-core";

// Cookie-bound half of sign-in: making and ending sessions, and asking who
// is on this request. Server-side checks are the ones that count — every
// server action calls requirePermission before it does anything.

// ------------------------------------------------------------- sessions --

export async function createSession(userId: string) {
  // Ended sessions are deleted rather than left to pile up.
  await sql`delete from user_session where expires_at < now()
              or last_seen_at < now() - make_interval(mins => ${SESSION_IDLE_MINUTES})`;
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_HOURS * 3600_000);
  await sql`
    insert into user_session (user_id, token_hash, expires_at)
    values (${userId}, ${tokenHash(token)}, ${expires})`;
  await sql`update app_user set last_login_at = now() where id = ${userId}`;
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", path: "/", expires,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await sql`delete from user_session where token_hash = ${tokenHash(token)}`;
  jar.delete(SESSION_COOKIE);
}

/** Who is asking, once per request. */
/** Test sites only: with sign-in off, the owner can look at the app as another role. */
export const PREVIEW_ROLE_COOKIE = "preview_role";
export const PREVIEW_BRANCH_COOKIE = "preview_branch";
export const previewAllowed = () => !authRequired() && process.env.VERCEL_ENV !== "production";

export const currentUser = cache(async (): Promise<SessionUser | null> => {
  // Sign-in off: everyone is the owner — or, on a test site, the role being previewed.
  if (!authRequired()) {
    const owner = await ownerUser();
    if (!owner || !previewAllowed()) return owner;
    const jar = await cookies();
    const as = jar.get(PREVIEW_ROLE_COOKIE)?.value;
    if (!as || !(ROLES as readonly string[]).includes(as)) return owner;
    // A branch id means "works at this branch only"; none means all branches.
    const branch = jar.get(PREVIEW_BRANCH_COOKIE)?.value || null;
    return { ...owner, role: as as SessionUser["role"], branchId: branch, seesAllBranches: !branch };
  }
  return userForToken((await cookies()).get(SESSION_COOKIE)?.value);
});

export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw new Error("Your session has ended. Sign in again.");
  return u;
}

export async function requirePermission(p: Permission): Promise<SessionUser> {
  const u = await requireUser();
  if (!can(u, p)) {
    throw new Error(`${ROLE_LABEL[u.role]} accounts cannot do this (${p}). Ask a manager.`);
  }
  return u;
}


import { randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { sql } from "./db";
import {
  can, userForToken, tokenHash, SESSION_COOKIE, ROLE_LABEL, authRequired, ownerUser,
  type Permission, type SessionUser,
} from "./auth-core";

export * from "./auth-core";

// Cookie-bound half of sign-in: making and ending sessions, and asking who
// is on this request. Server-side checks are the ones that count — every
// server action calls requirePermission before it does anything.

// ------------------------------------------------------------- sessions --

const SESSION_HOURS = 12;

export async function createSession(userId: string) {
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
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  // Sign-in off: everyone is the owner.
  if (!authRequired()) return ownerUser();
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


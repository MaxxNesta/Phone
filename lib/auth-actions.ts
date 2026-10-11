"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { sql } from "./db";
import { tooManyFailures, recordFailure, clearFailures, LOGIN_LIMITS } from "./login-throttle";
import {
  createSession, endSession, hashPassword, verifyPassword, requirePermission,
  ROLES, type Role,
} from "./auth";

type Result = { error: string } | { ok: string } | null;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
let dummy: string | null = null;
const DUMMY_HASH = () => (dummy ??= hashPassword("not a password anyone has"));
const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

/**
 * Only a path on this site, so ?next= cannot send someone elsewhere. Resolved
 * the way a browser would: "/\evil.com" and "//evil.com" both leave the
 * origin and are refused, which a prefix check alone misses.
 */
const safeNext = (v: string) => {
  try {
    const u = new URL(v, "http://this.site");
    return u.origin === "http://this.site" && v.startsWith("/") ? u.pathname + u.search : "/";
  } catch {
    return "/";
  }
};

export async function signIn(_prev: Result, fd: FormData): Promise<Result> {
  const email = str(fd, "email").toLowerCase();
  const password = String(fd.get("password") ?? "");
  // The caller's address as Vercel's edge saw it: the first hop, which the
  // platform sets itself rather than passing on what the client sent.
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  // Refused before the password is checked, and the same for an email that
  // does not exist, so the limit says nothing about which accounts there are.
  if (await tooManyFailures(sql, email, ip)) {
    return { error: `Too many failed sign-ins. Wait ${LOGIN_LIMITS.windowMinutes} minutes and try again.` };
  }
  const [u] = await sql`
    select id, password_hash, is_active from app_user where lower(email) = ${email}`;
  // One message for every failure, so the form does not say which emails exist.
  // An unknown email still pays for one scrypt, so how long the answer takes
  // does not tell which emails exist either.
  const ok = u ? verifyPassword(password, u.password_hash) : (verifyPassword(password, DUMMY_HASH()), false);
  if (!u || !u.is_active || !ok) {
    await recordFailure(sql, email, ip);
    return { error: "That email and password do not match an active account." };
  }
  await clearFailures(sql, email);
  await createSession(u.id);
  redirect(safeNext(str(fd, "next")));
}

export async function signOut() {
  await endSession();
  redirect("/login");
}

/**
 * The first administrator, on a database with a company and nobody who can
 * sign in. Refused the moment anyone can — after that, people are added by
 * an administrator from Settings → Users.
 */
export async function createFirstAdmin(_prev: Result, fd: FormData): Promise<Result> {
  const [co] = await sql`select id from company order by created_at limit 1`;
  if (!co) return { error: "Set up the company first." };
  const [any] = await sql`select 1 as yes from app_user where password_hash is not null limit 1`;
  if (any) return { error: "An administrator already exists. Sign in instead." };

  const name = str(fd, "name");
  const email = str(fd, "email").toLowerCase();
  if (!name || !email.includes("@")) return { error: "Enter a name and an email address." };
  let hash: string;
  try { hash = hashPassword(String(fd.get("password") ?? "")); }
  catch (e) { return { error: (e as Error).message }; }

  const [u] = await sql`
    insert into app_user (company_id, name, initials, email, password_hash, role)
    values (${co.id}, ${name}, ${initialsOf(name)}, ${email}, ${hash}, 'ADMIN')
    on conflict (company_id, name) do update
      set email = excluded.email, password_hash = excluded.password_hash, role = 'ADMIN'
    returning id`;
  await createSession(u.id);
  redirect("/");
}

export async function saveUser(_prev: Result, fd: FormData): Promise<Result> {
  const admin = await requirePermission("users.manage");
  const id = str(fd, "id");
  const name = str(fd, "name");
  const email = str(fd, "email").toLowerCase();
  const role = str(fd, "role") as Role;
  const password = String(fd.get("password") ?? "");
  const active = fd.get("is_active") !== null;

  if (!name || !email.includes("@")) return { error: "Enter a name and an email address." };
  if (!ROLES.includes(role)) return { error: "Choose a role." };
  if (id === admin.id && (role !== "ADMIN" || !active)) {
    return { error: "You cannot remove your own administrator access." };
  }

  try {
    const hash = password ? hashPassword(password) : null;
    if (id) {
      await sql`
        update app_user set name = ${name}, initials = ${initialsOf(name)}, email = ${email},
               role = ${role}, is_active = ${active},
               password_hash = coalesce(${hash}, password_hash)
         where id = ${id} and company_id = ${admin.companyId}`;
      // A deactivated account or a changed password ends its sessions now.
      if (!active || hash) await sql`delete from user_session where user_id = ${id}`;
    } else {
      if (!hash) return { error: "A new account needs a password." };
      await sql`
        insert into app_user (company_id, name, initials, email, password_hash, role, is_active)
        values (${admin.companyId}, ${name}, ${initialsOf(name)}, ${email}, ${hash}, ${role}, ${active})`;
    }
  } catch (e) {
    const msg = (e as Error).message;
    return { error: /unique|duplicate/i.test(msg) ? "Another account already uses that name or email." : msg };
  }
  revalidatePath("/settings/users");
  return { ok: id ? "Account updated" : "Account created" };
}

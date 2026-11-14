"use server";
import { SEATS, seatAllows, PLAN_ORDER, PLAN_NAME, planRank, packageSeatsAt, type Seat, type Plan } from "./plans";

import { str } from "./input";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers, cookies } from "next/headers";
import { createHash, timingSafeEqual } from "node:crypto";
import { savedLocale } from "./locale";
import { LOCALE_COOKIE } from "@/i18n/config";
import { sql } from "./db";
import { tooManyFailures, recordFailure, clearFailures, LOGIN_LIMITS } from "./login-throttle";
import {
  createSession, endSession, hashPassword, verifyPassword, requirePermission,
  ROLES, ROLE_LABEL, ALL_BRANCH_ROLES, type Role,
} from "./auth";

type Result = { error: string } | { ok: string } | null;

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
  // Their language comes back with them.
  const locale = await savedLocale(u.id);
  if (locale) (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
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
 *
 * Not open to whoever arrives first: it needs the one-time setup code set as
 * SETUP_TOKEN on the deployment, compared in constant time. With no
 * SETUP_TOKEN it is refused outright — the owner instead sets their password
 * in Settings → Users while sign-in is still off. The check and the insert
 * run under one lock, so two people racing cannot both become the first.
 */
export async function createFirstAdmin(_prev: Result, fd: FormData): Promise<Result> {
  const expected = process.env.SETUP_TOKEN ?? "";
  const given = String(fd.get("setup_code") ?? "");
  const digest = (v: string) => createHash("sha256").update(v).digest();
  if (!expected || !timingSafeEqual(digest(expected), digest(given))) {
    return { error: expected
      ? "That setup code is not right."
      : "The first account cannot be created here on this deployment. Set your password in Settings → Users while sign-in is off." };
  }
  const name = str(fd, "name");
  const email = str(fd, "email").toLowerCase();
  if (!name || !email.includes("@")) return { error: "Enter a name and an email address." };
  let hash: string;
  try { hash = hashPassword(String(fd.get("password") ?? "")); }
  catch (e) { return { error: (e as Error).message }; }

  const made: { id: string } | { error: string } = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('first-admin'))`;
    const [co] = await tx`select id from company order by created_at limit 1`;
    if (!co) return { error: "Set up the company first." };
    const [any] = await tx`select 1 as yes from app_user where password_hash is not null limit 1`;
    if (any) return { error: "An administrator already exists. Sign in instead." };
    const [u] = await tx`
      insert into app_user (company_id, name, initials, email, password_hash, role)
      values (${co.id}, ${name}, ${initialsOf(name)}, ${email}, ${hash}, 'ADMIN')
      on conflict (company_id, name) do update
        set email = excluded.email, password_hash = excluded.password_hash, role = 'ADMIN', is_active = true
      returning id`;
    return { id: u.id as string };
  });
  if ("error" in made) return { error: made.error };
  await createSession(made.id);
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
  const branchId = str(fd, "branch_id") || null;
  const seesAll = fd.get("sees_all_branches") !== null;
  const seat = (str(fd, "seat") || "package") as Seat;
  const level = seat === "package" ? (str(fd, "seat_plan") || null) : null;
  if (level && !PLAN_ORDER.includes(level as Plan)) return { error: "Choose a package level." };
  if (!SEATS.some((s) => s.key === seat)) return { error: "Choose a seat." };
  if (!seatAllows(seat, role)) {
    const s = SEATS.find((x) => x.key === seat)!;
    return { error: `A ${s.name.toLowerCase()} can only be ${s.roles!.map((r) => ROLE_LABEL[r as Role]).join(" or ")}. Move this person to a package seat, or buy the module for this role.` };
  }

  if (!name || !email.includes("@")) return { error: "Enter a name and an email address." };
  if (!ROLES.includes(role)) return { error: "Choose a role." };
  if (id === admin.id && (role !== "ADMIN" || !active)) {
    return { error: "You cannot remove your own administrator access." };
  }
  // A person works at one branch. Only an administrator or a manager may be
  // left without one, which means every branch.
  const branches = await sql`
    select id from location where company_id = ${admin.companyId} and parent_id is null and is_active`;
  if (branchId && !branches.some((b) => b.id === branchId)) return { error: "Choose one of the company's branches." };
  if (!branchId && !ALL_BRANCH_ROLES.includes(role) && branches.length > 1) {
    return { error: "Choose the branch this person works at. Only an administrator or a manager can work across all branches." };
  }

  // Seats: the package's included user plus those bought. Only adding a
  // person, or reactivating one, needs a free seat; editing never does.
  const [room] = await sql`
    select c.plan, c.package_seats, c.module_seats,
           (select is_active from app_user u where u.id = ${id || null}::uuid) as was_active,
           (select seat from app_user u where u.id = ${id || null}::uuid) as was_seat,
           (select coalesce(seat_plan, c.plan) from app_user u where u.id = ${id || null}::uuid) as was_level
      from company c where c.id = ${admin.companyId}`;
  const companyPlan = room.plan as Plan;
  const myLevel = (level ?? companyPlan) as Plan;
  // A seat's level never rises above the company's package.
  if (seat === "package" && planRank(myLevel) > planRank(companyPlan)) {
    return { error: `The company is on ${PLAN_NAME[companyPlan]}. Upgrade the company to ${PLAN_NAME[myLevel]} first, then add ${PLAN_NAME[myLevel]} seats.` };
  }
  const [{ others }] = await sql`
    select count(*)::int as others from app_user u
     where u.company_id = ${admin.companyId} and u.is_active and u.seat = ${seat} and u.password_hash is not null
       and (${seat} <> 'package' or coalesce(u.seat_plan, ${companyPlan}) = ${myLevel})
       and (${id || null}::uuid is null or u.id <> ${id || null}::uuid)`;
  // A seat is needed by someone new, someone reactivated, or someone moved to another seat or level.
  const needsSeat = active && (!id || room?.was_active === false || room?.was_seat !== seat
    || (seat === "package" && room?.was_level !== myLevel));
  if (needsSeat) {
    const limit = seat === "package" ? packageSeatsAt(myLevel, companyPlan, room.package_seats)
      : Number((room.module_seats as Record<string, number> | null)?.[seat] ?? 0);
    if (others + 1 > limit) {
      const s = SEATS.find((x) => x.key === seat)!;
      const what = seat === "package" ? `${PLAN_NAME[myLevel]} package seat` : s.name.toLowerCase();
      return { error: limit === 0
        ? (seat === "package" ? `No ${what}s are bought. Add one in Settings → Package, or choose another level.`
            : `No ${what}s are bought. Buy the ${s.name.replace(" seat", "")} module, or use a package seat.`)
        : `All ${limit} ${what}${limit === 1 ? "" : "s"} are in use. Add a seat, or deactivate someone first.` };
    }
  }

  try {
    const hash = password ? hashPassword(password) : null;
    if (id) {
      await sql`
        update app_user set name = ${name}, initials = ${initialsOf(name)}, email = ${email},
               role = ${role}, is_active = ${active}, seat = ${seat}, seat_plan = ${level === companyPlan ? null : level}, branch_id = ${branchId}, sees_all_branches = ${seesAll},
               password_hash = coalesce(${hash}, password_hash)
         where id = ${id} and company_id = ${admin.companyId}`;
      // A deactivated account or a changed password ends its sessions now.
      if (!active || hash) await sql`delete from user_session where user_id = ${id}`;
    } else {
      if (!hash) return { error: "A new account needs a password." };
      await sql`
        insert into app_user (company_id, name, initials, email, password_hash, role, is_active, branch_id, sees_all_branches, seat, seat_plan)
        values (${admin.companyId}, ${name}, ${initialsOf(name)}, ${email}, ${hash}, ${role}, ${active}, ${branchId}, ${seesAll}, ${seat}, ${level === companyPlan ? null : level})`;
    }
  } catch (e) {
    const msg = (e as Error).message;
    return { error: /unique|duplicate/i.test(msg) ? "Another account already uses that name or email." : msg };
  }
  revalidatePath("/settings/users");
  return { ok: id ? "Account updated" : "Account created" };
}

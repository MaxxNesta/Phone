"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ROLES } from "./roles";
import { PREVIEW_ROLE_COOKIE, PREVIEW_BRANCH_COOKIE, PREVIEW_PLAN_COOKIE, previewAllowed, requireUser } from "./auth";
import { sql } from "./db";

/**
 * Look at the app as a role, on a test site with sign-in off. Not a way in:
 * it is refused in production and whenever sign-in is on, and it only ever
 * narrows what the owner may do.
 */
export async function previewRole(fd: FormData) {
  if (!previewAllowed()) return;
  const role = String(fd.get("role") ?? "");
  const jar = await cookies();
  const branch = String(fd.get("branch") ?? "");
  if (role && (ROLES as readonly string[]).includes(role) && role !== "ADMIN") {
    const opts = { path: "/", httpOnly: true, sameSite: "lax" as const, maxAge: 60 * 60 * 8 };
    jar.set(PREVIEW_ROLE_COOKIE, role, opts);
    // Only one of the company's own branches; anything else means all branches.
    const me = await requireUser();
    const [ok] = branch ? await sql`select 1 from location where id = ${branch}::uuid and company_id = ${me.companyId} and parent_id is null` : [];
    if (ok) jar.set(PREVIEW_BRANCH_COOKIE, branch, opts); else jar.delete(PREVIEW_BRANCH_COOKIE);
    const plan = String(fd.get("seat_plan") ?? "");
    if (["STARTER", "BUSINESS", "ENTERPRISE"].includes(plan)) jar.set(PREVIEW_PLAN_COOKIE, plan, opts); else jar.delete(PREVIEW_PLAN_COOKIE);
  } else {
    jar.delete(PREVIEW_ROLE_COOKIE);
    jar.delete(PREVIEW_BRANCH_COOKIE);
    jar.delete(PREVIEW_PLAN_COOKIE);
  }
  revalidatePath("/", "layout");
  redirect(role && role !== "ADMIN" ? "/" : "/settings/users");
}

"use server";

import { cookies } from "next/headers";
import { sql } from "./db";
import { currentUser } from "./auth";
import { LOCALE_COOKIE, isLocale } from "@/i18n/config";

/**
 * Switches the interface language. Only the cookie and the user's preference
 * change; the caller refreshes in place, so a half-filled form or a sale in
 * progress is still there in the other language.
 */
export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  const user = await currentUser().catch(() => null);
  if (!user) return;
  await sql`
    insert into user_preference (user_id, locale) values (${user.id}, ${locale})
    on conflict (user_id) do update set locale = excluded.locale, updated_at = now()`;
}

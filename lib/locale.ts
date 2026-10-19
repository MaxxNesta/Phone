import { sql } from "./db";
import { currentUser } from "./auth";
import { isLocale, type Locale } from "@/i18n/config";

/**
 * The language a user chose, kept in its own table rather than on app_user:
 * the sign-in record stays as it is, and a preference is not an identity.
 */
export async function savedLocale(userId?: string): Promise<Locale | null> {
  const id = userId ?? (await currentUser().catch(() => null))?.id;
  if (!id) return null;
  const [row] = await sql`select locale from user_preference where user_id = ${id}`.catch(() => []);
  return row && isLocale(row.locale) ? row.locale : null;
}

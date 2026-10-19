import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "./config";
import en from "../messages/en.json";

/**
 * The language for this request, with no prefix in the URL: routes stay
 * exactly as they were. The cookie decides; without one, the signed-in user's
 * saved preference does; without that, English.
 *
 * Messages are English with the chosen language laid over it, so a key not
 * yet translated shows in English rather than as a raw key.
 */
export default getRequestConfig(async () => {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  let locale: Locale = isLocale(fromCookie) ? fromCookie : DEFAULT_LOCALE;
  if (!isLocale(fromCookie)) {
    const { savedLocale } = await import("../lib/locale");
    locale = (await savedLocale()) ?? DEFAULT_LOCALE;
  }
  const messages = locale === "en" ? en : deepMerge(en, (await import(`../messages/${locale}.json`)).default);
  return { locale, messages };
});

type Tree = { [k: string]: string | Tree };
function deepMerge(base: Tree, over: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = typeof v === "object" && typeof base[k] === "object" ? deepMerge(base[k] as Tree, v) : v;
  }
  return out;
}

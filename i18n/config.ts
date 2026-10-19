/** The languages the interface speaks. English is the default and the fallback. */
export const LOCALES = ["en", "my"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
/** The cookie that carries the choice; the signed-in user's saved preference seeds it. */
export const LOCALE_COOKIE = "erp_locale";
export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);

/**
 * How each language names itself in the picker, in its own script, and the
 * country flag shown beside it (flag-icons codes). Adding one (Chinese next):
 * add its code to LOCALES, an entry here, messages/<code>.json, and a
 * migration widening the check on user_preference.locale.
 */
export const LANGUAGES: Record<Locale, { name: string; flag: string }> = {
  en: { name: "English", flag: "us" },
  my: { name: "မြန်မာ", flag: "mm" },
};

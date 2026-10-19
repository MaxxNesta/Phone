/** The languages the interface speaks. English is the default and the fallback. */
export const LOCALES = ["en", "my"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
/** The cookie that carries the choice; the signed-in user's saved preference seeds it. */
export const LOCALE_COOKIE = "erp_locale";
export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);

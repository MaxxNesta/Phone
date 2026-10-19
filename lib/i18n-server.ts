import { getTranslations } from "next-intl/server";
import { createTranslator } from "next-intl";
import enMessages from "../messages/en.json";

/**
 * A translator for server actions: the person's interface language inside a
 * request, English outside one (the scripts/ test suites call actions
 * directly, with no request to read a language from). Only what is shown
 * changes; every check and every posting is the same in any language.
 */
export async function serverT(namespace: string) {
  try {
    return await getTranslations(namespace);
  } catch {
    return createTranslator({ locale: "en", messages: enMessages, namespace: namespace as never });
  }
}

"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { setLocale } from "@/lib/locale-actions";

/**
 * EN | မြန်မာ in the top bar. Saves the choice, then refreshes the page in
 * place — not a reload — so what is typed into a form, and a sale on the
 * till, survive the switch.
 */
export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  // Shown at once; the page catches up when the refresh lands.
  const [shown, setShown] = useState(locale);
  useEffect(() => setShown(locale), [locale]);
  const pick = (l: string) => {
    if (l === shown || pending) return;
    setShown(l);
    start(async () => { await setLocale(l); router.refresh(); });
  };
  return (
    <div className="langswitch" role="group" aria-busy={pending} aria-label="Language / ဘာသာစကား">
      <button type="button" className="langswitch-opt" lang="en" aria-pressed={shown === "en"} onClick={() => pick("en")}>EN</button>
      <button type="button" className="langswitch-opt" lang="my" aria-pressed={shown === "my"} onClick={() => pick("my")}>မြန်မာ</button>
    </div>
  );
}

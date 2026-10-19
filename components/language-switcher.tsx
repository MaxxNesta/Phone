"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronDown } from "lucide-react";
import { setLocale } from "@/lib/locale-actions";
import { LOCALES, LANGUAGES, type Locale } from "@/i18n/config";

/** A flag from flag-icons, 4:3, decorative — the name beside it says the language. */
const Flag = ({ code }: { code: Locale }) => <span className={`fi fi-${LANGUAGES[code].flag} langpick-flag`} aria-hidden="true" />;

/**
 * The language picker in the top bar: the current language's flag and name,
 * opening a list of every language in its own script.
 *
 * Choosing saves the preference and refreshes the page in place — not a
 * reload — so what is typed into a form, and a sale on the till, survive.
 */
export function LanguageSwitcher() {
  const locale = useLocale() as Locale;
  const t = useTranslations("language");
  const router = useRouter();
  const [pending, start] = useTransition();
  // Shown at once; the page catches up when the refresh lands.
  const [shown, setShown] = useState<Locale>(locale);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => setShown(locale), [locale]);

  // Closes on a click anywhere else, and on Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const pick = (l: Locale) => {
    setOpen(false);
    button.current?.focus();
    if (l === shown || pending) return;
    setShown(l);
    start(async () => { await setLocale(l); router.refresh(); });
  };
  const openList = () => { setHi(Math.max(0, LOCALES.indexOf(shown))); setOpen(true); };

  return (
    <div className="langpick" ref={wrap} aria-busy={pending}>
      <button ref={button} type="button" className="langpick-btn" aria-haspopup="listbox" aria-expanded={open}
        aria-label={`${t("label")}: ${LANGUAGES[shown].name}`}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); openList(); } }}>
        <Flag code={shown} />
        <span lang={shown}>{LANGUAGES[shown].name}</span>
        <ChevronDown size={16} aria-hidden="true" className="langpick-chev" />
      </button>
      {open && (
        <ul className="langpick-list" role="listbox" aria-label={t("label")} tabIndex={-1}
          ref={(el) => el?.focus()}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); setOpen(false); button.current?.focus(); }
            else if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, LOCALES.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(LOCALES[hi]); }
          }}>
          {LOCALES.map((l, i) => (
            <li key={l} role="option" aria-selected={l === shown} lang={l}
              className={i === hi ? "hi" : undefined}
              onMouseEnter={() => setHi(i)} onClick={() => pick(l)}>
              <Flag code={l} />
              <span>{LANGUAGES[l].name}</span>
              {l === shown && <Check size={16} aria-hidden="true" className="langpick-check" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

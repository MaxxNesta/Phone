"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";
import { isBusyText } from "@/lib/busy-text";

export type Tone = "success" | "error" | "warning" | "info";
type Note = { id: number; tone: Tone; text: string; title?: string; leaving?: boolean };

const EVENT = "app:notice";
// How long each stays: a success is read at a glance, a problem needs reading.
const LIFE: Record<Tone, number> = { success: 3500, info: 4500, warning: 7000, error: 9000 };
const FADE_MS = 280;
const MOST = 4;
const ICON = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info };

/** Shows a notice from anywhere on the client: a form, a button, a hook. */
export function notify(tone: Tone, text: string, title?: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { tone, text, title } }));
}

/**
 * An action's result, said as a notice: its own message when it gave one,
 * otherwise `ok` (or "Saved"). Errors pop too, and the form keeps its own
 * box saying the same beside the fields. A limit's refusal is a warning,
 * not a failure: nothing went wrong, it is only too soon.
 */
export function useNotice(
  state: unknown,
  opts: { ok?: string; errors?: boolean } = {},
) {
  const t = useTranslations("common");
  const last = useRef<unknown>(null);
  useEffect(() => {
    if (!state || state === last.current || typeof state !== "object") return;
    last.current = state;
    const s = state as { ok?: unknown; error?: unknown };
    if (typeof s.error === "string" && s.error) {
      // A refusal for want of a permission is a dialog, not a passing toast.
      if (/accounts cannot do this \(/.test(s.error)) {
        window.dispatchEvent(new CustomEvent("erp:denied", { detail: s.error }));
        return;
      }
      if (opts.errors === false) return;
      notify(isBusyText(s.error) ? "warning" : "error", s.error);
    } else if ("ok" in s && s.ok !== false) {
      notify("success", typeof s.ok === "string" ? s.ok : opts.ok ?? t("noticeSaved"));
    }
  }, [state, opts.ok, opts.errors, t]);
}

function Notices() {
  const t = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toastParam = searchParams.get("toast");
  const [notes, setNotes] = useState<Note[]>([]);
  const seq = useRef(0);

  const close = (id: number) => {
    setNotes((n) => n.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    window.setTimeout(() => setNotes((n) => n.filter((x) => x.id !== id)), FADE_MS);
  };

  const add = (tone: Tone, text: string, title?: string) => {
    const id = ++seq.current;
    setNotes((n) => [...n, { id, tone, text, title }].slice(-MOST));
    window.setTimeout(() => close(id), LIFE[tone]);
  };

  // From anywhere: notify().
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent).detail; add(d.tone, d.text, d.title); };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  // After a redirect: ?toast=…, taken off the address so a refresh does not replay it.
  useEffect(() => {
    if (!toastParam) return;
    add("success", toastParam);
    const params = new URLSearchParams(searchParams);
    params.delete("toast");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [toastParam, pathname, router, searchParams]);

  if (!notes.length) return null;
  const titles: Record<Tone, string | null> = { success: null, info: null, error: t("noticeError"), warning: t("noticeWarning") };

  return (
    <div className="notices" aria-live="polite">
      {notes.map((n) => {
        const Icon = ICON[n.tone];
        const title = n.title ?? titles[n.tone];
        return (
          <div key={n.id} className={`notice ${n.tone}`} data-leaving={n.leaving || undefined}
               role={n.tone === "error" ? "alert" : "status"}>
            <span className="notice-icon" aria-hidden="true"><Icon size={18} strokeWidth={2.2} /></span>
            <span className="notice-body">
              {title && <strong>{title}</strong>}
              <span>{n.text}</span>
            </span>
            <button type="button" className="notice-close" onClick={() => close(n.id)} aria-label={t("close")}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Every notice the app raises: after a redirect, after an action, or from notify(). */
export function Toast() {
  return (
    <Suspense fallback={null}>
      <Notices />
    </Suspense>
  );
}

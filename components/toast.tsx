"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";

const SHOW_MS = 2600;
const FADE_MS = 320;

function ToastInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toastParam = searchParams.get("toast");

  // Carries a sequence number so two identical messages in a row still count
  // as two toasts rather than one no-op state update.
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const seq = useRef(0);

  // Capture the message, then strip the param so a refresh or a back
  // navigation doesn't replay it.
  useEffect(() => {
    if (!toastParam) return;

    seq.current += 1;
    setToast({ text: toastParam, id: seq.current });

    const params = new URLSearchParams(searchParams);
    params.delete("toast");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [toastParam, pathname, router, searchParams]);

  // Dismissal is driven by the captured toast, not by the URL param. Tying it
  // to the param meant stripping the param above cancelled these timers
  // before they ever fired, and the toast stayed on screen forever.
  useEffect(() => {
    if (!toast) return;

    setLeaving(false);
    const fade = setTimeout(() => setLeaving(true), SHOW_MS);
    const clear = setTimeout(() => setToast(null), SHOW_MS + FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(clear);
    };
  }, [toast]);

  if (!toast) return null;

  return (
    <div className="toast-wrap">
      <div
        className="toast"
        data-leaving={leaving}
        role="status"
        aria-live="polite"
        onClick={() => setToast(null)}
      >
        <span className="toast-icon" aria-hidden="true"><Check size={13} strokeWidth={3} /></span>
        <span>{toast.text}</span>
      </div>
    </div>
  );
}

/** A brief confirmation after an action redirects, so the user isn't left
 *  guessing whether it worked. Details stay on the page it lands on. */
export function Toast() {
  return (
    <Suspense fallback={null}>
      <ToastInner />
    </Suspense>
  );
}

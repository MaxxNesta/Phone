"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Info, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ActionResult } from "@/lib/actions";
import { useNotice } from "@/components/toast";

/**
 * Replaces window.confirm() for destructive row actions.
 *
 * The native dialog cannot be styled, renders differently on every OS, and
 * prefixes the message with the origin ("localhost:3000 says…"), which reads
 * like a browser warning about the site rather than a decision the app is
 * asking for.
 *
 * Built on <dialog showModal()> rather than a hand-rolled overlay so focus
 * trapping, Esc-to-close, inertness of the page behind, and the backdrop all
 * come from the platform instead of being reimplemented (usually badly).
 *
 * The server action is submitted from inside the dialog, so a refusal — a
 * foreign-key violation on something still in use, say — turns the same
 * dialog into "Can't delete …" with the reason, rather than a line of red
 * text somewhere after the dialog has already gone.
 */
export function ConfirmDelete({
  action,
  pending,
  error,
  title,
  detail,
  label,
  pendingLabel,
  confirmLabel,
  className = "danger tiny",
  confirmClassName = "danger-solid",
  ariaLabel,
  children,
}: {
  action: (fd: FormData) => void;
  pending: boolean;
  /** Server-side refusal, shown in the dialog. */
  error?: string | null;
  /** Names the exact record, so nobody confirms the wrong row. */
  title: string;
  detail?: string;
  /** The trigger's content — text, or an icon with `ariaLabel`. */
  label?: React.ReactNode;
  pendingLabel?: string;
  confirmLabel?: string;
  /** The confirm button. Red suits deleting; a dialog that merely
   *  wants a second look before writing something should not shout. */
  confirmClassName?: string;
  /** The trigger button's class. Defaults to the standalone red button; a
   *  row menu passes its own so the item sits flush with the others. */
  className?: string;
  ariaLabel?: string;
  /** Hidden inputs the action needs — id, return_to, and so on. */
  children?: React.ReactNode;
}) {
  const c = useTranslations("common");
  label ??= c("delete"); pendingLabel ??= c("deleting"); confirmLabel ??= c("delete");
  const ref = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // A refusal arrives when a submit finishes; it is shown in the dialog that
  // asked, reopened if a navigation closed it. Keyed on pending too, so the
  // same refusal twice in a row still shows the second time.
  useEffect(() => {
    if (pending || !error) return;
    setFailed(error);
    if (!ref.current?.open) ref.current?.showModal();
  }, [error, pending]);

  const close = () => ref.current?.close();

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={pending}
        data-keep-menu=""
        aria-label={ariaLabel}
        onClick={() => { setFailed(null); ref.current?.showModal(); }}
      >
        {pending ? pendingLabel : label}
      </button>

      <dialog ref={ref} className="confirm alertish" onClose={() => setFailed(null)} onClick={(e) => {
        // Clicking the backdrop closes. The dialog element itself fills the
        // whole viewport, so the target is only the dialog when the click
        // landed outside the panel.
        if (e.target === ref.current && !pending) close();
      }}>
        {failed ? (
          <div className="confirm-panel" role="alertdialog" aria-labelledby="cd-fail">
            <div className="confirm-icon" aria-hidden="true"><Ban size={18} strokeWidth={2.25} /></div>
            <h2 className="confirm-title" id="cd-fail">{c("cantDelete")}</h2>
            <p className="confirm-detail confirm-reason">{failed}</p>
            <div className="confirm-actions">
              <button type="button" autoFocus onClick={close}>{c("ok")}</button>
            </div>
          </div>
        ) : (
          <div className="confirm-panel">
            {confirmClassName === "danger-solid"
              ? <div className="confirm-icon" aria-hidden="true"><Trash2 size={18} strokeWidth={2.25} /></div>
              : <div className="confirm-icon info" aria-hidden="true"><Info size={18} strokeWidth={2.25} /></div>}
            <h2 className="confirm-title">{title}</h2>
            {detail && <p className="confirm-detail">{detail}</p>}
            <form action={action} className="confirm-actions">
              {children}
              <button type="button" className="ghost" autoFocus disabled={pending} onClick={close}>
                {c("cancel")}
              </button>
              <button type="submit" className={confirmClassName} disabled={pending}>
                {pending ? pendingLabel : confirmLabel}
              </button>
            </form>
          </div>
        )}
      </dialog>
    </>
  );
}

/**
 * ConfirmDelete with its own action state, for a server action that is not
 * already wired to a row's state — a page can drop it in as it is.
 */
export function DeleteButton({ action, ...rest }: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult | void>;
} & Omit<Parameters<typeof ConfirmDelete>[0], "action" | "pending" | "error">) {
  const router = useRouter();
  const t = useTranslations("common");
  const [state, run, pending] = useActionState<ActionResult | void | null, FormData>(action as never, null);
  useNotice(state, { ok: t("noticeDeleted"), errors: false });
  useEffect(() => { if (state && "ok" in state) router.refresh(); }, [state, router]);
  return <ConfirmDelete action={run} pending={pending} error={state && "error" in state ? state.error : null} {...rest} />;
}

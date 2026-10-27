"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/actions";

/** A form posting to a server action, with its error shown above the button. */
export function FaActionForm({ action, children, submit, disabled }: {
  action: (p: unknown, fd: FormData) => Promise<ActionResult>; children: React.ReactNode; submit: string; disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action as never, null);
  return (
    <form action={formAction} className="fam-form">
      {state && "error" in state && <div className="alert" role="alert">{state.error}</div>}
      {children}
      <div className="fam-go"><button className="ie-btn primary" disabled={pending || disabled}>{pending ? "Posting…" : submit}</button></div>
    </form>
  );
}

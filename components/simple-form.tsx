"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/actions";

/** Wraps a server action so validation errors render above the fields. */
export function SimpleForm({
  action,
  submitLabel,
  children,
}: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  submitLabel: string;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never,
    null
  );

  return (
    <form action={formAction} className="form">
      {state && "error" in state && <div className="alert">{state.error}</div>}
      {children}
      <div className="actions">
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

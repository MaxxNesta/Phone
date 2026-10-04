"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/actions";

/** A one-click delivery against a pending invoice, with the error actually visible on failure. */
export function DeliverNowButton({
  invoiceId,
  action,
}: {
  invoiceId: string;
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never,
    null
  );
  const [dismissed, setDismissed] = useState(false);

  return (
    <>
      <form action={formAction}>
        <input type="hidden" name="invoice_id" value={invoiceId} />
        <button type="submit" className="ghost tiny" disabled={pending}>
          {pending ? "Delivering…" : "Deliver now"}
        </button>
      </form>
      {state && "error" in state && !dismissed && (
        <div className="hint" style={{ color: "var(--bad)", maxWidth: 260 }}>
          {state.error}{" "}
          <button type="button" className="ghost tiny" onClick={() => setDismissed(true)}>Dismiss</button>
        </div>
      )}
    </>
  );
}

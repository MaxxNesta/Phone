"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/actions";

/** A new life or residual from a month on; what is posted stays as it was. */
export function EstimateForm({ action, assetId, from, life, residual }: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  assetId: string; from: string; life: number; residual: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action as never, null);
  return (
    <form action={formAction} className="fa-estimate">
      <input type="hidden" name="id" value={assetId} />
      {state && "error" in state && <div className="alert" role="alert">{state.error}</div>}
      {state && "ok" in state && <p className="fa-ok" role="status">Saved. The schedule from that month uses the new estimate.</p>}
      <div className="ie-grid4">
        <label className="ie-field"><span>From month</span><input type="month" name="effective_month" min={from} defaultValue={from} required /></label>
        <label className="ie-field"><span>Useful life, total (months)</span>
          <input type="number" name="useful_life_months" min={1} max={1200} defaultValue={life} required /></label>
        <label className="ie-field"><span>Residual value</span>
          <span className="ie-money"><i>MMK</i><input name="residual_value" defaultValue={residual} inputMode="decimal" required /></span></label>
        <label className="ie-field"><span>Reason</span><input name="reason" required placeholder="e.g. expected to last longer" /></label>
      </div>
      <div className="fa-estimate-go">
        <span className="ie-note">Prospective: months already on the ledger are not changed. The rest of the life absorbs the difference.</span>
        <button className="ie-btn primary" disabled={pending}>{pending ? "Saving…" : "Save change of estimate"}</button>
      </div>
    </form>
  );
}

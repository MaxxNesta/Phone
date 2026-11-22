"use client";

import { useActionState } from "react";
import { writeOffClearingAction, reverseClearingWriteOffAction } from "@/lib/landed-cost-actions";
import { ConfirmDelete } from "./confirm-delete";
import { useNotice } from "@/components/toast";

/** Write off what is left of one bill line, or reverse a write-off: asked in the app's own dialog, with a reason. */
export function ClearingWriteOff({ lineId, writeOffId, label, title }: {
  lineId?: string; writeOffId?: string; label: string; title: string;
}) {
  const [state, act, pending] = useActionState(writeOffId ? reverseClearingWriteOffAction : writeOffClearingAction, null);
  useNotice(state, { errors: false });
  return (
    <ConfirmDelete action={act} pending={pending} error={state?.error ?? null}
      className="btn ghost tiny" label={label} pendingLabel="Working…"
      title={title} confirmLabel={label} confirmClassName="danger-solid">
      {lineId && <input type="hidden" name="line_id" value={lineId} />}
      {writeOffId && <input type="hidden" name="id" value={writeOffId} />}
      <div className="field" style={{ width: "100%", textAlign: "left" }}>
        <label htmlFor={`wo-${lineId ?? writeOffId}`} className="lbl">Why</label>
        <input id={`wo-${lineId ?? writeOffId}`} name="reason" required
          placeholder={writeOffId ? "e.g. The bill turned up for a later shipment" : "e.g. Duty refund never came, nothing to spread"} />
      </div>
    </ConfirmDelete>
  );
}

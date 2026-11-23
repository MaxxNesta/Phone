"use client";

import { useActionState } from "react";
import { ConfirmDelete } from "./confirm-delete";
import { useNotice } from "@/components/toast";
import { courierCollectedAction } from "@/lib/courier-actions";

/**
 * Cash on delivery by courier (0232): the courier reports the parcel
 * delivered and paid. The customer's debt is settled and the courier owes
 * the money, in COD Receivable under its name, until it pays it in.
 */
export function CourierCollect({ invoiceId, docNo, owed, today, courier }: {
  invoiceId: string; docNo: string; owed: number; today: string; courier: string;
}) {
  const [state, act, pending] = useActionState(courierCollectedAction, null);
  useNotice(state, { errors: false });
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (
    <ConfirmDelete action={act} pending={pending} error={state?.error ?? null}
      className="btn primary" label="Courier collected" pendingLabel="Posting…"
      title={`${courier} collected ${docNo}?`}
      detail={`The customer has paid ${fmt(owed)} to ${courier}. It moves to COD Receivable under ${courier} until the courier pays it in.`}
      confirmLabel="Mark collected" confirmClassName="">
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <div className="cod-collect">
        <div className="field">
          <label htmlFor="cc-date">Collected on</label>
          <input id="cc-date" name="doc_date" type="date" defaultValue={today} max={today} required />
        </div>
      </div>
    </ConfirmDelete>
  );
}

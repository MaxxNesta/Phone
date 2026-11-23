"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDelete } from "./confirm-delete";
import { useNotice } from "@/components/toast";
import { confirmDeliveredAction } from "@/lib/cod-actions";

/** A credit sale's delivery reached the customer (0233): until someone says so, it is only dispatched. */
export function ConfirmDelivered({ deliveryId, deliveryNo }: { deliveryId: string; deliveryNo: string }) {
  const router = useRouter();
  const [state, run, pending] = useActionState(confirmDeliveredAction, null);
  useNotice(state, { errors: false });
  useEffect(() => { if (state?.ok) router.refresh(); }, [state, router]);
  return (
    <ConfirmDelete action={run} pending={pending} error={state?.error ?? null} failTitle="Not done"
      className="btn primary" label="Confirm delivered" pendingLabel="Saving…" confirmClassName=""
      title={`${deliveryNo} reached the customer?`}
      detail="Records that the goods arrived. Until then the invoice shows them out for delivery."
      confirmLabel="Delivered">
      <input type="hidden" name="delivery_id" value={deliveryId} />
    </ConfirmDelete>
  );
}

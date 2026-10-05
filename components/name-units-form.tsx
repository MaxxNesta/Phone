"use client";

import { useActionState } from "react";
import { nameUnitsOnShelf } from "@/lib/phone-actions";

export function NameUnitsForm({ itemId, locationId, unnamed }: {
  itemId: string; locationId: string; unnamed: number;
}) {
  const [state, action, pending] = useActionState(nameUnitsOnShelf, null);
  return (
    <form action={action} className="name-units">
      <input type="hidden" name="item_id" value={itemId} />
      <input type="hidden" name="location_id" value={locationId} />
      <textarea name="imeis" rows={3} required aria-label="IMEIs, one phone per line"
        placeholder={`Scan up to ${unnamed} — one phone per line (IMEI1 IMEI2 for dual SIM)`} />
      <button className="btn" disabled={pending}>{pending ? "Saving…" : "Save IMEIs"}</button>
      {state?.error && <p className="hint" role="alert" style={{ color: "var(--bad, #b42318)" }}>{state.error}</p>}
      {state?.ok && <p className="hint" role="status">{state.ok}</p>}
    </form>
  );
}

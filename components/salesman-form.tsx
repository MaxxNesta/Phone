"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/actions";

type Location = { id: string; code: string; name: string };

export function AddSalesmanForm({
  action,
  locations,
}: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  locations: Location[];
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never,
    null
  );
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="actions">
        <button type="button" onClick={() => setOpen(true)}>+ Salesperson</button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>New salesperson</h2>
        <span className="actions">
          <button type="button" className="ghost tiny" onClick={() => setOpen(false)}>Cancel</button>
        </span>
      </div>
      <div className="card-body">
        <form action={formAction} className="form">
          {state && "error" in state && <div className="alert">{state.error}</div>}

          <div className="row">
            <div className="field">
              <label htmlFor="code">Code</label>
              <input id="code" name="code" type="text" required autoFocus placeholder="SP01" />
            </div>
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" name="name" type="text" required placeholder="Aung Aung" />
            </div>
            <div className="field">
              <label htmlFor="name_my">Name (Burmese)</label>
              <input id="name_my" name="name_my" type="text" />
            </div>
            <div className="field">
              <label htmlFor="phone">Phone</label>
              <input id="phone" name="phone" type="text" placeholder="09…" />
            </div>
            <div className="field">
              <label htmlFor="location_id">Branch</label>
              <select id="location_id" name="location_id" defaultValue="">
                <option value="">— none —</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.code} · {l.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="commission_pct">Commission %</label>
              <input id="commission_pct" name="commission_pct" type="number" min="0" step="any" placeholder="0" />
              <span className="hint">Reported on, not paid automatically</span>
            </div>
          </div>

          <div className="actions" style={{ marginTop: "0.75rem" }}>
            <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save salesperson"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

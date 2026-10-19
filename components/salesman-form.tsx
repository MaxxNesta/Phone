"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/actions";
import { useTranslations } from "next-intl";

type Location = { id: string; code: string; name: string };

export function AddSalesmanForm({
  action,
  locations,
}: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  locations: Location[];
}) {
  const c = useTranslations("common");
  const f = useTranslations("itemForm");
  const pt = useTranslations("partners");
  const s = useTranslations("salespersons");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never,
    null
  );
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="actions">
        <button type="button" onClick={() => setOpen(true)}>{s("plus")}</button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>{s("new")}</h2>
        <span className="actions">
          <button type="button" className="ghost tiny" onClick={() => setOpen(false)}>{c("cancel")}</button>
        </span>
      </div>
      <div className="card-body">
        <form action={formAction} className="form">
          {state && "error" in state && <div className="alert">{state.error}</div>}

          <div className="row">
            <div className="field">
              <label htmlFor="code">{c("code")}</label>
              <input id="code" name="code" type="text" required autoFocus placeholder="SP01" />
            </div>
            <div className="field">
              <label htmlFor="name">{c("name")}</label>
              <input id="name" name="name" type="text" required placeholder="Aung Aung" />
            </div>
            <div className="field">
              <label htmlFor="name_my">{f("nameBurmese")}</label>
              <input id="name_my" name="name_my" type="text" />
            </div>
            <div className="field">
              <label htmlFor="phone">{pt("phone")}</label>
              <input id="phone" name="phone" type="text" placeholder="09…" />
            </div>
            <div className="field">
              <label htmlFor="location_id">{s("branch")}</label>
              <select id="location_id" name="location_id" defaultValue="">
                <option value="">{f("noneOption")}</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.code} · {l.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="commission_pct">{s("commission")}</label>
              <input id="commission_pct" name="commission_pct" type="number" min="0" step="any" placeholder="0" />
              <span className="hint">{s("commissionHint")}</span>
            </div>
          </div>

          <div className="actions" style={{ marginTop: "0.75rem" }}>
            <button type="submit" disabled={pending}>{pending ? c("saving") : s("save")}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

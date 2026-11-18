"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/actions";
import { useTranslations } from "next-intl";
import { useNotice } from "@/components/toast";
import { UnitRules } from "./unit-rules";

export function AddUnitForm({
  action, rulesFrom, standardAction,
}: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  /** A spare-parts shop: every unit, for the Equals and Whole rules (0214). */
  rulesFrom?: { id: string; code: string; name: string; ref_uom_id?: string | null }[];
  /** A spare-parts shop: add the usual measures in one click. */
  standardAction?: (prev: unknown, fd: FormData) => Promise<ActionResult>;
}) {
  const c = useTranslations("common");
  const f = useTranslations("itemForm");
  const pt = useTranslations("partners");
  const u = useTranslations("units");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never,
    null
  );
  useNotice(state);
  const [open, setOpen] = useState(false);
  const [stdState, stdAction, stdPending] = useActionState<ActionResult | null, FormData>(
    (standardAction ?? action) as never, null);
  useNotice(stdState);

  if (!open) {
    return (
      <div className="actions">
        <button type="button" onClick={() => setOpen(true)}>{u("plusUnit")}</button>
        {standardAction && (
          <form action={stdAction} style={{ display: "inline" }}>
            <button type="submit" className="ghost" disabled={stdPending}
                    title="M, CM, MM, IN, FT, YD · L, ML, GAL · KG, G, LB · PCS, SET, PAIR (whole)">
              {stdPending ? c("saving") : "Add standard units"}
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>{u("new")}</h2>
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
              <input id="code" name="code" type="text" required autoFocus placeholder="BTL" />
              <span className="hint">{u("codeHint")}</span>
            </div>
            <div className="field">
              <label htmlFor="name">{c("name")}</label>
              <input id="name" name="name" type="text" required placeholder="Bottle" />
              <span className="hint">
                Written out in full &mdash; the importer matches on this, and will not
                read &ldquo;Btl&rdquo; as &ldquo;Bottle&rdquo;.
              </span>
            </div>
            <div className="field">
              <label htmlFor="name_my">{f("nameBurmese")}</label>
              <input id="name_my" name="name_my" type="text" />
            </div>
          </div>

          {rulesFrom && <UnitRules units={rulesFrom} />}
          <div className="actions">
            <button type="submit" disabled={pending}>{pending ? c("saving") : u("save")}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

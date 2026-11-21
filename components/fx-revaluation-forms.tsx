"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { postFxRevaluationAction, voidFxRevaluationAction } from "@/lib/fx-actions";

/** Posts the run previewed on the page, at exactly the rates it was previewed at. */
export function PostRevaluation({ periodEnd, rates, label }: { periodEnd: string; rates: Record<string, number>; label: string }) {
  const [state, action, pending] = useActionState(postFxRevaluationAction, null);
  return (
    <form action={action}>
      {state?.error && <div className="alert">{state.error}</div>}
      <input type="hidden" name="period_end" value={periodEnd} />
      {Object.entries(rates).map(([cur, r]) => <input key={cur} type="hidden" name={`rate_${cur}`} value={r} />)}
      <button className="btn tiny" disabled={pending}>{label}</button>
    </form>
  );
}

/** Voids a run, with a reason, so the month can be run again. */
export function VoidRevaluation({ id }: { id: string }) {
  const t = useTranslations("finance");
  const [state, action, pending] = useActionState(voidFxRevaluationAction, null);
  return (
    <form action={action} className="filter-row" style={{ alignItems: "flex-end" }}>
      {state?.error && <div className="alert">{state.error}</div>}
      <input type="hidden" name="revaluation_id" value={id} />
      <div className="field">
        <label htmlFor="reason">{t("fxr.voidReason")}</label>
        <input id="reason" name="reason" required placeholder={t("fxr.voidPlaceholder")} />
      </div>
      <button className="btn warn" disabled={pending}>{t("fxr.void")}</button>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { openWarrantyClaim, closeWarrantyClaim } from "@/lib/warranty-claims";

/** What is wrong with the phone, and open the claim (0221). */
export function OpenClaimForm({ serialId }: { serialId: string }) {
  const t = useTranslations("inventory");
  const [state, action, pending] = useActionState(openWarrantyClaim, null);
  return (
    <form action={action} className="card">
      <div className="card-body">
        {state?.error && <div className="alert">{state.error}</div>}
        <input type="hidden" name="serial_id" value={serialId} />
        <div className="field">
          <label htmlFor="fault">{t("claims.fault")}</label>
          <textarea id="fault" name="fault" rows={3} required placeholder={t("claims.faultPlaceholder")} />
        </div>
        <button className="btn" disabled={pending}>{t("claims.open")}</button>
      </div>
    </form>
  );
}

/** How the claim ended. Turned down needs a reason. */
export function CloseClaimForm({ claimId }: { claimId: string }) {
  const t = useTranslations("inventory");
  const [state, action, pending] = useActionState(closeWarrantyClaim, null);
  return (
    <form action={action} className="card">
      <div className="card-head"><h2>{t("claims.closeTitle")}</h2></div>
      <div className="card-body">
        {state?.error && <div className="alert">{state.error}</div>}
        <input type="hidden" name="claim_id" value={claimId} />
        <div className="field">
          <label>{t("claims.outcome")}</label>
          <div className="choice-list" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            {(["REPAIRED", "REPLACED", "REFUNDED", "REJECTED"] as const).map((o) => (
              <label key={o} className="choice">
                <input type="radio" name="outcome" value={o} required />
                <span>{t(`claims.out.${o}`)}<small>{t(`claims.outSub.${o}`)}</small></span>
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="note">{t("claims.note")}</label>
          <textarea id="note" name="note" rows={2} placeholder={t("claims.notePlaceholder")} />
        </div>
        <button className="btn" disabled={pending}>{t("claims.close")}</button>
      </div>
    </form>
  );
}

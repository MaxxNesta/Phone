"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Credit allowed, then — only if it is — the terms and the limit. No is the
 * cash-only customer the books already know as a limit of 0; Yes with the
 * limit left blank is credit with no ceiling. The terms keep their value
 * while hidden, since a supplier's bills still fall due by them.
 */
export function CreditFields({ defaultLimit, defaultTerms, limitHint }: {
  defaultLimit: string | number | null; defaultTerms: number; limitHint: string;
}) {
  const t = useTranslations("partners");
  const [allowed, setAllowed] = useState(!(defaultLimit !== null && defaultLimit !== "" && Number(defaultLimit) === 0));
  const [terms, setTerms] = useState(String(defaultTerms));
  const [limit, setLimit] = useState(allowed && defaultLimit !== null ? String(defaultLimit) : "");

  return (
    <>
      <div className="field">
        <label id="credit-allowed-l">{t("creditAllowed")}</label>
        <div className="segmented" role="radiogroup" aria-labelledby="credit-allowed-l">
          <button type="button" role="radio" aria-checked={allowed} className={`seg${allowed ? " on" : ""}`}
            onClick={() => setAllowed(true)}>{t("yes")}</button>
          <button type="button" role="radio" aria-checked={!allowed} className={`seg${!allowed ? " on" : ""}`}
            onClick={() => setAllowed(false)}>{t("no")}</button>
        </div>
        <span className="hint">{allowed ? t("creditAllowedYesHint") : t("creditAllowedNoHint")}</span>
      </div>
      {allowed ? (
        <>
          <div className="field">
            <label htmlFor="payment_terms_days">{t("paymentTerms")}</label>
            <input id="payment_terms_days" name="payment_terms_days" type="number" min="0"
              value={terms} onChange={(e) => setTerms(e.target.value)} />
            <span className="hint">{t("paymentTermsHint")}</span>
          </div>
          <div className="field">
            <label htmlFor="credit_limit">{t("creditLimit")}</label>
            <input id="credit_limit" name="credit_limit" type="number" min="0" step="any"
              value={limit} onChange={(e) => setLimit(e.target.value)} />
            <span className="hint">{limitHint}</span>
          </div>
        </>
      ) : (
        <>
          <input type="hidden" name="credit_limit" value="0" />
          <input type="hidden" name="payment_terms_days" value={terms} />
        </>
      )}
    </>
  );
}

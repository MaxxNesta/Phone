"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/actions";
import { useTranslations } from "next-intl";

/**
 * Adding a way products vary.
 *
 * Two fields, because a third would be asking for something nobody knows at
 * this point: the values come after, on the card this creates.
 */
export function AddAttributeForm({
  action,
}: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
}) {
  const t = useTranslations("attributes");
  const c = useTranslations("common");
  const f = useTranslations("itemForm");
  const [state, formAction, pending] =
    useActionState<ActionResult | null, FormData>(action as never, null);

  return (
    <section className="card">
      <div className="card-head">
        <h2>{t("addTitle")}</h2>
        <span className="page-sub">{t("addSub")}</span>
      </div>
      <div className="card-body">
        {state && "error" in state && <div className="alert">{state.error}</div>}
        <form action={formAction} className="attradd">
          <div className="field">
            <label htmlFor="attr_code">{c("code")}</label>
            <input id="attr_code" name="code" placeholder="SIZE" required
                   style={{ textTransform: "uppercase" }} />
          </div>
          <div className="field">
            <label htmlFor="attr_name">{c("name")}</label>
            <input id="attr_name" name="name" placeholder="Size" required />
          </div>
          <div className="field">
            <label htmlFor="attr_name_my">{f("nameBurmese")}</label>
            <input id="attr_name_my" name="name_my" />
          </div>
          <button type="submit" className="btn" disabled={pending}>
            {pending ? t("adding") : t("addAttribute")}
          </button>
        </form>
      </div>
    </section>
  );
}

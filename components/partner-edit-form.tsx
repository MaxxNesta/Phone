"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import type { ActionResult } from "@/lib/actions";
import { REGION_GROUPS } from "@/lib/regions";
import { useTranslations } from "next-intl";

export type Partner = {
  id: string; code: string; name: string; name_my: string | null; company_name: string | null;
  member_card_id: string | null;
  contact_person?: string | null; email?: string | null; notes?: string | null;
  created_at?: string | Date | null;
  is_customer: boolean; is_supplier: boolean; is_active: boolean;
  region: string | null;
  /** Which column of the price list this customer buys from. */
  price_level_id: string | null; price_level_name: string | null;
  category_id: string | null; category_name: string | null;
  supplier_category_id: string | null; supplier_category_name: string | null;
  township: string | null; address: string | null; phone: string | null;
  payment_terms_days: number;
  /** What they bill or pay in; null is the company's own. */
  currency?: string | null;
  /** Typed override, used only until receipts can be measured. */
  lead_time_days: number | null; credit_limit: string | null; outstanding: string;
  /** From v_customer_credit — what the limit is being used for, and what is
   *  left of it. Null for a partner who is not a customer. */
  exposure: string | null; available: string | null;
};

/** Editing a partner: inline on the list, and from the customer panel. */
export function PartnerEditForm({
  partner, priceLevels = [], categories = [], supplierCategories = [], updateAction, onCancel,
}: {
  partner: Partner;
  /** The company's price columns, so a customer can be put on one. */
  priceLevels?: { id: string; name: string }[];
  categories?: { id: string; name: string }[];
  supplierCategories?: { id: string; name: string }[];
  updateAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  onCancel: () => void;
}) {
  const role = useSearchParams().get("role") ?? "";
  const t = useTranslations("partners");
  const c = useTranslations("common");
  const f = useTranslations("itemForm");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    updateAction as never,
    null
  );

  return (
    <form action={formAction} className="form" style={{ padding: "0.5rem 0" }}>
      {/* Which list this edit came from, so saving returns to it
          rather than to the unfiltered one. */}
      {role && <input type="hidden" name="role" value={role} />}
      {state && "error" in state && <div className="alert">{state.error}</div>}
      <input type="hidden" name="id" value={partner.id} />
      <div className="row">
        <div className="field">
          <label>{c("code")}</label>
          <input name="code" type="text" defaultValue={partner.code} required />
        </div>
        <div className="field">
          <label>{c("name")}</label>
          <input name="name" type="text" defaultValue={partner.name} required />
        </div>
        <div className="field">
          <label>{f("nameBurmese")}</label>
          <input name="name_my" type="text" defaultValue={partner.name_my ?? ""} />
        </div>
        <div className="field">
          <label>{t("companyName")}</label>
          <input name="company_name" type="text" defaultValue={partner.company_name ?? ""} />
        </div>
        <div className="field">
          <label>{t("memberCard")}</label>
          <input name="member_card_id" type="text" defaultValue={partner.member_card_id ?? ""} />
        </div>
        <div className="field">
          <label>{t("contactPerson")}</label>
          <input name="contact_person" type="text" defaultValue={partner.contact_person ?? ""} />
        </div>
        <div className="field">
          <label>{t("email")}</label>
          <input name="email" type="email" defaultValue={partner.email ?? ""} />
        </div>
        <div className="field">
          <label>{t("region")}</label>
          <select name="region" defaultValue={partner.region ?? ""}>
            <option value="">{t("notSet")}</option>
            {REGION_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((r) => <option key={r} value={r}>{r}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{t("township")}</label>
          <input name="township" type="text" defaultValue={partner.township ?? ""} />
        </div>
        <div className="field">
          <label>{t("address")}</label>
          <input name="address" type="text" defaultValue={partner.address ?? ""} />
        </div>
        <div className="field">
          <label>{t("phone")}</label>
          <input name="phone" type="text" defaultValue={partner.phone ?? ""} />
        </div>
        <div className="field">
          <label>{t("paymentTerms")}</label>
          <input name="payment_terms_days" type="number" min="0" defaultValue={partner.payment_terms_days} />
        </div>
        <div className="field">
          <label>{t("currency")}</label>
          <input name="currency" list="currency-codes" maxLength={3} placeholder="MMK"
            defaultValue={partner.currency ?? ""} style={{ textTransform: "uppercase" }} />
        </div>
        {/* An override, not the figure itself. Replenishment measures
            how long this supplier has actually taken and uses that
            once there are two receipts to go on — a number typed here
            is for a supplier nobody has bought from yet. */}
        {partner.is_supplier && (
          <div className="field">
            <label>{t("leadTime")}</label>
            <input name="lead_time_days" type="number" min="0" max="365"
                   placeholder={t("leadTimePlaceholder")}
                   defaultValue={partner.lead_time_days ?? ""} />
            <span className="hint">{t("leadTimeHint")}</span>
          </div>
        )}
        {/* Which column of the price list this customer buys from.
            Only meaningful for a customer, and only worth asking when
            the company keeps more than one column. */}
        {partner.is_customer && priceLevels.length > 1 && (
          <div className="field">
            <label>{t("priceLevel")}</label>
            <select name="price_level_id" defaultValue={partner.price_level_id ?? ""}>
              <option value="">{t("defaultLevel", { name: priceLevels[0]?.name ?? "" })}</option>
              {priceLevels.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <span className="hint">{t("priceLevelLineHint")}</span>
          </div>
        )}
        {/* Says what the shop is, not what it gets. Kept apart from
            the price level on purpose: one is a classification, the
            other is a price. */}
        {categories.length > 0 && (
          <div className="field">
            <label>{c("category")}</label>
            <select name="category_id" defaultValue={partner.category_id ?? ""}>
              <option value="">{t("notCategorised")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <span className="hint">{t("catReportsOnly")}</span>
          </div>
        )}
        {partner.is_supplier && supplierCategories.length > 0 && (
          <div className="field">
            <label>{t("supplierCategory")}</label>
            <select name="supplier_category_id"
                    defaultValue={partner.supplier_category_id ?? ""}>
              <option value="">{t("notCategorised")}</option>
              {supplierCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <span className="hint">{t("supplierCatShort")}</span>
          </div>
        )}
        <div className="field">
          <label>{t("creditLimit")}</label>
          <input name="credit_limit" type="number" min="0" defaultValue={partner.credit_limit ?? ""} />
          <span className="hint">{t("creditLimitRowHint")}</span>
        </div>
      </div>
      <div className="field" style={{ marginTop: "0.4rem" }}>
        <label>{t("notes")}</label>
        <textarea name="notes" rows={2} defaultValue={partner.notes ?? ""} />
      </div>
      <div style={{ display: "flex", gap: "1rem", marginTop: "0.4rem" }}>
        <label className="check">
          <input name="is_customer" type="checkbox" defaultChecked={partner.is_customer} />
          {t("customer")}
        </label>
        <label className="check">
          <input name="is_supplier" type="checkbox" defaultChecked={partner.is_supplier} />
          {t("supplier")}
        </label>
        <label className="check">
          <input name="is_active" type="checkbox" defaultChecked={partner.is_active} />
          {c("active")}
        </label>
      </div>
      <div className="actions" style={{ marginTop: "0.5rem" }}>
        <button type="submit" disabled={pending}>{pending ? c("saving") : c("save")}</button>
        <button type="button" className="ghost tiny" onClick={onCancel}>{c("cancel")}</button>
      </div>
    </form>
  );
}

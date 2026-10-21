"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ActionResult } from "@/lib/actions";
import { ConfirmDelete } from "./confirm-delete";
import { RowMenu } from "./row-menu";
import { REGION_GROUPS } from "@/lib/regions";
import { useTranslations } from "next-intl";

// lib/db.ts opens a real Postgres connection at import time — never import
// it into a client component. Same formatting as money() there, kept local.
const money = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

type Partner = {
  id: string; code: string; name: string; name_my: string | null; company_name: string | null;
  member_card_id: string | null;
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

export function PartnerRow({
  partner,
  priceLevels = [],
  categories = [],
  supplierCategories = [],
  updateAction,
  deleteAction,
  deactivateAction,
  activateAction,
}: {
  partner: Partner;
  /** The company's price columns, so a customer can be put on one. */
  priceLevels?: { id: string; name: string }[];
  categories?: { id: string; name: string }[];
  supplierCategories?: { id: string; name: string }[];
  updateAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  deleteAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  deactivateAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  activateAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
}) {
  const role = useSearchParams().get("role") ?? "";
  const t = useTranslations("partners");
  const c = useTranslations("common");
  const f = useTranslations("itemForm");
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    updateAction as never,
    null
  );
  const [, deactFormAction] = useActionState<ActionResult | null, FormData>(
    deactivateAction as never,
    null
  );
  const [, actFormAction] = useActionState<ActionResult | null, FormData>(
    activateAction as never,
    null
  );
  const [delState, delFormAction, delPending] = useActionState<ActionResult | null, FormData>(
    deleteAction as never,
    null
  );


  if (editing) {
    return (
      <tr>
        <td colSpan={7}>
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
                    <option value="">Not categorised</option>
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
                    <option value="">Not categorised</option>
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
              <button type="button" className="ghost tiny" onClick={() => setEditing(false)}>{c("cancel")}</button>
            </div>
          </form>
        </td>
      </tr>
    );
  }

  const dash = <span style={{ color: "var(--muted)" }}>—</span>;
  // The customer and supplier lists already say which they are; the role
  // column earns its place only on the list that mixes both. Member cards
  // are a customer thing.
  return (
    <tr>
      <td className="code">{partner.code}</td>
      <td className="wrap" title={partner.name}>
        <div className="clamp3">{partner.name}</div>
        {partner.name_my && <div className="subline">{partner.name_my}</div>}
      </td>
      <td className="wrap" title={partner.company_name ?? undefined}>
        {partner.company_name ? <div className="clamp3">{partner.company_name}</div> : dash}
      </td>
      {role !== "supplier" && <td>{partner.member_card_id ?? dash}</td>}
      {!role && (
        <td>
          {partner.is_customer && <span className="pill ok">{t("customer")}</span>}
          {partner.is_customer && partner.is_supplier && " "}
          {partner.is_supplier && <span className="pill warn">{t("supplier")}</span>}
        </td>
      )}
      <td>
        {partner.region ?? <span style={{ color: "var(--muted)" }}>—</span>}
      </td>
      <td className="wrap">
        {partner.township ? <div className="clamp3">{partner.township}</div> : dash}
      </td>
      <td>
        {partner.is_customer
          ? (partner.price_level_name
              ?? <span style={{ color: "var(--muted)" }}>{t("default")}</span>)
          : <span style={{ color: "var(--muted)" }}>—</span>}
      </td>
      {/* Both axes, because a partner that is both is two different
          things and one column would have to pick a side. */}
      <td className="wrap">
        {partner.category_name
          ?? <span style={{ color: "var(--muted)" }}>—</span>}
        {partner.supplier_category_name && (
          <div className="subline">{t("buys", { name: partner.supplier_category_name })}</div>
        )}
      </td>
      <td className="r">
        {Number(partner.payment_terms_days) === 0 && partner.is_customer && role !== "supplier"
          ? <span style={{ color: "var(--muted)" }}>{t("noCreditAllowed")}</span>
          : t("days", { n: partner.payment_terms_days })}
      </td>
      <td className="r">{Number(partner.outstanding) ? money(partner.outstanding) : "—"}</td>
      {/* What they may owe at once. Blank means nobody has set one; 0 is a
          real answer and means cash only.

          A supplier has neither: a credit limit is what we allow a customer
          to owe us, and printing "No limit" against a supplier would imply
          somebody had considered the question. */}
      <td className="r">
        {!partner.is_customer
          ? <span style={{ color: "var(--muted)" }}>—</span>
          : partner.credit_limit === null
            ? <span style={{ color: "var(--muted)" }}>{t("noLimit")}</span>
            : Number(partner.credit_limit) === 0
              ? <span className="pill warn">{t("noCreditAllowed")}</span>
              : money(partner.credit_limit)}
      </td>
      <td className="r">
        {partner.credit_limit === null || !partner.is_customer ? (
          <span style={{ color: "var(--muted)" }}>—</span>
        ) : Number(partner.available ?? 0) < 0 ? (
          <span className="pill overdue">{t("over", { amount: money(Math.abs(Number(partner.available))) })}</span>
        ) : (
          money(Number(partner.available ?? partner.credit_limit))
        )}
      </td>
      <td>{partner.is_active ? <span className="pill ok">{t("activeLower")}</span> : <span className="pill warn">{t("inactiveLower")}</span>}</td>
      {/* Behind a dot menu, as on the item list. Three buttons on every row
          made the actions column wider than the names, and this table now
          carries money that needs the width more — an amount that wraps is a
          figure somebody misreads. */}
      <td className="r">
        <RowMenu label={c("actionsFor", { name: partner.name })}>
          <button type="button" onClick={() => setEditing(true)}>{c("edit")}</button>
          {partner.is_active ? (
            <form action={deactFormAction}>
              <input type="hidden" name="id" value={partner.id} />
              <button type="submit" className="warn">{c("deactivate")}</button>
            </form>
          ) : (
            <form action={actFormAction}>
              <input type="hidden" name="id" value={partner.id} />
              <button type="submit">{c("reactivate")}</button>
            </form>
          )}
          <div className="rowmenu-sep" />
          <ConfirmDelete
            action={delFormAction}
            pending={delPending}
            error={delState && "error" in delState ? delState.error : null}
            title={c("deleteName", { name: partner.name })}
            detail={c("cannotUndo")}
            className="danger"
          >
            <input type="hidden" name="id" value={partner.id} />
          </ConfirmDelete>
        </RowMenu>
        {delState && "error" in delState && (
          <div className="hint" style={{ color: "var(--bad)" }}>{delState.error}</div>
        )}
      </td>
    </tr>
  );
}

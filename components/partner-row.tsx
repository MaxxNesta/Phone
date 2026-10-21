"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ActionResult } from "@/lib/actions";
import { ConfirmDelete } from "./confirm-delete";
import { RowMenu } from "./row-menu";
import { PartnerEditForm, type Partner } from "./partner-edit-form";
import { useTranslations } from "next-intl";

// lib/db.ts opens a real Postgres connection at import time — never import
// it into a client component. Same formatting as money() there, kept local.
const money = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });


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
  const [editing, setEditing] = useState(false);
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
          <PartnerEditForm partner={partner} priceLevels={priceLevels} categories={categories}
            supplierCategories={supplierCategories} updateAction={updateAction}
            onCancel={() => setEditing(false)} />
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

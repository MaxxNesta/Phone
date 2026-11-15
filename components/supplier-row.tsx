"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { ActionResult } from "@/lib/actions";
import { ConfirmDelete } from "./confirm-delete";
import { RowMenu } from "./row-menu";
import type { Partner } from "./partner-edit-form";
import { useSupplierPanel } from "./supplier-panel";
import { useNotice } from "@/components/toast";

const money = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * One supplier on the Suppliers list, compact like the customer row: who they
 * are, how to reach them, how long they take and what is owed to them.
 * Clicking anywhere that is not a control opens the supplier panel.
 */
export function SupplierRow({ partner, deactivateAction, activateAction, deleteAction }: {
  partner: Partner;
  deactivateAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  activateAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  deleteAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
}) {
  const t = useTranslations("partners");
  const sp = useTranslations("supplierPanel");
  const cp = useTranslations("customerPanel");
  const c = useTranslations("common");
  const { selected, open } = useSupplierPanel();
  const [, deactFormAction] = useActionState<ActionResult | null, FormData>(deactivateAction as never, null);
  const [, actFormAction] = useActionState<ActionResult | null, FormData>(activateAction as never, null);
  const [delState, delFormAction, delPending] = useActionState<ActionResult | null, FormData>(deleteAction as never, null);
  useNotice(delState, { ok: c("noticeDeleted"), errors: false });
  const terms = Number(partner.payment_terms_days) === 0 ? sp("payNow") : t("days", { n: partner.payment_terms_days });

  return (
    <tr
      className={`crow${selected === partner.id ? " is-selected" : ""}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button, input, select, form, .rowmenu, [role=menu]")) return;
        open(partner.id);
      }}
    >
      <td className="crow-who" title={[partner.code, partner.name, partner.name_my].filter(Boolean).join(" · ")}>
        <button type="button" className="crow-code" onClick={() => open(partner.id)}>{partner.code}</button>
        <div className="crow-name">{partner.name}</div>
        <div className="subline">{partner.supplier_category_name ?? cp("uncategorised")}</div>
      </td>
      <td className="crow-txt" title={[partner.contact_person, partner.phone].filter(Boolean).join(" · ") || undefined}>
        <div className="clamp1">{partner.contact_person ?? partner.company_name ?? "—"}</div>
        <div className="subline clamp1">{partner.phone ?? "—"}</div>
      </td>
      <td>{partner.currency ?? <span className="muted">{sp("homeCurrency")}</span>}</td>
      <td>{partner.lead_time_days === null ? <span className="muted">{sp("notSet")}</span> : t("days", { n: partner.lead_time_days })}</td>
      <td className="r">
        <div>{Number(partner.outstanding) ? money(partner.outstanding) : "0"}</div>
        <div className="subline">{terms}</div>
      </td>
      <td>{partner.is_active ? <span className="pill ok">{t("activeLower")}</span> : <span className="pill warn">{t("inactiveLower")}</span>}</td>
      <td className="r">
        <RowMenu label={c("actionsFor", { name: partner.name })}>
          <button type="button" onClick={() => open(partner.id)}>{cp("open")}</button>
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
      </td>
    </tr>
  );
}

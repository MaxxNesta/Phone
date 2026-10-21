"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { ActionResult } from "@/lib/actions";
import { ConfirmDelete } from "./confirm-delete";
import { RowMenu } from "./row-menu";
import type { Partner } from "./partner-edit-form";
import { creditState, useCustomerPanel } from "./customer-panel";

const money = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * One customer on the Customers list, compact: who they are in one cell,
 * where in another, and money in two. Clicking anywhere that is not a control
 * opens the customer panel.
 */
export function CustomerRow({ partner, deactivateAction, activateAction, deleteAction }: {
  partner: Partner;
  deactivateAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  activateAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  deleteAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
}) {
  const t = useTranslations("partners");
  const cp = useTranslations("customerPanel");
  const c = useTranslations("common");
  const { selected, open } = useCustomerPanel();
  const [, deactFormAction] = useActionState<ActionResult | null, FormData>(deactivateAction as never, null);
  const [, actFormAction] = useActionState<ActionResult | null, FormData>(activateAction as never, null);
  const [delState, delFormAction, delPending] = useActionState<ActionResult | null, FormData>(deleteAction as never, null);
  const cs = creditState(partner);
  const dash = <span className="muted">—</span>;
  const terms = Number(partner.payment_terms_days) === 0 ? t("noCreditAllowed") : t("days", { n: partner.payment_terms_days });

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
        <div className="subline">
          {partner.category_name ?? cp("uncategorised")} · {cp("idShort")}: {partner.member_card_id ?? "—"}
        </div>
      </td>
      <td className="crow-txt" title={partner.company_name ?? undefined}>
        {partner.company_name ? <div className="clamp2">{partner.company_name}</div> : dash}
      </td>
      <td className="crow-txt" title={[partner.township, partner.region].filter(Boolean).join(", ") || undefined}>
        <div className="clamp1">{partner.township ?? "—"}</div>
        <div className="subline clamp1">{partner.region ?? "—"}</div>
      </td>
      <td>{partner.price_level_name ?? <span className="muted">{t("default")}</span>}</td>
      <td className="r">
        <div>{Number(partner.outstanding) ? money(partner.outstanding) : "0"}</div>
        <div className="subline">{terms}</div>
      </td>
      <td className="r">
        {cs.kind === "UNLIMITED" ? <span className="muted">{cp("unlimited")}</span>
          : cs.kind === "NONE" ? <span className="muted">{cp("noCredit")}</span>
          : (
            <>
              <div>{money(cs.limit)}</div>
              <div className="subline">
                {cs.kind === "OVER"
                  ? <span className="pill overdue">{cp("overBy", { amount: money(-cs.left) })}</span>
                  : cp("left", { amount: money(cs.left) })}
              </div>
            </>
          )}
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
        {delState && "error" in delState && (
          <div className="hint" style={{ color: "var(--bad)" }}>{delState.error}</div>
        )}
      </td>
    </tr>
  );
}

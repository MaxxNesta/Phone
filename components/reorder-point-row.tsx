"use client";

import { useActionState, useEffect, useState } from "react";
import type { ActionResult } from "@/lib/actions";
import { ConfirmDelete } from "./confirm-delete";
import { useTranslations } from "next-intl";
import { useNotice } from "@/components/toast";

/**
 * One product's reorder point on the Stock page: the calculated one, or what
 * somebody set by hand — a floor (minimum only) or Min–max (minimum and
 * maximum). Editing sets the hand-typed figures; Remove takes them away and
 * the product goes back to its calculated point.
 */
export type ReorderPoint = {
  /** The item_reorder row, when figures were set by hand. */
  id: string | null;
  item_id: string; location_id: string | null;
  item_code: string; item_name: string; location_code: string;
  /** The reorder point in force: calculated, never below a floor; or the Min–max minimum. */
  rop: number;
  min: number | null; max: number | null;
  source: "calc" | "floor" | "minmax" | "manual";
};

const n = (v: number | null) => (v === null ? "—" : v.toLocaleString("en-US"));

export function ReorderPointRow({
  point,
  saveAction,
  deleteAction,
}: {
  point: ReorderPoint;
  /** Creates or updates the hand-typed figures for this item and warehouse. */
  saveAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  deleteAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
}) {
  const t = useTranslations("inventory");
  const c = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(saveAction as never, null);
  useNotice(state);
  useEffect(() => { if (state && "ok" in state) setEditing(false); }, [state]);
  const [delState, delFormAction, delPending] = useActionState<ActionResult | null, FormData>(deleteAction as never, null);
  useNotice(delState, { ok: c("noticeDeleted"), errors: false });

  const pill = { calc: "", floor: "warn", minmax: "posted", manual: "draft" }[point.source];

  if (editing && point.location_id) {
    return (
      <tr>
        <td className="code">{point.item_code}</td>
        <td className="wrap">{point.item_name}</td>
        <td colSpan={4}>
          <form action={formAction} className="rp-edit">
            <input type="hidden" name="item_id" value={point.item_id} />
            <input type="hidden" name="location_id" value={point.location_id} />
            <label>{t("stk.minQty")}
              <input name="min_qty" type="number" min="0" step="any" required autoFocus
                defaultValue={point.min ?? point.rop} />
            </label>
            <label>{t("stk.maxQty")}
              <input name="max_qty" type="number" min="0" step="any" defaultValue={point.max ?? ""} placeholder={t("rp.maxEmpty")} />
            </label>
            <button type="submit" className="ghost tiny" disabled={pending}>{pending ? c("saving") : c("save")}</button>
            <button type="button" className="ghost tiny" onClick={() => setEditing(false)}>{c("cancel")}</button>
            {state && "error" in state && <span className="rp-err">{state.error}</span>}
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="code">{point.item_code}</td>
      <td className="wrap">{point.item_name}</td>
      <td><span className={`pill ${pill}`}>{t(`stk.src.${point.source}`)}</span></td>
      <td className="r">{point.source === "manual" ? "—" : n(point.rop)}</td>
      <td className="r">{n(point.max)}</td>
      <td>
        <span className="actions">
          {point.location_id && (
            <button type="button" className="ghost tiny" onClick={() => setEditing(true)}>{point.id ? c("edit") : t("rp.set")}</button>
          )}
          {point.id && (
            <ConfirmDelete
              action={delFormAction}
              pending={delPending}
              error={delState && "error" in delState ? delState.error : null}
              title={t("rp.removeTitle", { name: point.item_name })}
              detail={t("rp.removeDetail")}
              label={t("rp.remove")}
              pendingLabel={t("rp.removing")}
              confirmLabel={t("rp.remove")}
            >
              <input type="hidden" name="id" value={point.id} />
            </ConfirmDelete>
          )}
        </span>
      </td>
    </tr>
  );
}

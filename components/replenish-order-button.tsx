"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/actions";
import { ConfirmDelete } from "./confirm-delete";
import { useTranslations } from "next-intl";

/**
 * Turning a supplier's list into a draft purchase order.
 *
 * Behind a confirmation, because it writes something: a draft appears on
 * the purchases page whether or not the order is ever placed, and a button
 * that quietly leaves rows behind is one people stop trusting.
 *
 * The same draft is reused for the same supplier, so pressing it twice
 * changes one order rather than making two. The dialog says so, since
 * "created" and "updated" are different things to be told.
 */
export function ReplenishOrderButton({
  action, supplierId, supplierName, lines,
}: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  supplierId: string | null;
  supplierName: string;
  /** What to put on it: item, how many, the last price paid if known, and
   *  the lead-time assumption to freeze onto the line. */
  lines: {
    itemId: string; qty: number; unitPrice?: number;
    leadDays?: number; leadSource?: string;
  }[];
}) {
  const t = useTranslations("inventory");
  const [state, formAction, pending] =
    useActionState<ActionResult | null, FormData>(action as never, null);

  const count = lines.length;

  return (
    <>
      <ConfirmDelete
        action={formAction as never}
        pending={pending}
        error={state && "error" in state ? state.error : null}
        title={t("rep.draftTitle", { name: supplierName })}
        detail={t("rep.draftDetail", { n: count, name: supplierName })}
        label={t("rep.draftLabel")}
        pendingLabel={t("rep.drafting")}
        confirmLabel={t("rep.createDraft")}
        className="btn ghost"
        confirmClassName=""
      >
        <input type="hidden" name="supplier_id" value={supplierId ?? ""} />
        <input type="hidden" name="suggestions" value={JSON.stringify(lines)} />
      </ConfirmDelete>
      {state && "error" in state && <div className="alert">{state.error}</div>}
    </>
  );
}

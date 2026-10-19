"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/actions";
import { ConfirmDelete } from "./confirm-delete";
import { useTranslations } from "next-intl";

export type PriceLevel = {
  id: string; code: string; name: string; sort_order: number;
  /** How much is riding on this level, so the row can say so before it is changed. */
  prices?: number; partners?: number;
};

/**
 * Setup creates Wholesale and Retail and there was no way to add a third,
 * so a business with a staff price or an export price had nowhere to put
 * it. Collapsed until asked for, like the unit form, because the common
 * visit to this page is to change a price rather than to add a level.
 */
export function AddPriceLevelForm({
  action,
}: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never,
    null
  );
  const c = useTranslations("common");
  const f = useTranslations("itemForm");
  const pt = useTranslations("partners");
  const pr = useTranslations("prices");
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="actions">
        <button type="button" onClick={() => setOpen(true)}>{pr("plusLevel")}</button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>{pr("newLevel")}</h2>
        <span className="actions">
          <button type="button" className="ghost tiny" onClick={() => setOpen(false)}>{c("cancel")}</button>
        </span>
      </div>
      <div className="card-body">
        <form action={formAction} className="form">
          {state && "error" in state && <div className="alert">{state.error}</div>}

          <div className="row">
            <div className="field">
              <label htmlFor="pl-code">{c("code")}</label>
              <input id="pl-code" name="code" type="text" required autoFocus placeholder="STAFF" />
              <span className="hint">{pr("codeHint")}</span>
            </div>
            <div className="field">
              <label htmlFor="pl-name">{c("name")}</label>
              <input id="pl-name" name="name" type="text" required placeholder="Staff price" />
              <span className="hint">{pr("nameHint")}</span>
            </div>
          </div>

          <div className="actions">
            <button type="submit" disabled={pending}>
              {pending ? c("saving") : pr("saveLevel")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function PriceLevelRow({
  level, first, updateAction, deleteAction,
}: {
  level: PriceLevel;
  /** The level customers on no level are quoted — worth saying out loud. */
  first: boolean;
  updateAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  deleteAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
}) {
  const c = useTranslations("common");
  const f = useTranslations("itemForm");
  const pr = useTranslations("prices");
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    updateAction as never,
    null
  );
  const [delState, delFormAction, delPending] = useActionState<ActionResult | null, FormData>(
    deleteAction as never,
    null
  );

  const inUse = (level.prices ?? 0) > 0 || (level.partners ?? 0) > 0;

  if (editing) {
    return (
      <tr>
        <td colSpan={5}>
          <form action={formAction} className="form" style={{ padding: "0.5rem 0" }}>
            {state && "error" in state && <div className="alert">{state.error}</div>}
            <input type="hidden" name="id" value={level.id} />
            <div className="row">
              <div className="field">
                <label>{c("code")}</label>
                <input name="code" type="text" defaultValue={level.code} required />
              </div>
              <div className="field">
                <label>{c("name")}</label>
                <input name="name" type="text" defaultValue={level.name} required />
              </div>
              <div className="field">
                <label>{c("order")}</label>
                <input name="sort_order" type="number" min={1} step={1}
                       defaultValue={level.sort_order} required />
                <span className="hint">{pr("orderHint")}</span>
              </div>
            </div>
            {inUse && (
              <div className="hint" style={{ marginTop: "0.4rem" }}>
                {pr("inUse", { prices: level.prices ?? 0, partners: level.partners ?? 0 })}
              </div>
            )}
            <div className="actions" style={{ marginTop: "0.5rem" }}>
              <button type="submit" disabled={pending}>{pending ? c("saving") : c("save")}</button>
              <button type="button" className="ghost tiny"
                      onClick={() => setEditing(false)}>{c("cancel")}</button>
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="code">{level.code}</td>
      <td className="wrap">
        {level.name}
        {first && <div className="subline">{pr("firstNote")}</div>}
      </td>
      <td className="r">{level.sort_order}</td>
      <td className="r">
        {level.prices ?? 0}
        {(level.partners ?? 0) > 0 && (
          <div className="subline">{pr("customers", { n: level.partners ?? 0 })}</div>
        )}
      </td>
      <td>
        <span className="actions">
          <button type="button" className="ghost tiny" onClick={() => setEditing(true)}>{c("edit")}</button>
          <ConfirmDelete
            action={delFormAction}
            pending={delPending}
            className="ghost tiny"
            error={delState && "error" in delState ? delState.error : null}
            title={c("deleteName", { name: level.name })}
            detail={
              inUse
                ? pr("refused", { prices: level.prices ?? 0, partners: level.partners ?? 0 })
                : c("cannotUndo")
            }
          >
            <input type="hidden" name="id" value={level.id} />
          </ConfirmDelete>
        </span>
        {delState && "error" in delState && (
          <div className="hint" style={{ color: "var(--bad)" }}>{delState.error}</div>
        )}
      </td>
    </tr>
  );
}

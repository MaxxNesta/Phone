"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/actions";
import { ConfirmDelete } from "./confirm-delete";
import { useTranslations } from "next-intl";

type Brand = { id: string; code: string; name: string; name_my: string | null; is_active: boolean; items?: number };

export function BrandRow({
  brand,
  updateAction,
  deleteAction,
  deactivateAction,
  activateAction,
}: {
  brand: Brand;
  updateAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  deleteAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  deactivateAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  activateAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
}) {
  const c = useTranslations("common");
  const f = useTranslations("itemForm");
  const pt = useTranslations("partners");
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
        <td colSpan={5}>
          <form action={formAction} className="form" style={{ padding: "0.5rem 0" }}>
            {state && "error" in state && <div className="alert">{state.error}</div>}
            <input type="hidden" name="id" value={brand.id} />
            <div className="row">
              <div className="field">
                <label>{c("code")}</label>
                <input name="code" type="text" defaultValue={brand.code} required />
              </div>
              <div className="field">
                <label>{c("name")}</label>
                <input name="name" type="text" defaultValue={brand.name} required />
              </div>
              <div className="field">
                <label>{f("nameBurmese")}</label>
                <input name="name_my" type="text" defaultValue={brand.name_my ?? ""} />
              </div>
            </div>
            <label className="check" style={{ marginTop: "0.4rem" }}>
              <input name="is_active" type="checkbox" defaultChecked={brand.is_active} />
              Active
            </label>
            <div className="actions" style={{ marginTop: "0.5rem" }}>
              <button type="submit" disabled={pending}>{pending ? c("saving") : c("save")}</button>
              <button type="button" className="ghost tiny" onClick={() => setEditing(false)}>{c("cancel")}</button>
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="code">{brand.code}</td>
      <td className="wrap">
        {brand.name}
        {brand.name_my && (
          <div className="subline">{brand.name_my}</div>
        )}
      </td>
      <td className="r">{brand.items || ""}</td>
      <td>{brand.is_active ? <span className="pill ok">{pt("activeLower")}</span> : <span className="pill warn">{pt("inactiveLower")}</span>}</td>
      <td>
        <span className="actions">
          <button type="button" className="ghost tiny" onClick={() => setEditing(true)}>{c("edit")}</button>
          {brand.is_active ? (
            <form action={deactFormAction} style={{ display: "inline" }}>
              <input type="hidden" name="id" value={brand.id} />
              <button type="submit" className="warn tiny">{c("deactivate")}</button>
            </form>
          ) : (
            <form action={actFormAction} style={{ display: "inline" }}>
              <input type="hidden" name="id" value={brand.id} />
              <button type="submit" className="ghost tiny">{c("reactivate")}</button>
            </form>
          )}
          <ConfirmDelete
            action={delFormAction}
            pending={delPending}
            error={delState && "error" in delState ? delState.error : null}
            title={c("deleteName", { name: brand.name })}
            detail={c("cannotUndo")}
          >
            <input type="hidden" name="id" value={brand.id} />
          </ConfirmDelete>
        </span>
        {delState && "error" in delState && (
          <div className="hint" style={{ color: "var(--bad)" }}>{delState.error}</div>
        )}
      </td>
    </tr>
  );
}

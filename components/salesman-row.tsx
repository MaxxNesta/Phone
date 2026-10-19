"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/actions";
import { ConfirmDelete } from "./confirm-delete";
import { useTranslations } from "next-intl";

type Salesman = {
  id: string; code: string; name: string; name_my: string | null;
  phone: string | null; location_id: string | null; location_name: string | null;
  commission_pct: string; is_active: boolean;
};
type Location = { id: string; code: string; name: string };

export function SalesmanRow({
  salesman,
  locations,
  updateAction,
  deleteAction,
  deactivateAction,
  activateAction,
}: {
  salesman: Salesman;
  locations: Location[];
  updateAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  deleteAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  deactivateAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  activateAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
}) {
  const c = useTranslations("common");
  const f = useTranslations("itemForm");
  const pt = useTranslations("partners");
  const s = useTranslations("salespersons");
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
        <td colSpan={6}>
          <form action={formAction} className="form" style={{ padding: "0.5rem 0" }}>
            {state && "error" in state && <div className="alert">{state.error}</div>}
            <input type="hidden" name="id" value={salesman.id} />
            <div className="row">
              <div className="field">
                <label>{c("code")}</label>
                <input name="code" type="text" defaultValue={salesman.code} required />
              </div>
              <div className="field">
                <label>{c("name")}</label>
                <input name="name" type="text" defaultValue={salesman.name} required />
              </div>
              <div className="field">
                <label>{f("nameBurmese")}</label>
                <input name="name_my" type="text" defaultValue={salesman.name_my ?? ""} />
              </div>
              <div className="field">
                <label>{pt("phone")}</label>
                <input name="phone" type="text" defaultValue={salesman.phone ?? ""} />
              </div>
              <div className="field">
                <label>{s("branch")}</label>
                <select name="location_id" defaultValue={salesman.location_id ?? ""}>
                  <option value="">{f("noneOption")}</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.code} · {l.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{s("commission")}</label>
                <input name="commission_pct" type="number" min="0" step="any"
                  defaultValue={salesman.commission_pct} />
              </div>
            </div>
            <label className="check" style={{ marginTop: "0.4rem" }}>
              <input name="is_active" type="checkbox" defaultChecked={salesman.is_active} />
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
      <td className="code">{salesman.code}</td>
      <td className="wrap">
        {salesman.name}
        {salesman.name_my && (
          <div className="subline">{salesman.name_my}</div>
        )}
      </td>
      <td style={{ color: "var(--muted)" }}>{salesman.phone ?? "—"}</td>
      <td style={{ color: "var(--muted)" }}>{salesman.location_name ?? "—"}</td>
      <td className="r">{Number(salesman.commission_pct) > 0 ? `${Number(salesman.commission_pct)}%` : "—"}</td>
      <td>
        {salesman.is_active ? <span className="pill ok">{pt("activeLower")}</span> : <span className="pill warn">{pt("inactiveLower")}</span>}
        <span className="actions" style={{ marginTop: "0.3rem" }}>
          <button type="button" className="ghost tiny" onClick={() => setEditing(true)}>{c("edit")}</button>
          {salesman.is_active ? (
            <form action={deactFormAction} style={{ display: "inline" }}>
              <input type="hidden" name="id" value={salesman.id} />
              <button type="submit" className="warn tiny">{c("deactivate")}</button>
            </form>
          ) : (
            <form action={actFormAction} style={{ display: "inline" }}>
              <input type="hidden" name="id" value={salesman.id} />
              <button type="submit" className="ghost tiny">{c("reactivate")}</button>
            </form>
          )}
          <ConfirmDelete
            action={delFormAction}
            pending={delPending}
            error={delState && "error" in delState ? delState.error : null}
            title={c("deleteName", { name: salesman.name })}
            detail={c("cannotUndo")}
          >
            <input type="hidden" name="id" value={salesman.id} />
          </ConfirmDelete>
        </span>
        {delState && "error" in delState && (
          <div className="hint" style={{ color: "var(--bad)" }}>{delState.error}</div>
        )}
      </td>
    </tr>
  );
}

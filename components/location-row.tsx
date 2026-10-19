"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/actions";
import { ConfirmDelete } from "./confirm-delete";
import { useTranslations } from "next-intl";

type Location = {
  id: string; code: string; name: string; name_my: string | null;
  parent_id: string | null; parent_name: string | null;
  is_stock_location: boolean; is_active: boolean;
  /** A branch's, printed on its receipts. */
  address?: string | null; phone?: string | null;
};
type LocationNode = Location & { depth: number };
type Kind = "office" | "warehouse";

// Regular spaces collapse in HTML — a non-breaking space is what actually
// survives to indent a name, in every browser.
const NBSP = " ";

export function LocationRow({
  location,
  depth,
  locations,
  updateAction,
  deleteAction,
  deactivateAction,
  activateAction,
}: {
  location: Location;
  /** How deep this row sits — 0 for a top-level office, 1 for a warehouse inside it, and so on. */
  depth: number;
  /** Every location in tree order, for the Branch picker — includes this row, filtered out below. */
  locations: LocationNode[];
  updateAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  deleteAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  deactivateAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  activateAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
}) {
  const c = useTranslations("common");
  const f = useTranslations("itemForm");
  const pt = useTranslations("partners");
  const l = useTranslations("locations");
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

  const [kind, setKind] = useState<Kind>(location.is_stock_location ? "warehouse" : "office");
  const [parentId, setParentId] = useState(location.parent_id ?? "");
  const offices = locations.filter((l) => !l.is_stock_location && l.id !== location.id);


  if (editing) {
    return (
      <tr>
        <td colSpan={4}>
          <form action={formAction} className="form" style={{ padding: "0.5rem 0" }}>
            {state && "error" in state && <div className="alert">{state.error}</div>}
            <input type="hidden" name="id" value={location.id} />
            <input type="hidden" name="is_stock_location" value={kind === "warehouse" ? "on" : ""} />
            <input type="hidden" name="parent_id" value={kind === "warehouse" ? parentId : ""} />

            <div className="field">
              <label>{l("whatIs")}</label>
              <div className="row" style={{ gap: "1.5rem" }}>
                <label className="check">
                  <input
                    type="radio" name="kind" value="warehouse" checked={kind === "warehouse"}
                    onChange={() => setKind("warehouse")}
                  />
                  {l("warehouse")}
                </label>
                <label className="check">
                  <input
                    type="radio" name="kind" value="office" checked={kind === "office"}
                    onChange={() => setKind("office")}
                  />
                  {l("branch")}
                </label>
              </div>
            </div>

            <div className="row" style={{ marginTop: "0.4rem" }}>
              <div className="field">
                <label>{c("code")}</label>
                <input name="code" type="text" defaultValue={location.code} required />
              </div>
              <div className="field">
                <label>{c("name")}</label>
                <input name="name" type="text" defaultValue={location.name} required />
              </div>
              <div className="field">
                <label>{f("nameBurmese")}</label>
                <input name="name_my" type="text" defaultValue={location.name_my ?? ""} />
              </div>
              {kind === "office" && (
                <>
                  <div className="field">
                    <label>{l("address")} <span className="opt">{l("printedOnReceipts")}</span></label>
                    <input name="address" type="text" maxLength={300} defaultValue={location.address ?? ""} />
                  </div>
                  <div className="field">
                    <label>{pt("phone")}</label>
                    <input name="phone" type="tel" maxLength={60} defaultValue={location.phone ?? ""} />
                  </div>
                </>
              )}
              {kind === "warehouse" && (
                <div className="field">
                  <label>{l("branch")}</label>
                  <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                    <option value="">{l("standsAlone")}</option>
                    {offices.map((l) => (
                      <option key={l.id} value={l.id}>{l.code} · {l.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <label className="check" style={{ marginTop: "0.4rem" }}>
              <input name="is_active" type="checkbox" defaultChecked={location.is_active} />
              {c("active")}
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
      <td className="code">{location.code}</td>
      <td className="wrap">
        {depth > 0 && <span style={{ color: "var(--ghost)" }}>{NBSP.repeat(depth * 2)}└ </span>}
        {location.name}
        {location.name_my && (
          <div className="subline" style={{ marginLeft: depth > 0 ? "1.2rem" : 0 }}>
            {location.name_my}
          </div>
        )}
        {" "}
        {location.is_stock_location
          ? <span className="pill ok">{l("warehouseLower")}</span>
          : <span className="pill">{l("branch")}</span>}
      </td>
      <td>{location.is_active ? <span className="pill ok">{pt("activeLower")}</span> : <span className="pill warn">{pt("inactiveLower")}</span>}</td>
      <td>
        <span className="actions">
          <button type="button" className="ghost tiny" onClick={() => setEditing(true)}>{c("edit")}</button>
          {location.is_active ? (
            <form action={deactFormAction} style={{ display: "inline" }}>
              <input type="hidden" name="id" value={location.id} />
              <button type="submit" className="warn tiny">{c("deactivate")}</button>
            </form>
          ) : (
            <form action={actFormAction} style={{ display: "inline" }}>
              <input type="hidden" name="id" value={location.id} />
              <button type="submit" className="ghost tiny">{c("reactivate")}</button>
            </form>
          )}
          <ConfirmDelete
            action={delFormAction}
            pending={delPending}
            error={delState && "error" in delState ? delState.error : null}
            title={c("deleteName", { name: location.name })}
            detail={c("cannotUndo")}
          >
            <input type="hidden" name="id" value={location.id} />
          </ConfirmDelete>
        </span>
        {delState && "error" in delState && (
          <div className="hint" style={{ color: "var(--bad)" }}>{delState.error}</div>
        )}
      </td>
    </tr>
  );
}

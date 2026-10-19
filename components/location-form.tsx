"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/actions";
import { useTranslations } from "next-intl";

type Location = { id: string; code: string; name: string; depth: number; is_stock_location: boolean };
type Kind = "office" | "warehouse";

export function AddLocationForm({
  action,
  locations,
}: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  locations: Location[];
}) {
  const c = useTranslations("common");
  const f = useTranslations("itemForm");
  const pt = useTranslations("partners");
  const l = useTranslations("locations");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never,
    null
  );
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("warehouse");
  const [parentId, setParentId] = useState("");

  const offices = locations.filter((l) => !l.is_stock_location);

  if (!open) {
    return (
      <div className="actions">
        <button type="button" onClick={() => setOpen(true)}>{l("plus")}</button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>{l("addNew")}</h2>
        <span className="actions">
          <button type="button" className="ghost tiny" onClick={() => setOpen(false)}>{c("cancel")}</button>
        </span>
      </div>
      <div className="card-body">
        <form action={formAction} className="form">
          {state && "error" in state && <div className="alert">{state.error}</div>}
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
                {l("warehouseLong")}
              </label>
              <label className="check">
                <input
                  type="radio" name="kind" value="office" checked={kind === "office"}
                  onChange={() => setKind("office")}
                />
                {l("branchLong")}
              </label>
            </div>
          </div>

          <div className="row" style={{ marginTop: "0.5rem" }}>
            <div className="field">
              <label htmlFor="code">{c("code")}</label>
              <input id="code" name="code" type="text" required autoFocus
                placeholder={kind === "warehouse" ? "MAIN-WH" : "MDY"} />
            </div>
            <div className="field">
              <label htmlFor="name">{c("name")}</label>
              <input id="name" name="name" type="text" required
                placeholder={kind === "warehouse" ? "Main Warehouse" : "Mandalay Branch"} />
            </div>
            <div className="field">
              <label htmlFor="name_my">{f("nameBurmese")}</label>
              <input id="name_my" name="name_my" type="text" />
            </div>

            {kind === "warehouse" && (
              <div className="field">
                <label htmlFor="parent_id_select">{l("branch")}</label>
                <select id="parent_id_select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                  <option value="">{l("standsAlone")}</option>
                  {offices.map((l) => (
                    <option key={l.id} value={l.id}>{l.code} · {l.name}</option>
                  ))}
                </select>
                <span className="hint">
                  {offices.length === 0
                    ? l("noBranches")
                    : l("branchHint")}
                </span>
              </div>
            )}
          </div>

          <div className="actions" style={{ marginTop: "0.75rem" }}>
            <button type="submit" disabled={pending}>
              {pending ? c("saving") : kind === "warehouse" ? l("saveWarehouse") : l("saveOffice")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

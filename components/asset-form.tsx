"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import type { ActionResult } from "@/lib/actions";

export type AssetFormValue = {
  id?: string; code: string; name: string; category_id: string; branch_id: string;
  site: string; serial_no: string; notes: string;
  acquisition_date: string; in_service_date: string;
  acquisition_cost: string; residual_value: string; useful_life_months: string; start_convention: string;
  status: string;
};

const CONVENTION: Record<string, string> = {
  "": "Company default", NEXT_MONTH: "Month after in service", SAME_MONTH: "Month it goes into service", DAILY: "By days in the first month",
};

/**
 * One asset's master record. A draft is free to change; once depreciation is
 * on the ledger the figures it was worked out from are shown locked, with the
 * way each one is changed instead.
 */
export function AssetForm({ action, value, categories, branches, pinned, companyConvention }: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  value: AssetFormValue;
  categories: { id: string; name: string; asset_class: string; default_life_months: number | null; accounts: string }[];
  branches: { id: string; name: string }[];
  /** Posted depreciation exists: cost, dates, life, residual, category and branch are locked. */
  pinned: boolean;
  companyConvention: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action as never, null);
  const [v, setV] = useState(value);
  const set = (k: keyof AssetFormValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV({ ...v, [k]: e.target.value });
  const cat = categories.find((c) => c.id === v.category_id);
  const months = Number(v.useful_life_months);
  const isDraft = !value.id || value.status === "DRAFT";
  const lock = pinned ? { disabled: true, title: "Locked: depreciation for this asset is on the ledger" } : {};

  return (
    <form action={formAction} className="ie-form">
      {value.id && <input type="hidden" name="id" value={value.id} />}
      {/* A disabled field is not sent; the pinned values go as they are. */}
      {pinned && (["category_id", "branch_id", "acquisition_date", "in_service_date", "acquisition_cost",
                   "residual_value", "useful_life_months", "start_convention"] as const)
        .map((k) => <input key={k} type="hidden" name={k} value={v[k]} />)}

      <header className="ie-title">
        <h1>{value.id ? "Edit asset" : "Add asset"}</h1>
        <p>{value.id ? `${value.code} · ${value.name}` : "A fixed asset of the shop: equipment, furniture, a vehicle, software."}</p>
      </header>
      {state && "error" in state && <div className="alert" role="alert">{state.error}</div>}
      {pinned && (
        <p className="fa-pinned"><Lock size={14} aria-hidden="true" /> Depreciation for this asset is on the ledger. Cost, dates, useful life,
          residual value, category and branch are locked; change them by a change of estimate, a transfer or a correction.</p>
      )}

      <div className="ie-main fa-form">
        <section className="ie-card">
          <h3>Asset</h3>
          <div className="ie-grid3">
            <label className="ie-field"><span>Name</span>
              <input name="name" value={v.name} onChange={set("name")} maxLength={200} required autoFocus={!value.id} /></label>
            <label className="ie-field"><span>Asset code</span>
              <input name="code" value={v.code} onChange={set("code")} className="mono" style={{ textTransform: "uppercase" }} required /></label>
            <label className="ie-field"><span>Serial number</span>
              <input name="serial_no" value={v.serial_no} onChange={set("serial_no")} /></label>
          </div>
          <div className="ie-grid3" style={{ marginTop: "var(--s2)" }}>
            <label className="ie-field"><span>Category</span>
              <select name="category_id" value={v.category_id} onChange={(e) => {
                const c = categories.find((x) => x.id === e.target.value);
                setV({ ...v, category_id: e.target.value,
                       useful_life_months: v.useful_life_months || (c?.default_life_months ? String(c.default_life_months) : "") });
              }} required {...lock}>
                <option value="">Choose…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.asset_class === "INTANGIBLE" ? " (amortised)" : ""}</option>)}
              </select></label>
            <label className="ie-field"><span>Branch</span>
              <select name="branch_id" value={v.branch_id} onChange={set("branch_id")} required {...lock}>
                <option value="">Choose…</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></label>
            <label className="ie-field"><span>Location in branch</span>
              <input name="site" value={v.site} onChange={set("site")} placeholder="e.g. Back office" /></label>
          </div>
          {cat && <p className="ie-note">Posts to {cat.accounts}.</p>}
        </section>

        <section className="ie-card">
          <h3>Cost &amp; depreciation</h3>
          <div className="ie-grid4">
            <label className="ie-field"><span>Acquired on</span>
              <input type="date" name="acquisition_date" value={v.acquisition_date} onChange={set("acquisition_date")} required {...lock} /></label>
            <label className="ie-field"><span>In service from</span>
              <input type="date" name="in_service_date" value={v.in_service_date} onChange={set("in_service_date")} {...lock} /></label>
            <label className="ie-field"><span>Cost (MMK)</span>
              <span className="ie-money"><i>MMK</i>
                <input name="acquisition_cost" value={v.acquisition_cost} onChange={set("acquisition_cost")} inputMode="decimal" required {...lock} /></span></label>
            <label className="ie-field"><span>Residual value</span>
              <span className="ie-money"><i>MMK</i>
                <input name="residual_value" value={v.residual_value} onChange={set("residual_value")} inputMode="decimal" {...lock} /></span></label>
          </div>
          <div className="ie-grid4" style={{ marginTop: "var(--s2)" }}>
            <label className="ie-field"><span>Useful life (months)</span>
              <input type="number" min={1} max={1200} step={1} name="useful_life_months" value={v.useful_life_months}
                onChange={set("useful_life_months")} required {...lock} /></label>
            <div className="ie-field"><span>That is</span>
              <output className="ie-ro">{months > 0 ? `${Math.floor(months / 12)} yr ${months % 12 ? `${months % 12} mo` : ""}` : "—"}</output></div>
            <div className="ie-field"><span>Method</span><output className="ie-ro">Straight line</output></div>
            <label className="ie-field"><span>First month</span>
              <select name="start_convention" value={v.start_convention} onChange={set("start_convention")} {...lock}>
                {Object.entries(CONVENTION).map(([k, l]) => (
                  <option key={k} value={k} title={k === "" ? CONVENTION[companyConvention] : undefined}>{l}</option>))}
              </select></label>
          </div>
        </section>

        <section className="ie-card">
          <h3>Notes</h3>
          <label className="ie-field"><span>Anything worth keeping with the record</span>
            <textarea name="notes" rows={3} value={v.notes} onChange={set("notes")} /></label>
        </section>
      </div>

      <footer className="ie-bar">
        <Link className="ie-btn" href="/fixed-assets/register"><ArrowLeft size={15} aria-hidden="true" /> Back to register</Link>
        <span className="ie-bar-note" />
        <button type="submit" name="intent" value="save" className="ie-btn" disabled={pending}>
          {isDraft ? "Save as draft" : "Save"}</button>
        {isDraft && (
          <button type="submit" name="intent" value="activate" className="ie-btn primary" disabled={pending || !v.in_service_date}
            title={v.in_service_date ? "Depreciation starts from its in-service date" : "Enter the in-service date first"}>
            {pending ? "Saving…" : "Save & activate"}</button>
        )}
      </footer>
    </form>
  );
}

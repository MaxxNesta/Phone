"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/actions";

type Acct = { id: string; code: string; name: string };
const Result = ({ s, ok }: { s: ActionResult | null; ok: string }) =>
  s ? ("error" in s ? <div className="alert" role="alert">{s.error}</div> : <p className="fa-ok" role="status">{ok}</p>) : null;

const MODES = [
  ["REVIEW", "Review & post", "Each month is prepared as a draft; someone allowed to post checks the journal and posts it. A popup says when a month is ready."],
  ["MANUAL", "Manual", "Calculate and show only. Post depreciation journals yourself and link them in Journal Reconciliation."],
  ["AUTO", "Automatic", "Posts each month by itself. Needs a scheduled job, which is not set up yet."],
] as const;

export function FaSettingsForm({ action, value, revenue, expense }: {
  action: (p: unknown, fd: FormData) => Promise<ActionResult>;
  value: { posting_mode: string; start_convention: string; gain_account_id: string | null; loss_account_id: string | null };
  revenue: Acct[]; expense: Acct[];
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action as never, null);
  const [mode, setMode] = useState(value.posting_mode);
  return (
    <form action={formAction} className="fas-form">
      <Result s={state} ok="Saved." />
      <fieldset className="fas-modes">
        <legend>Posting</legend>
        {MODES.map(([k, l, d]) => (
          <label key={k} className={`fas-mode${mode === k ? " on" : ""}${k === "AUTO" ? " off" : ""}`}>
            <input type="radio" name="posting_mode" value={k} checked={mode === k} disabled={k === "AUTO"} onChange={() => setMode(k)} />
            <strong>{l}</strong><span>{d}</span>
          </label>
        ))}
      </fieldset>
      <div className="ie-grid3">
        <label className="ie-field"><span>First month of depreciation</span>
          <select name="start_convention" defaultValue={value.start_convention}>
            <option value="NEXT_MONTH">The month after it goes into service</option>
            <option value="SAME_MONTH">The month it goes into service, in full</option>
            <option value="DAILY">That month, by the days left in it</option>
          </select></label>
        <label className="ie-field"><span>Gain on disposal</span>
          <select name="gain_account_id" defaultValue={value.gain_account_id ?? ""}>
            <option value="">Choose…</option>{revenue.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select></label>
        <label className="ie-field"><span>Loss on disposal</span>
          <select name="loss_account_id" defaultValue={value.loss_account_id ?? ""}>
            <option value="">Choose…</option>{expense.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select></label>
      </div>
      <p className="ie-note">The first-month rule applies to assets that do not set their own; it never changes months already posted.</p>
      <div><button className="ie-btn primary" disabled={pending}>{pending ? "Saving…" : "Save settings"}</button></div>
    </form>
  );
}

export function FaCategoryForm({ action, value, assets, expenses, used }: {
  action: (p: unknown, fd: FormData) => Promise<ActionResult>;
  value: { id?: string; code: string; name: string; asset_class: string; asset_account_id: string; accum_account_id: string;
           expense_account_id: string; default_life_months: number | null; is_active: boolean };
  assets: Acct[]; expenses: Acct[]; used: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action as never, null);
  const pick = (name: string, list: Acct[], v: string) => (
    <select name={name} defaultValue={v} required disabled={used} title={used ? "Journals already carry this category's assets" : undefined}>
      <option value="">Choose…</option>{list.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
    </select>
  );
  return (
    <form action={formAction} className="fas-cat">
      {value.id && <input type="hidden" name="id" value={value.id} />}
      {used && <>
        <input type="hidden" name="asset_account_id" value={value.asset_account_id} />
        <input type="hidden" name="accum_account_id" value={value.accum_account_id} />
        <input type="hidden" name="expense_account_id" value={value.expense_account_id} />
      </>}
      <Result s={state} ok="Category saved." />
      <div className="ie-grid4">
        <label className="ie-field"><span>Code</span><input name="code" defaultValue={value.code} className="mono" required /></label>
        <label className="ie-field"><span>Name</span><input name="name" defaultValue={value.name} required /></label>
        <label className="ie-field"><span>Class</span>
          <select name="asset_class" defaultValue={value.asset_class}><option value="TANGIBLE">Tangible: depreciated</option><option value="INTANGIBLE">Intangible: amortised</option></select></label>
        <label className="ie-field"><span>Default life (months)</span><input type="number" name="default_life_months" min={1} max={1200} defaultValue={value.default_life_months ?? ""} /></label>
      </div>
      <div className="ie-grid3" style={{ marginTop: "var(--s2)" }}>
        <label className="ie-field"><span>Asset account</span>{pick("asset_account_id", assets, value.asset_account_id)}</label>
        <label className="ie-field"><span>Accumulated depreciation (credit)</span>{pick("accum_account_id", assets, value.accum_account_id)}</label>
        <label className="ie-field"><span>Depreciation expense (debit)</span>{pick("expense_account_id", expenses, value.expense_account_id)}</label>
      </div>
      <div className="fas-cat-go">
        <label className="check"><input type="checkbox" name="is_active" defaultChecked={value.is_active} /> Active</label>
        {used && <span className="ie-note">Accounts are fixed: journals already carry this category&apos;s assets.</span>}
        <button className="ie-btn primary" disabled={pending}>{pending ? "Saving…" : value.id ? "Save category" : "Add category"}</button>
      </div>
    </form>
  );
}

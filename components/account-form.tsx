"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/actions";

type Account = {
  id: string; code: string; name: string; account_type: string;
  posting_count: number;
};

export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  ASSET: "Asset", LIABILITY: "Liability", EQUITY: "Equity",
  REVENUE: "Revenue", COGS: "Cost of sales", EXPENSE: "Expense",
};
const TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "COGS", "EXPENSE"];

export function AddAccountForm({
  action,
  accounts,
  currencies,
}: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  accounts: Account[];
  currencies: string[];
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never,
    null
  );
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("EXPENSE");

  // Only same-type accounts can be a parent, and only ones nothing has been
  // posted to — matching what the server will accept.
  const parents = accounts.filter((a) => a.account_type === type && a.posting_count === 0);

  if (!open) {
    return (
      <div className="actions">
        <button type="button" onClick={() => setOpen(true)}>+ New account</button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>New account</h2>
        <span className="actions">
          <button type="button" className="ghost tiny" onClick={() => setOpen(false)}>Cancel</button>
        </span>
      </div>
      <div className="card-body">
        <form action={formAction} className="form">
          {state && "error" in state && <div className="alert">{state.error}</div>}

          <div className="row">
            <div className="field">
              <label htmlFor="code">Code</label>
              <input id="code" name="code" type="text" required autoFocus placeholder="1150" />
            </div>
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" name="name" type="text" required placeholder="Petty Cash" />
            </div>
            <div className="field">
              <label htmlFor="name_my">Name (Burmese)</label>
              <input id="name_my" name="name_my" type="text" />
            </div>
            <div className="field">
              <label htmlFor="account_type">Type</label>
              <select id="account_type" name="account_type" value={type}
                onChange={(e) => setType(e.target.value)}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="parent_id">Sits under</label>
              <select id="parent_id" name="parent_id" defaultValue="">
                <option value="">— nothing, top level —</option>
                {parents.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                ))}
              </select>
              <span className="hint">Same type only, and never one already posted to</span>
            </div>
            <div className="field">
              <label htmlFor="money_kind">Money account</label>
              <select id="money_kind" name="money_kind" defaultValue="">
                <option value="">Not a money account</option>
                <option value="cash">Cash / till</option>
                <option value="bank">Bank</option>
              </select>
              <span className="hint">Makes it available on the cash or bank book</span>
            </div>
            <div className="field">
              <label htmlFor="currency">Currency</label>
              <select id="currency" name="currency" defaultValue="">
                <option value="">Any</option>
                {currencies.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <span className="hint">Fix this only for a single-currency account</span>
            </div>
          </div>

          <div className="actions" style={{ marginTop: "0.75rem" }}>
            <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save account"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

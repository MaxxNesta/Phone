"use client";

import { useActionState, useEffect, useState } from "react";
import type { ActionResult } from "@/lib/actions";

export type ChannelRow = {
  id: string; code: string; name: string; kind: string; is_active: boolean;
  requires_reference: boolean; merchant_name: string | null; merchant_number: string | null;
  sort_order: number; default_account_id: string | null; default_account: string | null;
  branch_accounts: Record<string, string>; used: number;
};
type Opt = { id: string; code: string; name: string };

export const KIND_LABEL: Record<string, string> = {
  CASH: "Cash", BANK: "Bank transfer", WALLET: "Mobile wallet", QR: "QR", CARD: "Card", OTHER: "Other",
};

/** The receiving-account picker: an existing cash/bank account, or a new one named after the channel. */
function AccountSelect({ name, value, accounts, blank, channelName }: {
  name: string; value: string; accounts: Opt[]; blank: string; channelName: string;
}) {
  return (
    <select name={name} defaultValue={value}>
      <option value="">{blank}</option>
      {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
      <option value="__new">+ New account “{channelName || "…"}”</option>
    </select>
  );
}

export function ChannelFields({ c, accounts, branches }: { c?: ChannelRow; accounts: Opt[]; branches: Opt[] }) {
  const [name, setName] = useState(c?.name ?? "");
  return (
    <>
      <div className="row">
        <div className="field">
          <label>Name</label>
          <input name="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="CB Pay" />
        </div>
        <div className="field">
          <label>Kind</label>
          <select name="kind" defaultValue={c?.kind ?? "WALLET"}>
            {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Receiving account</label>
          <AccountSelect name="account_default" value={c?.default_account_id ?? ""} accounts={accounts}
            blank="Not set up" channelName={name} />
        </div>
        <div className="field">
          <label>Order</label>
          <input name="sort_order" type="number" min={0} max={999} defaultValue={c?.sort_order ?? 100} />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label>Merchant name</label>
          <input name="merchant_name" defaultValue={c?.merchant_name ?? ""} placeholder="Optional" />
        </div>
        <div className="field">
          <label>Merchant / account number</label>
          <input name="merchant_number" defaultValue={c?.merchant_number ?? ""} placeholder="Optional" />
        </div>
        <label className="pos-check" style={{ alignSelf: "end", paddingBottom: 8 }}>
          <input type="checkbox" name="requires_reference" defaultChecked={c?.requires_reference ?? true} />
          Transaction ID required
        </label>
      </div>
      {c && branches.length > 1 && (
        <div className="row">
          {branches.map((b) => (
            <div className="field" key={b.id}>
              <label>At {b.name}</label>
              <AccountSelect name={`account_${b.id}`} value={c.branch_accounts[b.id] ?? ""} accounts={accounts}
                blank="Same as above" channelName={name} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function NewChannelForm({ action, accounts }: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>; accounts: Opt[];
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action as never, null);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  useEffect(() => { if (state && "ok" in state) { setOpen(false); setKey((k) => k + 1); } }, [state]);
  if (!open) return <button type="button" className="btn ghost" onClick={() => setOpen(true)}>Add payment method</button>;
  return (
    <form action={formAction} className="form" key={key}>
      {state && "error" in state && <div className="alert">{state.error}</div>}
      <ChannelFields accounts={accounts} branches={[]} />
      <div className="actions">
        <button type="submit" disabled={pending}>{pending ? "Saving…" : "Add payment method"}</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

export function PaymentChannelRow({ c, accounts, branches, update, setActive, remove }: {
  c: ChannelRow; accounts: Opt[]; branches: Opt[];
  update: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  setActive: (fd: FormData) => Promise<void>;
  remove: (fd: FormData) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(update as never, null);
  useEffect(() => { if (state && "ok" in state) setEditing(false); }, [state]);
  const overrides = Object.keys(c.branch_accounts).length;

  return (
    <>
      <tr className={c.is_active ? "" : "muted"}>
        <td><strong>{c.name}</strong></td>
        <td><span className={`pill ${c.kind === "WALLET" || c.kind === "QR" ? "info" : ""}`}>{KIND_LABEL[c.kind] ?? c.kind}</span></td>
        <td>
          {c.default_account ?? <span className="neg">Not set up</span>}
          {overrides > 0 && <span className="page-sub"> · {overrides} branch{overrides === 1 ? "" : "es"} differ</span>}
        </td>
        <td>{c.requires_reference ? "Required" : "Optional"}</td>
        <td>{c.merchant_number ? `${c.merchant_name ?? ""} ${c.merchant_number}`.trim() : "—"}</td>
        <td className="r">{c.used}</td>
        <td>{c.is_active ? "Active" : "Inactive"}</td>
        <td className="r" style={{ whiteSpace: "nowrap" }}>
          <button type="button" className="linkish" onClick={() => setEditing((e) => !e)}>{editing ? "Close" : "Edit"}</button>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={8}>
            <form action={formAction} className="form">
              {state && "error" in state && <div className="alert">{state.error}</div>}
              <input type="hidden" name="id" value={c.id} />
              <ChannelFields c={c} accounts={accounts} branches={branches} />
              <div className="actions">
                <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
                <button type="submit" className="btn ghost" formAction={setActive} name="active" value={c.is_active ? "0" : "1"}>
                  {c.is_active ? "Deactivate" : "Activate"}
                </button>
                {c.used === 0 && (
                  <button type="submit" className="btn ghost danger" formAction={remove}
                    onClick={(e) => { if (!confirm(`Delete ${c.name}?`)) e.preventDefault(); }}>Delete</button>
                )}
              </div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

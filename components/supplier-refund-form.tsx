"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/actions";
import { useNotice } from "@/components/toast";

const money = (v: number) => Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

/** The money a supplier sends back for a debit note, into one cash or bank account. */
export function SupplierRefundForm({ action, noteId, noteNo, supplier, billNo, refundable, accounts, today }: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  noteId: string; noteNo: string; supplier: string; billNo: string; refundable: number;
  accounts: { id: string; code: string; name: string }[]; today: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action as never, null);
  useNotice(state);
  const [attemptKey] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState(String(refundable));
  const tooMuch = Number(amount) > refundable + 0.005;

  return (
    <form action={formAction} className="form wide docsheet">
      <input type="hidden" name="idempotency_key" value={attemptKey} />
      <input type="hidden" name="note_id" value={noteId} />
      {state && "error" in state && <div className="alert">{state.error}</div>}
      <div className="card doc-meta"><div className="card-body"><div className="row">
        <div className="field"><label>Debit note</label><span className="fixedfield">{noteNo}</span>
          <span className="hint">{supplier}{billNo ? ` · on ${billNo}` : ""}</span></div>
        <div className="field"><label>Still to come back</label><span className="fixedfield">{money(refundable)} MMK</span></div>
        <div className="field"><label htmlFor="doc_date">Date received</label>
          <input id="doc_date" name="doc_date" type="date" defaultValue={today} required /></div>
        <div className="field"><label htmlFor="reference">Reference</label>
          <input id="reference" name="reference" type="text" placeholder="Their transfer or receipt no." /></div>
      </div></div></div>
      <div className="card"><div className="card-head"><h2>Money received</h2></div><div className="card-body"><div className="row">
        <div className="field"><label htmlFor="amount">Amount (MMK)</label>
          <input id="amount" name="amount" type="number" min="0" step="any" required value={amount}
            onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="field"><label htmlFor="cash_account_id">Into</label>
          <select id="cash_account_id" name="cash_account_id" required defaultValue="">
            <option value="" disabled>Choose cash or bank…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select></div>
      </div></div></div>
      {tooMuch && <div className="alert">That is more than the {money(refundable)} still to come back.</div>}
      <div className="actions">
        <button type="submit" disabled={pending || tooMuch || !(Number(amount) > 0) || refundable <= 0}>
          {pending ? "Recording…" : "Record refund"}</button>
        <span className="page-sub">Dr cash or bank / Cr Accounts Payable. The bill comes back to zero.</span>
      </div>
    </form>
  );
}

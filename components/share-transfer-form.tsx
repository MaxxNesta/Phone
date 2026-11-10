"use client";

import { useActionState, useState } from "react";
import { ArrowRightLeft, CalendarDays, Hash, Landmark, PlusCircle, ShoppingBag, StickyNote, User } from "lucide-react";
import { ConfirmDelete } from "./confirm-delete";
import { useNotice } from "@/components/toast";

type Result = { error?: string } | null;
type Holder = { id: string; code: string; name: string; folio_no: string | null; is_active: boolean };
type Holding = { shareType: "EQUITY" | "PREFERENCE"; holder: string; ranges: [number, number][]; shares: number };
type Account = { id: string; code: string; name: string };

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const ranges = (rs: [number, number][]) => rs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ");

const TYPES = [
  { key: "ISSUE", label: "Issue", icon: PlusCircle, lead: "The company creates new shares and gives them to a shareholder. Money comes in: Dr the cash or bank account, Cr the equity account." },
  { key: "TRANSFER", label: "Transfer", icon: ArrowRightLeft, lead: "Existing shares move from one shareholder to another. Ownership only — nothing is posted to the ledger." },
  { key: "PURCHASE", label: "Purchase", icon: ShoppingBag, lead: "The company buys shares back from a shareholder. Money goes out: Dr the equity account, Cr the cash or bank account." },
] as const;

/**
 * Records an issue, a transfer between owners, or a buy-back. Only the parties
 * the chosen type needs are asked for; each shows its folio and what it holds,
 * and the first share number starts where it has to (the next free number for
 * an issue, the giver's first held number otherwise).
 */
export function ShareTransferForm({ action, holders, holdings, nextIssueNo, equityAccounts, assetAccounts, today }: {
  action: (prev: Result, fd: FormData) => Promise<Result>;
  holders: Holder[]; holdings: Holding[]; nextIssueNo: { EQUITY: number; PREFERENCE: number };
  equityAccounts: Account[]; assetAccounts: Account[]; today: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  useNotice(state);
  const [type, setType] = useState<"ISSUE" | "TRANSFER" | "PURCHASE">("ISSUE");
  const [shareType, setShareType] = useState<"EQUITY" | "PREFERENCE">("EQUITY");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [count, setCount] = useState("");
  const [fromNo, setFromNo] = useState<string | null>(null);
  const [rate, setRate] = useState("");

  const heldBy = (id: string) => holdings.find((h) => h.holder === id && h.shareType === shareType);
  const givers = holders.filter((h) => (heldBy(h.id)?.shares ?? 0) > 0);
  const giver = heldBy(fromId);
  const suggested = type === "ISSUE" ? nextIssueNo[shareType] : giver?.ranges[0]?.[0] ?? 1;
  const first = fromNo ?? String(suggested);
  const n = Math.trunc(Number(count) || 0);
  const last = n > 0 && Number(first) > 0 ? Number(first) + n - 1 : null;
  const amount = n * (Number(rate) || 0);
  const folio = (id: string) => holders.find((h) => h.id === id)?.folio_no;
  const cur = TYPES.find((t) => t.key === type)!;
  const defaultEquity = equityAccounts.find((a) => a.code === "31104")?.id ?? equityAccounts[0]?.id ?? "";

  return (
    <form action={formAction} className="form wide docsheet">
      {state?.error && <div className="alert">{state.error}</div>}
      <input type="hidden" name="transfer_type" value={type} />

      <section className="card">
        <div className="card-head"><h2>Transfer type</h2></div>
        <div className="card-body">
          <div className="segmented" role="radiogroup" aria-label="Transfer type">
            {TYPES.map((t) => (
              <button key={t.key} type="button" role="radio" aria-checked={type === t.key} className={`seg${type === t.key ? " on" : ""}`}
                onClick={() => { setType(t.key); setFromNo(null); }}>
                <t.icon size={16} aria-hidden="true" /> {t.label}
              </button>
            ))}
          </div>
          <p className="receive-explain">{cur.lead}</p>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Parties and date</h2></div>
        <div className="card-body"><div className="row">
          <div className="field">
            <label htmlFor="transfer_date"><CalendarDays size={13} aria-hidden="true" /> Date</label>
            <input id="transfer_date" name="transfer_date" type="date" defaultValue={today} required />
          </div>
          {type !== "ISSUE" && (
            <div className="field">
              <label htmlFor="from_shareholder_id"><User size={13} aria-hidden="true" /> From shareholder</label>
              <select id="from_shareholder_id" name="from_shareholder_id" value={fromId} required
                onChange={(e) => { setFromId(e.target.value); setFromNo(null); }}>
                <option value="">{givers.length ? "Choose who gives the shares…" : `Nobody holds ${shareType.toLowerCase()} shares yet`}</option>
                {givers.map((h) => <option key={h.id} value={h.id}>{h.name} · {h.folio_no}</option>)}
              </select>
              {giver && <span className="hint">Folio {folio(fromId)} · holds {fmt(giver.shares)} ({ranges(giver.ranges)})</span>}
            </div>
          )}
          {type !== "PURCHASE" && (
            <div className="field">
              <label htmlFor="to_shareholder_id"><User size={13} aria-hidden="true" /> To shareholder</label>
              <select id="to_shareholder_id" name="to_shareholder_id" value={toId} required onChange={(e) => setToId(e.target.value)}>
                <option value="">Choose who receives the shares…</option>
                {holders.filter((h) => h.is_active && h.id !== fromId).map((h) => <option key={h.id} value={h.id}>{h.name}{h.folio_no ? ` · ${h.folio_no}` : ""}</option>)}
              </select>
              {toId && <span className="hint">{folio(toId) ? `Folio ${folio(toId)}` : "First shares — a folio number is given on posting"}</span>}
            </div>
          )}
        </div></div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Shares</h2></div>
        <div className="card-body"><div className="row">
          <div className="field">
            <label htmlFor="share_type">Share type *</label>
            <select id="share_type" name="share_type" value={shareType} onChange={(e) => { setShareType(e.target.value as "EQUITY" | "PREFERENCE"); setFromId(""); setFromNo(null); }}>
              <option value="EQUITY">Equity</option>
              <option value="PREFERENCE">Preference</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="no_of_shares"><Hash size={13} aria-hidden="true" /> No. of shares</label>
            <input id="no_of_shares" name="no_of_shares" type="number" min="1" step="1" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="from_no">From no. <span className="subline">(including)</span></label>
            <input id="from_no" name="from_no" type="number" min="1" step="1" value={first} onChange={(e) => setFromNo(e.target.value)} required />
          </div>
          <div className="field">
            <label>To no. <span className="subline">(including)</span></label>
            <span className="fixedfield">{last ?? "—"}</span>
          </div>
          <div className="field">
            <label htmlFor="rate">Rate per share</label>
            <input id="rate" name="rate" type="number" min="0" step="any" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} required />
          </div>
          <div className="field">
            <label>Amount</label>
            <span className="fixedfield">{fmt(amount)}</span>
          </div>
        </div></div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Accounts</h2></div>
        <div className="card-body"><div className="row">
          <div className="field">
            <label htmlFor="equity_account_id"><Landmark size={13} aria-hidden="true" /> Equity account</label>
            <select id="equity_account_id" name="equity_account_id" defaultValue={defaultEquity} required>
              {equityAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </div>
          {type !== "TRANSFER" && (
            <div className="field">
              <label htmlFor="asset_account_id"><Landmark size={13} aria-hidden="true" /> {type === "ISSUE" ? "Money received into" : "Money paid from"}</label>
              <select id="asset_account_id" name="asset_account_id" required defaultValue="">
                <option value="">Choose the cash or bank account…</option>
                {assetAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select>
            </div>
          )}
          <div className="field span-2">
            <label htmlFor="remarks"><StickyNote size={13} aria-hidden="true" /> Remarks</label>
            <input id="remarks" name="remarks" type="text" placeholder="Board resolution, agreement no. — English or Myanmar" />
          </div>
        </div></div>
      </section>

      <div className="actions form-commit">
        <button type="submit" disabled={pending || !(n > 0) || (type !== "PURCHASE" && !toId) || (type !== "ISSUE" && !fromId)}>
          {pending ? "Posting…" : `Post ${cur.label.toLowerCase()}`}
        </button>
        <span className="page-sub">{type === "TRANSFER" ? "Changes who holds the shares; nothing is posted to the ledger." : "Posts the journal entry with it, or neither."}</span>
      </div>
    </form>
  );
}

/** A new owner. It holds nothing until an Issue gives it shares. */
type HolderValues = { id: string; name: string; is_company: boolean; phone: string | null; email: string | null; address: string | null; notes: string | null;
  equity_account_id: string | null; no_of_shares: number | null; share_price: number | null };

/** Add or edit a shareholder. Shares and price are as agreed, typed in by hand; blank until known. Posts nothing. */
export function ShareholderForm({ action, equityAccounts, initial }: {
  action: (prev: Result, fd: FormData) => Promise<Result>; equityAccounts: Account[]; initial?: HolderValues;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  useNotice(state);
  const v = initial;
  return (
    <form action={formAction} className="form wide docsheet">
      {state?.error && <div className="alert">{state.error}</div>}
      {v && <input type="hidden" name="id" value={v.id} />}
      <section className="card">
        <div className="card-head"><h2>Shareholder</h2></div>
        <div className="card-body"><div className="row">
          <div className="field span-2"><label htmlFor="name">Name</label><input id="name" name="name" type="text" required placeholder="Person or organisation" defaultValue={v?.name} /></div>
          <div className="field"><label className="check"><input type="checkbox" name="is_company" defaultChecked={v?.is_company} /> Is a company</label></div>
          <div className="field"><label htmlFor="phone">Phone</label><input id="phone" name="phone" type="tel" defaultValue={v?.phone ?? ""} /></div>
          <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" spellCheck={false} defaultValue={v?.email ?? ""} /></div>
          <div className="field span-2"><label htmlFor="address">Address</label><input id="address" name="address" type="text" defaultValue={v?.address ?? ""} /></div>
          <div className="field span-2"><label htmlFor="notes">Notes</label><input id="notes" name="notes" type="text" defaultValue={v?.notes ?? ""} /></div>
        </div></div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Capital</h2></div>
        <div className="card-body"><div className="row">
          <div className="field span-2"><label htmlFor="equity_account_id"><Landmark size={13} aria-hidden="true" /> Capital account</label>
            <select id="equity_account_id" name="equity_account_id" defaultValue={v?.equity_account_id ?? ""}>
              <option value="">None</option>
              {equityAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </select></div>
          <div className="field"><label htmlFor="no_of_shares"><Hash size={13} aria-hidden="true" /> Number of shares</label>
            <input id="no_of_shares" name="no_of_shares" inputMode="numeric" placeholder="Not set" defaultValue={v?.no_of_shares ?? ""} /></div>
          <div className="field"><label htmlFor="share_price">Price per share</label>
            <input id="share_price" name="share_price" inputMode="decimal" placeholder="Not set" defaultValue={v?.share_price ?? ""} /></div>
        </div></div>
      </section>
      <div className="actions form-commit">
        <button type="submit" disabled={pending}>{pending ? "Saving…" : v ? "Save" : "Add shareholder"}</button>
        <span className="page-sub">Saving posts nothing. Capital is the balance of the capital account; record money in with a cash or bank receipt to it.</span>
      </div>
    </form>
  );
}

/** Cancel, asked first; a refusal (a later transfer depends on it) shows in the dialog. */
export function CancelTransfer({ id, no, action }: { id: string; no: string; action: (prev: Result, fd: FormData) => Promise<Result> }) {
  const [state, formAction, pending] = useActionState(action, null);
  useNotice(state);
  return (
    <ConfirmDelete action={formAction} pending={pending} error={state?.error ?? null}
      title={`Cancel ${no}?`} detail="The shares go back, and any journal entry is reversed. Allowed only if no later transfer depends on it."
      label="Cancel" pendingLabel="Cancelling…" confirmLabel="Cancel transfer" className="ghost tiny">
      <input type="hidden" name="id" value={id} />
    </ConfirmDelete>
  );
}

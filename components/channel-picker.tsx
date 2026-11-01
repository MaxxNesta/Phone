"use client";

import { useState } from "react";
import type { Channel } from "@/lib/payment-channels";

/**
 * How money moves on a form — cash, bank, a wallet — with the account it
 * lands in or leaves from said in words, and the transaction ID a wallet or
 * bank gives. Posts `payment_channel_id` and `payment_reference`; the server
 * resolves the account from the channel, never from this screen.
 */
export function ChannelPicker({ channels, label, direction, disabled = false }: {
  channels: Channel[]; label: string; direction: "in" | "out"; disabled?: boolean;
}) {
  const usable = channels.filter((c) => c.accountId);
  const [id, setId] = useState(usable.find((c) => c.kind === "CASH")?.id ?? usable[0]?.id ?? "");
  const c = usable.find((x) => x.id === id);
  // Bank: which of the shop's bank accounts, by code. Starts on the method's own.
  const [bankId, setBankId] = useState("");
  const banks = c?.kind === "BANK" ? c.accounts ?? [] : [];
  const bank = banks.find((b) => b.id === bankId) ?? banks.find((b) => b.id === c?.accountId) ?? banks[0];
  return (
    <>
      <div className="field">
        <label htmlFor="payment_channel_id">{label}</label>
        <select id="payment_channel_id" name="payment_channel_id" required={!disabled}
          value={id} onChange={(e) => setId(e.target.value)} disabled={disabled}>
          {usable.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        {c && banks.length === 0 && <span className="hint">{direction === "in" ? "Into" : "Out of"} {c.accountCode} · {c.accountName}</span>}
      </div>
      {banks.length > 0 && (
        <div className="field">
          <label htmlFor="payment_account_id">{direction === "in" ? "Into bank account" : "From bank account"}</label>
          <select id="payment_account_id" name="payment_account_id" value={bank?.id ?? ""}
            onChange={(e) => setBankId(e.target.value)} disabled={disabled}>
            {banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
          </select>
        </div>
      )}
      {c && c.kind !== "CASH" && !disabled && (
        <div className="field">
          <label htmlFor="payment_reference">
            Transaction ID
          </label>
          <input id="payment_reference" name="payment_reference" type="text" maxLength={80}
            autoComplete="off" required={c.requiresReference}
            placeholder={direction === "in" ? `From the customer's ${c.name} screen` : `${c.name} reference`} />
        </div>
      )}
    </>
  );
}

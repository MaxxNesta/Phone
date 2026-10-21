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
  return (
    <>
      <div className="field">
        <label htmlFor="payment_channel_id">{label}</label>
        <select id="payment_channel_id" name="payment_channel_id" required={!disabled}
          value={id} onChange={(e) => setId(e.target.value)} disabled={disabled}>
          {usable.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        {c && <span className="hint">{direction === "in" ? "Into" : "Out of"} {c.accountCode} · {c.accountName}</span>}
      </div>
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

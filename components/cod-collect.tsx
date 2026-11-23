"use client";

import { useActionState, useState } from "react";
import { ConfirmDelete } from "./confirm-delete";
import { useNotice } from "@/components/toast";
import { collectCodAction } from "@/lib/actions";
import type { Channel } from "@/lib/payment-channels";

/**
 * Cash on delivery: the driver is back with the money. Asked in the app's own
 * dialog: when, how it was paid (cash to the till by default, or a bank or
 * wallet if the customer paid that way), and how much (all of it, unless only
 * part was paid). Posts the ordinary customer receipt.
 */
export function CodCollect({ invoiceId, docNo, owed, today, channels }: {
  invoiceId: string; docNo: string; owed: number; today: string; channels: Channel[];
}) {
  const [state, act, pending] = useActionState(collectCodAction, null);
  useNotice(state, { errors: false });
  const usable = channels.filter((c) => c.accountId);
  const [channelId, setChannelId] = useState(usable.find((c) => c.kind === "CASH")?.id ?? usable[0]?.id ?? "");
  const channel = usable.find((c) => c.id === channelId);
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

  return (
    <ConfirmDelete action={act} pending={pending} error={state?.error ?? null}
      className="btn primary" label="Collected" pendingLabel="Posting…"
      title={`Cash collected for ${docNo}?`}
      detail={`Posts a customer receipt for what the driver collected, ${fmt(owed)} left to collect.`}
      confirmLabel="Post receipt" confirmClassName="">
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <div className="cod-collect">
        <div className="field">
          <label htmlFor="cod-date">Collected on</label>
          <input id="cod-date" name="doc_date" type="date" defaultValue={today} max={today} required />
        </div>
        {usable.length > 0 && (
          <div className="field">
            <label htmlFor="cod-channel">Paid by</label>
            <select id="cod-channel" name="payment_channel_id" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              {usable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {channel && channel.kind !== "BANK" && <span className="hint">Into {channel.accountName}</span>}
          </div>
        )}
        {channel?.kind === "BANK" && (channel.accounts?.length ?? 0) > 0 && (
          <div className="field">
            <label htmlFor="cod-bank">Into bank account</label>
            <select id="cod-bank" name="payment_account_id" defaultValue={channel.accountId ?? ""}>
              {channel.accounts!.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
            </select>
          </div>
        )}
        {channel && channel.kind !== "CASH" && (
          <div className="field">
            <label htmlFor="cod-ref">Transaction ID{channel.requiresReference && " *"}</label>
            <input id="cod-ref" name="payment_reference" maxLength={80} autoComplete="off" required={channel.requiresReference} />
          </div>
        )}
        <div className="field">
          <label htmlFor="cod-amount">Amount collected</label>
          <input id="cod-amount" name="amount" type="number" min="0" step="any" defaultValue={owed} max={owed} required />
          <span className="hint">All of it unless the customer paid only part; the rest stays to collect.</span>
        </div>
      </div>
    </ConfirmDelete>
  );
}

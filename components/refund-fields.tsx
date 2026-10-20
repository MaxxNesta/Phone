"use client";

import { Banknote, CircleEllipsis, CreditCard, Landmark, QrCode, Smartphone } from "lucide-react";
import type { Channel, ChannelKind } from "@/lib/payment-channels";

const ICON: Record<ChannelKind, typeof Banknote> = {
  CASH: Banknote, BANK: Landmark, WALLET: Smartphone, QR: QrCode, CARD: CreditCard, OTHER: CircleEllipsis,
};

export type RefundState = { channelId: string; amount: string; reference: string };

/**
 * How money goes back to a customer: one chip per payment method, the
 * account it is paid out of said in words, and the wallet's transaction ID.
 * Methods with no account at this branch are shown but cannot be chosen.
 */
export function RefundFields({ channels, value, onChange, max }: {
  channels: Channel[]; value: RefundState; onChange: (v: RefundState) => void;
  /** What can be paid back, when known. */
  max?: number | null;
}) {
  const chosen = channels.find((c) => c.id === value.channelId && c.accountId);
  return (
    <div className="pos-stack">
      <div className="field">
        <label id="refund-method">Pay back by</label>
        <div className="refund-methods" role="radiogroup" aria-labelledby="refund-method">
          {channels.map((c) => {
            const Icon = ICON[c.kind];
            return (
              <button type="button" key={c.id} className="paymode" data-kind={c.kind} role="radio"
                aria-checked={value.channelId === c.id} aria-pressed={value.channelId === c.id}
                disabled={!c.accountId}
                title={c.accountId ? `Paid out of ${c.accountCode} · ${c.accountName}` : `${c.name} has no account at this branch`}
                onClick={() => onChange({ ...value, channelId: c.id, reference: "" })}>
                <Icon size={16} aria-hidden="true" /> {c.name}
              </button>
            );
          })}
        </div>
        {chosen && (
          <span className="refund-from">
            Paid out of <b>{chosen.accountCode} · {chosen.accountName}</b>
            {chosen.kind !== "CASH" && " — send it from the shop's account, then enter the ID below"}
          </span>
        )}
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="refund_amount">Amount</label>
          <input id="refund_amount" type="number" min={0} step="any" inputMode="decimal"
            value={value.amount} onChange={(e) => onChange({ ...value, amount: e.target.value })} />
          {max != null && <span className="hint">Up to {Math.round(max).toLocaleString("en-US")} MMK can be paid back</span>}
        </div>
        {chosen && chosen.kind !== "CASH" && (
          <div className="field">
            <label htmlFor="refund_reference">
              Transaction ID{chosen.requiresReference ? " *" : " (optional)"}
            </label>
            <input id="refund_reference" value={value.reference} maxLength={80} autoComplete="off"
              placeholder={`From the ${chosen.name} refund`}
              onChange={(e) => onChange({ ...value, reference: e.target.value })} />
          </div>
        )}
      </div>
      <input type="hidden" name="refund_channel_id" value={chosen?.id ?? ""} />
      <input type="hidden" name="refund_amount" value={value.amount} />
      <input type="hidden" name="refund_reference" value={value.reference} />
    </div>
  );
}

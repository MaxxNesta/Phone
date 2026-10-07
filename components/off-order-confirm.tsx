"use client";

import { useEffect, useRef } from "react";
import { Info } from "lucide-react";

export type OffOrderLine = { name: string; qty: number };

/**
 * Asked before posting a receipt against an order that also brings in
 * something the order never asked for. It posts either way — the goods did
 * arrive — but the order counts only what it ordered, so its "still awaited"
 * does not go down for these. Said once, at the moment it matters, rather
 * than as another line of small print on the form.
 */
export function OffOrderConfirm({ open, orderNo, lines, onCancel, onConfirm }: {
  open: boolean;
  orderNo: string;
  lines: OffOrderLine[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const units = lines.reduce((s, l) => s + l.qty, 0);

  return (
    <dialog ref={ref} className="confirm alertish"
      onCancel={(e) => { e.preventDefault(); onCancel(); }}
      onClick={(e) => { if (e.target === ref.current) onCancel(); }}>
      <div className="confirm-panel">
        <div className="confirm-icon info" aria-hidden="true"><Info size={19} strokeWidth={2.25} /></div>
        <h2 className="confirm-title">
          {units} {units === 1 ? "item isn't" : "items aren't"} on {orderNo}
        </h2>
        <p className="confirm-detail">
          They&rsquo;ll be received as extra stock and won&rsquo;t count toward the order.
        </p>
        <ul className="alert-items">
          {lines.map((l) => (
            <li key={l.name}><span>{l.name}</span><strong>×{l.qty}</strong></li>
          ))}
        </ul>
        <div className="confirm-actions">
          <button type="button" className="ghost" autoFocus onClick={onCancel}>Go Back</button>
          <button type="button" onClick={onConfirm}>Receive Anyway</button>
        </div>
      </div>
    </dialog>
  );
}

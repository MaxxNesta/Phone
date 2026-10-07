"use client";

import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";

export type OffOrderReceived = { name: string; qty: number; docNo: string };

/**
 * Goods that came in on this order's receipts but are not on the order —
 * another colour, another storage. They are in stock; they just do not count
 * toward what the order is waiting for. One quiet line, the detail behind it.
 */
export function OffOrderNote({ orderNo, rows, purchase }: {
  orderNo: string; rows: OffOrderReceived[]; purchase: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const units = rows.reduce((s, r) => s + r.qty, 0);
  const verb = purchase ? "received" : "delivered";

  return (
    <>
      <p className="offorder-note">
        <Info size={14} aria-hidden="true" />
        {units} {verb} {units === 1 ? "isn't" : "aren't"} on this order
        <button type="button" className="linkish" onClick={() => setOpen(true)}>Details</button>
      </p>
      <dialog ref={ref} className="confirm alertish"
        onCancel={(e) => { e.preventDefault(); setOpen(false); }}
        onClick={(e) => { if (e.target === ref.current) setOpen(false); }}>
        <div className="confirm-panel">
          <div className="confirm-icon info" aria-hidden="true"><Info size={19} strokeWidth={2.25} /></div>
          <h2 className="confirm-title">Not on {orderNo}</h2>
          <p className="confirm-detail">
            These came in with this order&rsquo;s {purchase ? "receipts" : "deliveries"} but
            don&rsquo;t count toward it. If they replaced what was ordered and no
            more is coming, close the rest of the order.
          </p>
          <ul className="alert-items">
            {rows.map((r) => (
              <li key={`${r.docNo}-${r.name}`}><span>{r.name}<br /><small className="page-sub">{r.docNo}</small></span><strong>×{r.qty}</strong></li>
            ))}
          </ul>
          <div className="confirm-actions">
            <button type="button" autoFocus onClick={() => setOpen(false)}>OK</button>
          </div>
        </div>
      </dialog>
    </>
  );
}

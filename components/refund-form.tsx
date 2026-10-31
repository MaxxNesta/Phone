"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/lib/actions";
import { previewCustomerRefund } from "@/lib/actions";
import type { Channel } from "@/lib/payment-channels";
import type { MoneyPreview } from "@/lib/refund";
import { RefundFields, type RefundState } from "./refund-fields";
import { MoneyPreviewDialog } from "./money-preview";

type Ret = { id: string; doc_no: string; date: string; customer: string; location_id: string | null;
             total: number; refundable: number; invoice_no: string | null };

/** Paying back a return already posted: pick it, how, how much; review; post. */
export function RefundForm({ action, returns, channels, today, initialReturnId }: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  returns: Ret[]; channels: Record<string, Channel[]>; today: string; initialReturnId?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action as never, null);
  const [attemptKey] = useState(() => crypto.randomUUID());
  const [returnId, setReturnId] = useState(
    returns.find((r) => r.id === initialReturnId)?.id ?? returns[0]?.id ?? "");
  const ret = returns.find((r) => r.id === returnId);
  const methods = (ret?.location_id ? channels[ret.location_id] : null) ?? [];
  const [refund, setRefund] = useState<RefundState>(() => ({
    channelId: methods.find((c) => c.kind === "CASH" && c.accountId)?.id ?? "",
    amount: ret ? String(ret.refundable) : "", reference: "",
  }));
  const formRef = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  const [review, setReview] = useState<MoneyPreview | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => { if (state && "error" in state) setReview(null); }, [state]);

  const pick = (id: string) => {
    setReturnId(id);
    const r = returns.find((x) => x.id === id);
    setRefund((v) => ({ ...v, amount: r ? String(r.refundable) : "" }));
  };

  const openReview = async () => {
    if (!formRef.current) return;
    setReviewing(true); setReviewError(null);
    try {
      const r = await previewCustomerRefund(new FormData(formRef.current));
      if ("error" in r) setReviewError(r.error); else setReview(r.preview);
    } finally { setReviewing(false); }
  };

  if (returns.length === 0) {
    return <div className="empty">No customer return is waiting to be paid back.</div>;
  }

  return (
    <form action={formAction} ref={formRef} className="form wide docsheet"
      onSubmit={(e) => { if (!confirmed.current) { e.preventDefault(); void openReview(); } confirmed.current = false; }}>
      <input type="hidden" name="idempotency_key" value={attemptKey} />
      {state && "error" in state && <div className="alert">{state.error}</div>}
      {reviewError && <div className="alert">{reviewError}</div>}

      <div className="card">
        <div className="card-head"><h2>Return</h2></div>
        <div className="card-body">
          <div className="row">
            <div className="field">
              <label htmlFor="return_id">Paying back</label>
              <select id="return_id" name="return_id" value={returnId} onChange={(e) => pick(e.target.value)}>
                {returns.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.doc_no} · {r.customer} · {Math.round(r.refundable).toLocaleString("en-US")} owed
                  </option>
                ))}
              </select>
              {ret && (
                <span className="hint">
                  {ret.invoice_no ? `Against ${ret.invoice_no}` : "On the customer's account"} · return of{" "}
                  {Math.round(ret.total).toLocaleString("en-US")} MMK on {ret.date}
                </span>
              )}
            </div>
            <div className="field">
              <label htmlFor="doc_date">Date</label>
              <input id="doc_date" name="doc_date" type="date" defaultValue={today} required />
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Money back</h2></div>
        <div className="card-body">
          <RefundFields channels={methods} value={refund} onChange={setRefund} max={ret?.refundable ?? null} />
        </div>
      </div>

      <div className="actions">
        <button type="submit" disabled={pending || reviewing || !ret || !(Number(refund.amount) > 0)}>
          {pending ? "Posting…" : reviewing ? "Checking…" : "Review refund"}
        </button>
      </div>

      {review && (
        <MoneyPreviewDialog preview={review} busy={pending} title="Review refund" confirmLabel="Pay refund"
          onClose={() => setReview(null)}
          onConfirm={() => { confirmed.current = true; formRef.current?.requestSubmit(); }} />
      )}
    </form>
  );
}

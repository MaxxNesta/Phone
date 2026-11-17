"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { previewDebitNote, type ActionResult } from "@/lib/actions";
import { useNotice } from "@/components/toast";

type Invoice = {
  id: string; doc_no: string; doc_date: string;
  partner_id: string; partner_name: string;
  gross_total: string; outstanding: string;
  /** Credit notes: what is left of the sale after earlier returns and notes. */
  remaining?: string;
  /** A bill owed in a foreign currency is reduced in that currency. */
  currency?: string; exchange_rate?: number;
};

const money = (v: string | number) =>
  Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * A note that reduces one invoice, without goods moving.
 *
 * Deliberately not a line-by-line document. Goods coming back is a return,
 * and returns already exist with all the costing that implies; this is the
 * other case — the price was agreed differently, a short delivery was billed
 * in full, a discount was settled after the fact. What it needs is an
 * amount, whether tax comes off with it, and why.
 */
export function NoteForm({
  kind, invoice, taxCodes, today, action,
}: {
  kind: "credit" | "debit";
  invoice: Invoice;
  taxCodes: { id: string; code: string; rate: string | number }[];
  today: string;
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never, null,
  );
  useNotice(state);
  const [attemptKey] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState("");
  const [taxCodeId, setTaxCodeId] = useState("");
  const [category, setCategory] = useState("");
  const [docDate, setDocDate] = useState(today);
  const [reason, setReason] = useState("");
  // The engine's own allocation for a supplier's price discount, posted and
  // rolled back (previewDebitNote). Any change to the note makes it stale.
  const [preview, setPreview] = useState<{ code: string; name: string; amount: number }[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const stale = () => { setPreview(null); setPreviewError(null); };

  // In the bill's own currency: a yuan bill is reduced in yuan, and the
  // engine takes it off at the bill's rate.
  const fxRate = invoice.currency && invoice.currency !== "MMK" ? (invoice.exchange_rate ?? 1) : 1;
  const unit = fxRate !== 1 ? invoice.currency! : "MMK";
  const owed = Number(invoice.outstanding) / fxRate;
  const net = Number(amount) || 0;
  const rate = Number(taxCodes.find((t) => t.id === taxCodeId)?.rate ?? 0);
  const tax = rate > 0 ? Math.round((net * rate) / 100) : 0;
  const gross = net + tax;
  // A credit note may pass what is owed, up to what is left of the sale: the
  // customer who already paid is owed the rest back, and Refund pays it.
  const cap = kind === "credit" && invoice.remaining != null ? Number(invoice.remaining) / fxRate : owed;
  const tooMuch = gross > cap + 0.0001;
  const owedBack = Math.max(0, gross - owed);
  const isCredit = kind === "credit";
  const isPriceDiscount = !isCredit && category === "DISCOUNT";

  const review = async () => {
    setReviewing(true); setPreviewError(null);
    const res = await previewDebitNote({ sourceDocumentId: invoice.id, partnerId: invoice.partner_id, docDate,
      amount: net, taxCodeId: taxCodeId || null, category, reason });
    setReviewing(false);
    if ("error" in res) setPreviewError(res.error); else setPreview(res.lines);
  };

  return (
    <form action={formAction} className="form wide docsheet">
      <input type="hidden" name="idempotency_key" value={attemptKey} />
      <input type="hidden" name="source_document_id" value={invoice.id} />
      <input type="hidden" name="partner_id" value={invoice.partner_id} />

      {state && "error" in state && <div className="alert">{state.error}</div>}

      <div className="card doc-meta">
        <div className="card-body">
          <div className="row">
            <div className="field">
              <label>{isCredit ? "Invoice being credited" : "Bill being debited"}</label>
              <span className="fixedfield">
                <Link href={`/documents/${invoice.id}`} style={{ color: "var(--link)" }}>
                  {invoice.doc_no}
                </Link>
              </span>
              <span className="hint">{invoice.partner_name}</span>
            </div>
            <div className="field">
              <label>Still owing</label>
              <span className="fixedfield">{money(owed)}</span>
              <span className="hint">of {money(invoice.gross_total)} billed</span>
            </div>
            <div className="field">
              <label htmlFor="doc_date">Note date</label>
              <input id="doc_date" name="doc_date" type="date" value={docDate} required
                onChange={(e) => { setDocDate(e.target.value); stale(); }} />
            </div>
            <div className="field">
              <label htmlFor="reference">Reference</label>
              {/* The counterparty's own paperwork for the same correction.
                  The two sides name it oppositely: we credit a customer who
                  raised a debit note against us, and we debit a supplier who
                  answers with a credit note of their own. */}
              <input id="reference" name="reference" type="text"
                     placeholder={isCredit
                       ? "Their debit note no., if any"
                       : "Their credit note no., if any"} />
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>What comes off</h2></div>
        <div className="card-body">
          <div className="row">
            <div className="field">
              <label htmlFor="amount">Amount before tax ({unit})</label>
              <input
                id="amount" name="amount" type="number" min="0" step="any" required
                value={amount} onChange={(e) => { setAmount(e.target.value); stale(); }}
              />
            </div>
            {taxCodes.length > 0 && (
              <div className="field">
                <label htmlFor="tax_code_id">Tax to give back</label>
                <select id="tax_code_id" name="tax_code_id" value={taxCodeId}
                        onChange={(e) => { setTaxCodeId(e.target.value); stale(); }}>
                  <option value="">None</option>
                  {taxCodes.filter((t) => Number(t.rate) > 0).map((t) => (
                    <option key={t.id} value={t.id}>{t.code} · {Number(t.rate)}%</option>
                  ))}
                </select>
                <span className="hint">
                  {isCredit
                    ? "The tax charged on this part comes off the customer's bill too"
                    : "The tax claimed on this part is given back"}
                </span>
              </div>
            )}
          </div>

          {/* Categorised as well as written. The sentence answers one note;
              the category answers a year — how much went back as billing
              errors, how much was given away as goodwill. */}
          <div className="field" style={{ marginTop: "0.6rem" }}>
            <label htmlFor="category">What kind of correction</label>
            <select id="category" name="category" required
                    value={category} onChange={(e) => { setCategory(e.target.value); stale(); }}>
              <option value="">Choose one…</option>
              <option value="BILLING_ERROR">
                {isCredit
                  ? "Billing error — overcharge, wrong price, billed twice"
                  : "Billing error — they overcharged, wrong price, billed twice"}
              </option>
              <option value="CANCELLATION">Cancellation — billed, then not delivered or called off</option>
              <option value="DISCOUNT">
                {isCredit
                  ? "Discount — a reduction agreed after the invoice"
                  : "Price discount — agreed after the bill (lowers what the goods cost)"}
              </option>
              <option value="RETURN">
                {isCredit
                  ? "Goods returned — and they are NOT coming back to the warehouse"
                  : "Goods rejected — and they are NOT going back to the supplier"}
              </option>
              <option value="OTHER">Something else — say what below</option>
            </select>
          </div>

          {/* The stock warning runs opposite ways for the two notes. On a
              credit note the goods would be coming back in; on a debit note
              they would be going back out. Either way the note itself moves
              no stock, and the wrong choice here leaves the warehouse
              counting goods it does not have, or short of goods it does. */}
          {category === "RETURN" && (
            <div className="hintbar caution">
              {isCredit ? (
                <>
                  <strong>Only if the goods are not physically coming back</strong> —
                  written off, destroyed, or kept by the customer. If they are
                  returning to the warehouse, close this and raise a{" "}
                  <Link href="/sales/returns">customer return</Link> instead:
                  that brings the stock and its cost back as well as the money.
                </>
              ) : (
                <>
                  <strong>Only if the goods are not physically going back</strong> —
                  scrapped here, or written off where they stand. If they are
                  being shipped back to the supplier, close this and raise a{" "}
                  <Link href="/purchases/returns">supplier return</Link> instead:
                  that takes the stock and its cost out as well as the money.
                </>
              )}{" "}
              A note only moves money, so stock written off still needs an
              adjustment of its own.
            </div>
          )}

          <div className="field" style={{ marginTop: "0.6rem" }}>
            <label htmlFor="reason">Why</label>
            <input
              id="reason" name="reason" type="text" required
              value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={isCredit
                ? "Short delivery billed in full — 10 boxes never sent"
                : "Two cartons short on arrival — supplier agreed the deduction"}
            />
            <span className="hint">
              Kept on the note for good. A tax office reads this, and so does whoever
              finds the note in a year.
            </span>
          </div>

          <div className="totalbar">
            {tax > 0 && (
              <span style={{ color: "var(--muted)" }}>
                {money(net)} + tax {money(tax)}
              </span>
            )}
            <span style={{ color: "var(--muted)" }}>
              {isCredit && owedBack > 0 ? "Customer is owed back" : isCredit ? "Customer will owe" : "We will owe"}
            </span>
            <span className="big">{money(isCredit && owedBack > 0 ? owedBack : Math.max(0, owed - gross))} {unit}</span>
          </div>
        </div>
      </div>

      {isPriceDiscount && net > 0 && !tooMuch && (
        <div className="card">
          <div className="card-head"><h2>Allocation</h2>
            <span className="page-sub">Where the discount lands: the goods still held, cost of sales for those sold, price variance for any not yet received</span>
          </div>
          <div className="card-body">
            {preview ? (
              <table className="linetable">
                <thead><tr><th>Account</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
                <tbody>
                  {preview.map((l) => (
                    <tr key={l.code}><td>{l.code} · {l.name}</td>
                      <td className="r">{l.amount > 0 ? money(l.amount) : ""}</td>
                      <td className="r">{l.amount < 0 ? money(-l.amount) : ""}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <button type="button" className="btn ghost" onClick={review} disabled={reviewing}>
                {reviewing ? "Working it out…" : "Review allocation"}
              </button>
            )}
            {previewError && <div className="alert" style={{ marginTop: 8 }}>{previewError}</div>}
          </div>
        </div>
      )}

      {tooMuch && (
        <div className="alert">
          {isCredit
            ? <>That is more than the {money(cap)} left of this sale after earlier returns and notes. Reduce the amount.</>
            : <>That is more than the {money(owed)} still owing. A note cannot take a bill below nothing — reduce the amount, or raise it against another bill.</>}
        </div>
      )}

      <div className="actions">
        <button type="submit" disabled={pending || tooMuch || net <= 0 || !category || (isPriceDiscount && !preview)}>
          {pending ? "Posting…" : `Post ${isCredit ? "credit" : "debit"} note`}
        </button>
        <span className="page-sub">
          {isCredit
            ? `Dr ${category === "DISCOUNT" ? "Sales Discounts" : "Sales Returns"} / Cr Accounts Receivable. No stock moves — goods coming back is a return.${owedBack > 0 ? " The customer is owed the difference: refund it from the posted note." : ""}`
            : isPriceDiscount
              ? (preview ? "Posts exactly the allocation above. No stock moves; only its cost." : "Review the allocation first.")
              : "Dr Accounts Payable / Cr Purchase Return. No stock moves — goods going back is a return."}
        </span>
      </div>
    </form>
  );
}

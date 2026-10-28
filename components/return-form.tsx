"use client";
import { WarehouseSelect } from "@/components/warehouse-select";

import { Fragment, useActionState, useEffect, useRef, useState } from "react";
import { TrackMode } from "./track-mode";
import { SerialEntry, type ScannedSerial } from "./serial-entry";
import type { ActionResult, PickerItem } from "@/lib/actions";
import { ItemPicker } from "./item-picker";
import { PartnerPicker } from "./partner-picker";
import { RefundFields, type RefundState } from "./refund-fields";
import { MoneyPreviewDialog } from "./money-preview";
import { previewSalesReturn } from "@/lib/actions";
import type { Channel } from "@/lib/payment-channels";
import type { MoneyPreview } from "@/lib/refund";
import { LineRemove } from "./line-remove";

type Item = PickerItem;
type Node = { id: string; code: string; segment: string; name: string; parent_id: string | null };
type Partner = { id: string; code: string; name: string };
type Location = { id: string; code: string; name: string };
type Line = { key: number; itemId: string; qty: string; unitPrice: string; serials?: ScannedSerial[]; withSerials?: boolean };
type SalesDoc = { id: string; doc_type: string; doc_no: string; doc_date: Date | string;
  partner_id: string; rates?: Record<string, number>;
  /** A purchase made in a foreign currency, and its rate. */
  currency?: string; exchange_rate?: number };

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
// postgres.js sends `date` columns over as Date objects, not strings.
const fmtDate = (d: Date | string) => (typeof d === "string" ? d : d.toISOString()).slice(0, 10);

/**
 * The inverse of an invoice, in every sense that matters for the UI: a
 * sales return brings stock IN (no on-hand check — the opposite of a sale),
 * a purchase return sends stock OUT (on-hand check applies — the opposite
 * of a purchase). Reusing InvoiceForm's shortage logic as-is would check
 * the wrong direction for both.
 */
export function ReturnForm({
  kind,
  action,
  partners,
  items: initialItems,
  locations,
  today,
  categories,
  uoms,
  salesDocs,
  prefill,
  serialPool = [],
  channels,
}: {
  /** Customer returns: payment methods by location, for paying money back now. */
  channels?: Record<string, Channel[]>;
  kind: "sales" | "purchase";
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  partners: Partner[];
  items: Item[];
  locations: Location[];
  today: string;
  categories: Node[];
  uoms: { id: string; code: string; name: string }[];
  salesDocs?: SalesDoc[];
  /**
   * Handsets this return could name: for a customer return, the ones out with
   * each customer and the sale they left on; for a supplier return, the ones
   * on each shelf and who supplied them. Offered for one-tap entry.
   */
  serialPool?: { item_id: string; imei: string; partner_id: string;
                 document_id: string | null; location_id: string | null }[];
  /**
   * Arrived here from a goods receipt being cancelled because the goods went
   * back. Everything this return needs is already on that receipt, so it is
   * carried across rather than asked for again.
   */
  prefill?: {
    sourceDocumentId: string; docNo: string; partnerId: string; locationId: string;
    lines: { itemId: string; qty: string; unitPrice: string }[];
  } | null;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never,
    null
  );

  /** See the hidden field below. */
  const [attemptKey] = useState(() => crypto.randomUUID());

  const [items, setItems] = useState<Item[]>(initialItems);
  const addItem = (i: Item) => setItems((xs) => [...xs, i]);

  const [lines, setLines] = useState<Line[]>(() =>
    prefill && prefill.lines.length > 0
      ? prefill.lines.map((l, i) => ({ key: i + 1, ...l }))
      : [{ key: 1, itemId: "", qty: "", unitPrice: "" }]);
  const [partnerId, setPartnerId] = useState(prefill?.partnerId ?? "");
  const [locationId, setLocationId] = useState(prefill?.locationId || locations[0]?.id || "");
  const [docDate, setDocDate] = useState(today);
  const [sourceDocumentId, setSourceDocumentId] = useState(prefill?.sourceDocumentId ?? "");
  const [receivedTime, setReceivedTime] = useState("");
  // Money back: kept as credit on the customer, or paid out now.
  const [refundMode, setRefundMode] = useState<"credit" | "now">("credit");
  const [refund, setRefund] = useState<RefundState>({ channelId: "", amount: "", reference: "" });
  // The review: what the posting will do, from a rolled-back dry run.
  const formRef = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  const [review, setReview] = useState<MoneyPreview | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  // A refusal from the real posting closes the review so the reason shows.
  useEffect(() => { if (state && "error" in state) setReview(null); }, [state]);

  useEffect(() => {
    setReceivedTime(new Date().toTimeString().slice(0, 5));
  }, []);

  const isSales = kind === "sales";
  const methods = (channels?.[locationId] ?? []);
  const cashMethod = methods.find((c) => c.kind === "CASH" && c.accountId);
  const byId = (id: string) => items.find((i) => i.id === id);
  /** Names every unit: always for IMEI and SERIAL items, by choice for OPTIONAL ones. */
  const named = (l: Line): boolean => !!byId(l.itemId)?.tracks_serial || (byId(l.itemId)?.identity === "OPTIONAL" && !!l.withSerials);
  const returnableDocs = (salesDocs ?? []).filter((d) => d.partner_id === partnerId);
  const sourceDoc = returnableDocs.find((d) => d.id === sourceDocumentId);
  /** The purchase was in yuan (or another currency): prices are entered in it. */
  const sourceFc = !isSales && sourceDoc?.currency && sourceDoc.currency !== "MMK"
    ? sourceDoc.currency : null;
  const sourceIsReceipt = sourceDoc?.doc_type === "GOODS_RECEIPT";

  /**
   * A return against a receipt is priced by that receipt, because what it
   * has to do is clear an accrual of a known size — return a hundred units
   * that arrived at 500 and 50,000 comes off, whatever anyone types. The
   * engine derives it either way; showing something else here would be the
   * screen promising a figure the engine will not post.
   */
  const receiptRate = (itemId: string): number | null => {
    if (!sourceIsReceipt) return null;
    const r0 = sourceDoc?.rates?.[itemId];
    // Shown in the purchase's own currency; the engine prices it by the
    // receipt either way.
    const r = r0 != null && sourceFc ? Math.round((r0 / (sourceDoc!.exchange_rate ?? 1)) * 10000) / 10000 : r0;
    return r === undefined || r === null ? null : Number(r);
  };

  function setLine(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function pickItem(key: number, itemId: string) {
    const item = byId(itemId);
    const fromReceipt = receiptRate(itemId);
    if (fromReceipt !== null) {
      setLine(key, { itemId, unitPrice: String(fromReceipt) });
      return;
    }
    const price = !item ? "" : isSales ? item.sale_price : item.next_cost;
    setLine(key, { itemId, unitPrice: Number(price) > 0 ? String(Number(price)) : "" });
  }

  // Switching the source re-prices what is already on the form. On a prefilled
  // return this runs once on mount and arrives at the figures already there —
  // both come from the receipt's own rate, which is the point.
  // Picking
  // receipt after the lines were entered is the ordinary way round, and
  // leaving yesterday's next_cost sitting in a locked field would be worse
  // than leaving it editable.
  useEffect(() => {
    setLines((ls) => ls.map((l) => {
      const fromReceipt = l.itemId ? receiptRate(l.itemId) : null;
      return fromReceipt === null ? l : { ...l, unitPrice: String(fromReceipt) };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceDocumentId]);

  const addLine = () =>
    setLines((ls) => [...ls, { key: Math.max(0, ...ls.map((l) => l.key)) + 1, itemId: "", qty: "", unitPrice: "" }]);

  const removeLine = (key: number) =>
    setLines((ls) => (ls.length === 1 ? [{ key: key + 1, itemId: "", qty: "", unitPrice: "" }] : ls.filter((l) => l.key !== key)));

  const amount = (l: Line) => (Number(l.qty) || 0) * (Number(l.unitPrice) || 0);
  const total = lines.reduce((s, l) => s + amount(l), 0);

  const payload = JSON.stringify(
    lines
      .filter((l) => l.itemId && Number(l.qty) > 0)
      .map((l) => ({ itemId: l.itemId, qty: Number(l.qty), unitPrice: Number(l.unitPrice) || 0,
                     serials: (named(l) ? l.serials ?? [] : []).map((x) => x.serial) }))
  );
  const serialShort = lines.some((l) => named(l) && Number(l.qty) > 0
    && (l.serials?.length ?? 0) !== Number(l.qty));

  // Only a purchase return removes stock — a sales return adds it, so
  // there's nothing to run short of.
  const shortages = lines.filter((l) => {
    if (isSales || !l.itemId) return false;
    const item = byId(l.itemId);
    return item?.is_stocked && Number(l.qty) > Number(item.on_hand);
  });

  const openReview = async () => {
    if (!formRef.current) return;
    setReviewing(true);
    setReviewError(null);
    try {
      const r = await previewSalesReturn(new FormData(formRef.current));
      if ("error" in r) setReviewError(r.error);
      else setReview(r.preview);
    } finally {
      setReviewing(false);
    }
  };

  return (
    <form action={formAction} className="form wide" ref={formRef}
      onSubmit={(e) => {
        // A customer return is reviewed before it posts; the confirm button
        // submits again with the review behind it.
        if (isSales && !confirmed.current) { e.preventDefault(); void openReview(); }
        confirmed.current = false;
      }}>
      {/* One submission, one posting. Generated when this form mounts, so a
          double-click or a resent request carries the same key and is handed
          the document the first one posted; a new form is a new key. */}
      <input type="hidden" name="idempotency_key" value={attemptKey} />

      {state && "error" in state && <div className="alert">{state.error}</div>}
      {reviewError && <div className="alert">{reviewError}</div>}

      <input type="hidden" name="lines" value={payload} />

      <div className="card">
        <div className="card-head">
          <h2>{isSales ? "Customer" : "Supplier"} and date</h2>
        </div>
        <div className="card-body">
          <div className="row">
            <div className="field">
              <label htmlFor="partner_id">{isSales ? "Customer" : "Supplier"}</label>
              <PartnerPicker
                partners={partners as never}
                value={partnerId}
                onPick={(id) => { setPartnerId(id); setSourceDocumentId(""); }}
              />
            </div>

            <div className="field">
              <label htmlFor="location_id">Warehouse</label>
              {/* The receipt's own warehouse where there is one: goods that
                  came into Mandalay go back from Mandalay, and asking again
                  invites picking the wrong shelf. */}
              <WarehouseSelect locations={locations} id="location_id" name="location_id" required
                      value={locationId} onChange={(e) => setLocationId(e.target.value)} />
            </div>

            {(
              <div className="field">
                <label htmlFor="source_document_id">Return against</label>
                <select id="source_document_id" name="source_document_id" value={sourceDocumentId}
                  onChange={(e) => setSourceDocumentId(e.target.value)} disabled={!partnerId}>
                  <option value="">
                    {!partnerId
                      ? `Choose a ${isSales ? "customer" : "supplier"} first`
                      : isSales
                        ? "Not on a specific invoice"
                        : "Not against a specific receipt or bill"}
                  </option>
                  {returnableDocs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.doc_no} ·{" "}
                      {d.doc_type === "DELIVERY" ? "delivery"
                        : d.doc_type === "GOODS_RECEIPT" ? "goods receipt"
                        : "invoice"} · {fmtDate(d.doc_date)}
                    </option>
                  ))}
                </select>
                <span className="page-sub">
                  {/* What is returned against decides what the return gives
                      back, not only what it costs. A bill means the supplier
                      owes a credit; a receipt they never billed means the
                      accrual for goods we no longer have comes off instead. */}
                  {!sourceDocumentId
                    ? isSales
                      ? "Leave blank to cost the return at current stock value."
                      : "Leave blank to cost the return at current stock value — "
                        + "choose the receipt these goods came in on where you can, "
                        + "so the return takes back what that receipt put on."
                    : isSales
                      ? "Returned stock is costed at what it actually sold for on this document."
                      : sourceIsReceipt
                        ? "Goods go back and the accrual this receipt raised comes off with "
                          + "them. Nothing is charged to the supplier: they have not billed "
                          + "for these."
                        : "The supplier is owed less by what goes back."}
                </span>
              </div>
            )}

            <div className="field">
              <label htmlFor="doc_date">Date</label>
              <input id="doc_date" name="doc_date" type="date" value={docDate}
                onChange={(e) => setDocDate(e.target.value)} required />
            </div>

            {isSales && (
              <div className="field">
                <label htmlFor="received_time">Time</label>
                <input id="received_time" name="received_time" type="time" value={receivedTime}
                  onChange={(e) => setReceivedTime(e.target.value)} />
                <span className="hint">Orders same-day stock-ins correctly for FIFO</span>
              </div>
            )}

            <div className="field">
              <label htmlFor="reference">Reference</label>
              <input id="reference" name="reference" type="text"
                placeholder={isSales ? "Their reason / RMA no." : "Debit note no."} />
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Lines</h2>
          <button type="button" className="ghost tiny" onClick={addLine}>Add line</button>
        </div>

        <div className="tablewrap">
          <table className="linetable">
            <thead>
              <tr>
                <th>Item</th>
                <th className="r">{isSales ? "Ref. cost" : "On hand"}</th>
                <th className="r">Qty</th>
                <th className="r">Unit price{sourceFc ? ` (${sourceFc})` : ""}</th>
                <th className="r">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const item = byId(l.itemId);
                const short = !isSales && item?.is_stocked && Number(l.qty) > Number(item.on_hand);

                return (
                  <Fragment key={l.key}>
                  <tr>
                    <td style={{ minWidth: 240 }}>
                      <ItemPicker
                        mode={kind}
                        items={items}
                        categories={categories}
                        uoms={uoms}
                        value={l.itemId}
                        onPick={(id) => pickItem(l.key, id)}
                        onCreated={addItem}
                      />
                    </td>
                    <td className="r">
                      {!item ? (
                        "—"
                      ) : isSales ? (
                        fmt(Number(item.next_cost))
                      ) : (
                        <span style={{ color: short ? "var(--bad)" : undefined }}>
                          {item.is_stocked ? fmt(Number(item.on_hand)) : "service"}
                        </span>
                      )}
                    </td>
                    <td className="narrow">
                      <input type="number" min="0" step="any" value={l.qty}
                        onChange={(e) => setLine(l.key, { qty: e.target.value })}
                        aria-label="Quantity" />
                    </td>
                    <td className="narrow">
                      <input type="number" min="0" step="any" value={l.unitPrice}
                        onChange={(e) => setLine(l.key, { unitPrice: e.target.value })}
                        readOnly={l.itemId ? receiptRate(l.itemId) !== null : false}
                        title={l.itemId && receiptRate(l.itemId) !== null
                          ? "Priced by the receipt being returned, so the accrual clears exactly"
                          : undefined}
                        aria-label="Unit price" />
                    </td>
                    <td className="r">{fmt(amount(l))}</td>
                    <td className="tight">
                      <LineRemove onClick={() => removeLine(l.key)} />
                    </td>
                  </tr>
                  {item?.identity === "OPTIONAL" && (
                    <tr className="batchrow">
                      <td colSpan={6}>
                        <TrackMode code={item.code} on={!!l.withSerials} onChange={(on) => setLine(l.key, { withSerials: on })} />
                      </td>
                    </tr>
                  )}
                  {item && named(l) && (
                    <tr className="batchrow">
                      <td colSpan={6}>
                        <SerialEntry
                          label={`${item.code} — ${isSales ? "which handsets came back" : "which handsets go back"}`}
                          qty={Number(l.qty) || 0}
                          value={l.serials ?? []}
                          suggestions={serialPool
                            .filter((u) => u.item_id === item.id && u.partner_id === partnerId
                              && (!isSales || !sourceDocumentId || u.document_id === sourceDocumentId)
                              && (isSales || !locationId || u.location_id === locationId))
                            .map((u) => u.imei)}
                          onChange={(v) => setLine(l.key, {
                            serials: v,
                            ...(!(Number(l.qty) > 0) || Number(l.qty) === (l.serials?.length ?? 0)
                              ? { qty: String(v.length) } : {}),
                          })}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="totalbar">
          <span style={{ color: "var(--muted)" }}>Total</span>
          <span className="big">
            {fmt(total)} {sourceFc ?? "MMK"}
            {sourceFc && sourceDoc?.exchange_rate && (
              <span className="subline" style={{ display: "block" }}>
                ≈ {fmt(total * sourceDoc.exchange_rate)} MMK at {sourceDoc.exchange_rate.toLocaleString("en-US")}
              </span>
            )}
          </span>
        </div>
      </div>

      {shortages.length > 0 && (
        <div className="alert">
          Not enough stock on hand to return{" "}
          {shortages.map((l) => byId(l.itemId)?.code).join(", ")}. Reduce the quantity.
        </div>
      )}

      {isSales && (
        <div className="card">
          <div className="card-head">
            <h2>Money back</h2>
          </div>
          <div className="card-body pos-stack">
            <div className="segmented" role="radiogroup" aria-label="Money back">
              <button type="button" role="radio" aria-checked={refundMode === "credit"}
                className={`seg${refundMode === "credit" ? " on" : ""}`} onClick={() => setRefundMode("credit")}>
                Keep as credit
              </button>
              <button type="button" role="radio" aria-checked={refundMode === "now"}
                className={`seg${refundMode === "now" ? " on" : ""}`}
                disabled={methods.every((c) => !c.accountId)}
                onClick={() => {
                  setRefundMode("now");
                  setRefund((r) => ({ ...r, channelId: r.channelId || cashMethod?.id || "", amount: r.amount || String(total || "") }));
                }}>
                Refund now
              </button>
            </div>
            <input type="hidden" name="refund" value={refundMode} />
            {refundMode === "credit" ? (
              <span className="hint">
                {sourceDocumentId
                  ? "What the customer paid stays against the invoice; anything above what they owe can be refunded later from the return."
                  : "The value goes on the customer's account, to use on a later sale or refund later."}
              </span>
            ) : (
              <RefundFields channels={methods} value={refund} onChange={setRefund} />
            )}
          </div>
        </div>
      )}

      <div className="field">
        <label htmlFor="memo">Note</label>
        <textarea id="memo" name="memo" rows={2} placeholder="Reason for the return — English or Myanmar" />
      </div>

      <div className="actions">
        {serialShort && <span className="low" role="status">Name one IMEI per handset.</span>}
        <button type="submit" disabled={pending || reviewing || total === 0 || shortages.length > 0 || serialShort}>
          {pending ? "Posting…" : reviewing ? "Checking…" : isSales ? "Review return" : "Post purchase return"}
        </button>
        <span className="page-sub">
          {isSales
            ? "Stock returns to inventory; revenue and what the customer owes both reverse."
            : "Stock leaves inventory; what's owed to the supplier drops."}
        </span>
      </div>
      {review && (
        <MoneyPreviewDialog preview={review} busy={pending}
          title={review.refund ? "Review return and refund" : "Review return"}
          confirmLabel={review.refund ? "Post return and refund" : "Post return"}
          onClose={() => setReview(null)}
          onConfirm={() => { confirmed.current = true; formRef.current?.requestSubmit(); }} />
      )}
    </form>
  );
}

"use client";

import { Fragment, useMemo, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { Lock, AlertCircle, Building2, FileText, ClipboardList, Warehouse, CalendarDays, Hash, StickyNote, ChevronDown } from "lucide-react";
import { DocHeading } from "./doc-heading";
import type { ActionResult } from "@/lib/actions";
import { NegativeStockConfirm, type Shortfall } from "./negative-stock-confirm";
import { useNotice } from "@/components/toast";

type InvoiceLine = {
  lineId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  uomCode: string | null;
  invoicedQty: number;
  deliveredQty: number;
  remainingQty: number;
  unitPrice: number;
  isFree: boolean;
  focReasonId: string | null;
  consigned: boolean;
  onHand: number;
  orderLineId: string | null;
  orderId: string | null;
  orderNo: string | null;
  orderOrdered: number | null;
  orderFulfilled: number | null;
  orderRemaining: number | null;
};

type Invoice = {
  id: string; docNo: string; docDate: string;
  partnerId: string; partnerCode: string; partnerName: string;
  locationId: string | null; locationCode: string | null; locationName: string | null;
  lines: InvoiceLine[];
};

const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });
const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * Sending goods out against an invoice that was raised before them.
 *
 * The same shape as receiving against a bill, and deliberately not the same
 * screen. Three things differ, and each of them is a place where copying the
 * purchase side would have printed something untrue.
 *
 * The price is the customer's, not the goods'. An invoice says what is being
 * charged; it says nothing about what the goods cost, which is drawn FIFO
 * from the lots on the shelf when this posts and cannot be known here. So the
 * column is headed Unit price and the value is what the customer pays. The
 * receipt screen's locked figure is a cost because a bill really does decide
 * one. This one would be a lie in the same position.
 *
 * Stock can run out. A receipt adds and always can; a delivery takes away and
 * may not be able to. What is on hand at this location is therefore a column
 * rather than a footnote, and a line short of stock says so before anything
 * is typed rather than failing at the end.
 *
 * And some of it may not be ours. Consigned goods are held, not owned, and
 * come from a separate pool a sale has to draw explicitly. A line drawing
 * from it is marked, because the difference decides whose goods just left the
 * building.
 */
export function DeliverAgainstInvoice({
  action, invoice, today, related, backHref, backLabel,
}: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  invoice: Invoice;
  today: string;
  related: React.ReactNode;
  backHref: string;
  backLabel: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never, null,
  );
  useNotice(state);
  const [attemptKey] = useState(() => crypto.randomUUID());
  const [docDate, setDocDate] = useState(today);
  /* The invoice this delivery answers, written in for you.
     The field was blank and the delivery note went out naming nothing, so
     the paperwork at the customer's gate could not be tied back to the
     bill without looking it up. Filled, not fixed: a delivery note often
     carries the driver's own number, and that is the one the customer
     signs for. */
  const [reference, setReference] = useState(invoice.docNo);
  const [memo, setMemo] = useState("");
  // Going out with less on the books than is leaving. Allowed deliberately —
  // the goods are physically there and the receipt for them has not been
  // entered yet — but only once somebody says so and says why.
  const [askShort, setAskShort] = useState(false);
  const [shortConfirmed, setShortConfirmed] = useState(false);
  const [shortReason, setShortReason] = useState("");
  const [sending, setSending] = useState<Record<string, string>>(() =>
    Object.fromEntries(invoice.lines.map((l) => [l.lineId, String(l.remainingQty)])));

  const entered = (l: InvoiceLine) => Number(sending[l.lineId]) || 0;
  const unitOf = (l: InvoiceLine) => (l.uomCode ? ` ${l.uomCode}` : "");

  const totals = useMemo(() => {
    let going = 0;
    let charged = 0;
    let unallocated = 0;
    const short: InvoiceLine[] = [];

    /**
     * Allocation is worked out per order line and only then summarised.
     *
     * Keeping one running total per order was wrong in a way that only shows
     * with more than one item on it: the total was subtracted from every
     * line's own remaining quantity, so a second item was judged against a
     * limit the first had already spent. Ten of A and twenty of B, all
     * outstanding, came out as twenty allocated and ten answering nothing,
     * against an order the summary reported as ten units long — it had kept
     * the first line's figures and thrown the rest away.
     */
    const perOrderLine = new Map<string, number>();
    const orders = new Map<string, {
      orderNo: string; orderId: string;
      fulfilled: number; ordered: number; allocating: number;
    }>();

    for (const l of invoice.lines) {
      const q = entered(l);
      if (q <= 0) continue;
      going += q;
      charged += q * l.unitPrice;
      if (!l.consigned && q > l.onHand) short.push(l);

      if (!l.orderId || !l.orderNo || !l.orderLineId || l.orderRemaining === null) {
        unallocated += q;
        continue;
      }
      // What this order line can still take, less what earlier invoice lines
      // answering the same order line have already claimed from it.
      const claimed = perOrderLine.get(l.orderLineId) ?? 0;
      const left = Math.max((l.orderRemaining ?? 0) - claimed, 0);
      const takes = Math.min(q, left);
      perOrderLine.set(l.orderLineId, claimed + takes);
      unallocated += q - takes;

      // Summarised per order, adding every line's own figures rather than
      // keeping whichever came first.
      const seen = orders.get(l.orderId) ?? {
        orderNo: l.orderNo, orderId: l.orderId, fulfilled: 0, ordered: 0, allocating: 0,
      };
      seen.allocating += takes;
      seen.fulfilled += l.orderFulfilled ?? 0;
      seen.ordered += l.orderOrdered ?? 0;
      orders.set(l.orderId, seen);
    }

    return {
      going: Math.round(going * 10000) / 10000,
      charged: Math.round(charged * 10000) / 10000,
      unallocated: Math.round(unallocated * 10000) / 10000,
      orders: [...orders.values()],
      short,
    };
  }, [sending, invoice.lines]);

  const invTotalRemaining = invoice.lines.reduce((t, l) => t + l.remainingQty, 0);
  const invFullyDelivered = totals.going >= invTotalRemaining - 0.0001;
  const unit = invoice.lines[0]?.uomCode ? ` ${invoice.lines[0].uomCode}` : "";
  const oneUnit = new Set(invoice.lines.map((l) => l.uomCode ?? "")).size === 1;
  const anyConsigned = invoice.lines.some((l) => l.consigned && entered(l) > 0);

  const payload = JSON.stringify(
    invoice.lines
      .filter((l) => entered(l) > 0)
      .map((l) => ({
        itemId: l.itemId,
        qty: entered(l),
        sourceLineId: l.lineId,
        source: l.consigned ? "CONSIGNMENT" : "OWNED",
        // The reason the units are free travels with them. Without it the
        // engine books ordinary cost of sales for a giveaway, on an invoice
        // line that charges nothing.
        focReasonId: l.focReasonId,
      }))
  );

  return (
    <>
    {/* The same heading, sheet and commit bar as every other delivery:
        only what this one is answering (an invoice already raised) differs. */}
    <DocHeading
      back={{ href: backHref, label: backLabel }}
      trail={[
        { label: "Deliveries", href: "/sales/deliver" },
        { label: invoice.docNo, href: `/documents/${invoice.id}` },
      ]}
      title="Delivery" status="New" />
    <form action={formAction} className="form wide gr docsheet waved">
      <input type="hidden" name="idempotency_key" value={attemptKey} />
      <input type="hidden" name="partner_id" value={invoice.partnerId} />
      <input type="hidden" name="location_id" value={invoice.locationId ?? ""} />
      <input type="hidden" name="source_document_id" value={invoice.id} />
      <input type="hidden" name="lines" value={payload} />
      <input type="hidden" name="reference" value={reference} />

      {shortConfirmed && <input type="hidden" name="allow_negative_stock" value="true" />}
      {/* Its own field, not folded into the memo. The engine asks for a
          reason and needs an answer it can rely on; a memo is about anything
          and searching it for text would make a posting depend on whether
          somebody happened to type in the right box. */}
      {shortConfirmed && (
        <input type="hidden" name="negative_stock_reason" value={shortReason} />
      )}

      {state && "error" in state && <div className="alert">{state.error}</div>}

      <div className="card doc-info">
        <div className="card-head">
          <h2>Delivery details</h2>
          <Link className="rcv-change" href="/sales/deliver">Change invoice</Link>
        </div>
        <div className="card-body">
          <div className="doc-fields">
            <div className="field">
              <label><Building2 size={13} aria-hidden="true" />Customer</label>
              <input type="text" value={`${invoice.partnerCode} · ${invoice.partnerName}`} readOnly aria-label="Customer" />
            </div>
            <div className="field">
              <label><FileText size={13} aria-hidden="true" />Against invoice</label>
              <span className="rcv-ro"><Link href={`/documents/${invoice.id}`}>{invoice.docNo}</Link></span>
            </div>
            <div className="field">
              <label><ClipboardList size={13} aria-hidden="true" />Sales order</label>
              <span className="rcv-ro">{orderSummary(invoice)}</span>
            </div>
            <div className="field">
              <label><Warehouse size={13} aria-hidden="true" />Ships from</label>
              {/* Fixed to the invoice's warehouse because nothing in this
                  workflow can change it: the delivery is raised against that
                  invoice and posts where it says. Shipping part of an invoice
                  from another warehouse needs a delivery raised there, which is
                  a separate document. */}
              <span className="rcv-ro" title="Fixed by the invoice">
                <Lock size={12} aria-hidden="true" style={{ marginRight: 6 }} />
                {invoice.locationCode ?? "—"}{invoice.locationName ? ` · ${invoice.locationName}` : ""}
              </span>
            </div>
            <div className="field">
              <label htmlFor="dlv_date"><CalendarDays size={13} aria-hidden="true" />Delivery date</label>
              <input id="dlv_date" name="doc_date" type="date" required
                     value={docDate} onChange={(e) => setDocDate(e.target.value)} />
            </div>
          </div>
          <div className="doc-info-foot">
            <details className="moredetails" open={!!memo || reference !== invoice.docNo || undefined}>
              <summary>Additional details <span className="page-sub">(delivery note, remarks)</span></summary>
              <div className="row">
                <div className="field">
                  <label htmlFor="dlv_ref"><Hash size={13} aria-hidden="true" />Reference</label>
                  <input id="dlv_ref" type="text" placeholder="Delivery note no."
                         value={reference} onChange={(e) => setReference(e.target.value)} />
                  <span className="hint">Filled from {invoice.docNo}; change it if the driver carries a delivery note.</span>
                </div>
                <div className="field span-2">
                  <label htmlFor="dlv_memo"><StickyNote size={13} aria-hidden="true" />Remarks</label>
                  <input id="dlv_memo" name="memo" type="text" placeholder="Optional — English or Myanmar"
                         value={memo} onChange={(e) => setMemo(e.target.value)} />
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="tablewrap">
          <table className="linetable grlines vgrid rcv-table">
            <thead>
              <tr>
                <th className="vc-no">No.</th>
                <th>Item</th>
                <th className="r">Invoiced</th>
                <th className="r">Remaining</th>
                <th className="r">On hand</th>
                <th className="r vc-qty">Deliver now <span aria-hidden="true">*</span></th>
                <th className="r">Unit price</th>
                <th className="r">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l, idx) => {
                const isShort = !l.consigned && entered(l) > l.onHand;
                return (
                  <tr key={l.lineId}>
                    <td className="vc-no">{idx + 1}</td>
                    <td>
                      <strong>{l.itemCode}</strong>
                      {l.consigned && <span className="pill tiny" style={{ marginLeft: 6 }}>consigned</span>}
                      {l.isFree && <span className="pill tiny" style={{ marginLeft: 6 }}>free of charge</span>}
                      <div className="subline">{l.itemName}</div>
                    </td>
                    <td className="r">
                      {qty(l.invoicedQty)}{unitOf(l)}
                      {l.deliveredQty > 0 && <div className="subline">{qty(l.deliveredQty)} delivered before</div>}
                    </td>
                    <td className="r">{qty(l.remainingQty)}{unitOf(l)}</td>
                    <td className="r" style={{ color: isShort ? "var(--bad)" : undefined }}>
                      {l.consigned ? <span className="muted">consignor&rsquo;s</span>
                        : `${qty(l.onHand)}${unitOf(l)}`}
                    </td>
                    <td className="r">
                      <span className="rcv-qty">
                        <input type="number" min="0" step="any" required
                               aria-label={`Deliver now, ${l.itemCode}`}
                               value={sending[l.lineId] ?? ""}
                               onChange={(e) => setSending((r) =>
                                 ({ ...r, [l.lineId]: e.target.value }))} />
                        {l.uomCode && <span className="rcv-uom">{l.uomCode}</span>}
                      </span>
                    </td>
                    <td className="r">
                      <span className="rcv-locked" title={`Charged on ${invoice.docNo}`}>
                        <Lock size={12} aria-hidden="true" /> {money(l.unitPrice)}
                      </span>
                    </td>
                    <td className="r">{money(entered(l) * l.unitPrice)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="subline rcv-costnote">
          <Lock size={11} aria-hidden="true" /> Unit price comes from {invoice.docNo}. What these goods cost is
          drawn from the oldest stock on the shelf when this posts.
        </p>
      </div>

      {totals.short.length > 0 && (
        <div className="alert" style={{
          borderColor: shortConfirmed ? "var(--warn)" : "var(--bad)",
          color: shortConfirmed ? "var(--warn)" : "var(--bad)",
        }}>
          <AlertCircle size={15} aria-hidden="true" />{" "}
          <strong>
            {shortConfirmed
              ? "Confirmed: more is leaving than the books show."
              : `Less stock on the books than is leaving${
                  invoice.locationCode ? ` at ${invoice.locationCode}` : ""}.`}
          </strong>
          <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
            {totals.short.map((l) => (
              <li key={l.lineId}>
                {l.itemCode}: {qty(entered(l))} going out, {qty(l.onHand)} recorded
                {" — balance becomes "}
                <strong>{qty(l.onHand - entered(l))}{l.uomCode ? ` ${l.uomCode}` : ""}</strong>
              </li>
            ))}
          </ul>
          <div className="muted" style={{ marginTop: "0.35rem" }}>
            {shortConfirmed
              ? `Reason: ${shortReason || "—"}. Cost of sale for the units with no stock `
                + `behind them is provisional until the receipt that brings them `
                + `in is entered; recording it later corrects the cost.`
              : "This is allowed where the goods are physically there and their "
                + "receipt has not been entered yet. It has to be said out loud."}
          </div>
          {!shortConfirmed ? (
            <div style={{ marginTop: "0.5rem" }}>
              <button type="button" className="btn ghost" onClick={() => setAskShort(true)}>
                Confirm the goods are physically there
              </button>
            </div>
          ) : (
            <div className="field" style={{ marginTop: "0.6rem", color: "var(--ink)" }}>
              <label htmlFor="dlv_short_reason">Why the books are short</label>
              <input id="dlv_short_reason" type="text" required
                     placeholder="e.g. supplier delivery not yet entered"
                     value={shortReason} onChange={(e) => setShortReason(e.target.value)} />
              <span className="hint">Kept with the delivery, alongside the confirmation.</span>
            </div>
          )}
        </div>
      )}

      <div className="gr-bottom">
        <div />
        <div className="gr-side">
          <div className="card">
            <div className="card-head"><h2>Summary (MMK)</h2></div>
            <div className="card-body">
              <dl className="gr-sum">
                <dt>Lines</dt><dd>{invoice.lines.filter((l) => entered(l) > 0).length}</dd>
                <dt>Going out</dt><dd>{oneUnit ? `${qty(totals.going)}${unit}` : perItem(invoice, sending)}</dd>
                <dt>Invoice</dt><dd>{invFullyDelivered && totals.going > 0 ? "Fully delivered" : "Partly delivered"}</dd>
              </dl>
              <div className="gr-total"><span>Invoiced value</span><span>{money(totals.charged)}</span></div>
            </div>
          </div>

          {/* What posting will do, worked out from the quantities above. */}
          <details className="card gr-preview" open>
            <summary className="card-head">
              <h2>What this delivery does</h2>
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <div className="card-body">
              <dl className="gr-sum rcv-effects">
                <dt>Out of the warehouse</dt>
                <dd>{oneUnit ? `${qty(totals.going)}${unit}` : perItem(invoice, sending)}</dd>
                <dt>Matched to invoice</dt>
                <dd><Link href={`/documents/${invoice.id}`}>{invoice.docNo}</Link></dd>
                {totals.orders.length === 0 ? (
                  <><dt>Sales order</dt><dd className="muted">No linked order</dd></>
                ) : totals.orders.map((o) => (
                  <Fragment key={o.orderId}>
                    <dt>Answers <Link href={`/documents/${o.orderId}`}>{o.orderNo}</Link></dt>
                    <dd>{qty(o.allocating)}{unit} · {qty(o.fulfilled + o.allocating)} of {qty(o.ordered)} delivered</dd>
                  </Fragment>
                ))}
                {totals.unallocated > 0 && (
                  <><dt>Answering no order</dt><dd>{qty(totals.unallocated)}{oneUnit ? unit : ""}</dd></>
                )}
                <dt>Stock</dt><dd>{anyConsigned ? "Includes consigned goods" : "Our own stock"}</dd>
                <dt>Cost of sale</dt><dd className="muted">FIFO at posting</dd>
                <dt>Customer payment</dt><dd className="muted">Unchanged</dd>
              </dl>
              <p className="subline" style={{ marginTop: 8 }}>
                Matches the existing invoice. No new invoice or receipt is created.
              </p>
            </div>
          </details>
        </div>
      </div>

      {related}

      <NegativeStockConfirm
        open={askShort}
        shortfalls={totals.short.map((l): Shortfall => ({
          itemCode: l.itemCode, itemName: l.itemName,
          uomCode: l.uomCode ?? "", required: entered(l), recorded: l.onHand,
        }))}
        onCancel={() => setAskShort(false)}
        onConfirm={() => { setShortConfirmed(true); setAskShort(false); }}
      />

      <div className="actions form-commit">
        {totals.short.length > 0 && (!shortConfirmed || !shortReason.trim()) && (
          <span className="commit-hint" role="status">
            {shortConfirmed ? "Say why the books are short to post" : "Confirm the stock shortfall to post"}
          </span>
        )}
        <button type="submit"
                disabled={pending || totals.going <= 0
                  || (totals.short.length > 0 && (!shortConfirmed || !shortReason.trim()))}>
          {pending ? "Posting…" : `Post delivery · ${qty(totals.going)}${oneUnit ? unit : ""}`}
        </button>
        <Link className="btn ghost" href={backHref}>{backLabel}</Link>
      </div>
    </form>
    </>
  );
}

function orderSummary(invoice: Invoice) {
  const seen = new Map<string, string>();
  for (const l of invoice.lines) if (l.orderId && l.orderNo) seen.set(l.orderId, l.orderNo);
  if (seen.size === 0) return <span className="muted">No linked order</span>;
  return (
    <span>
      {[...seen.entries()].map(([id, no], i) => (
        <span key={id}>
          {i > 0 ? " · " : ""}
          <Link href={`/documents/${id}`}>{no}</Link>
        </span>
      ))}
    </span>
  );
}

/** Ten cartons and five pieces are not fifteen of anything. */
function perItem(invoice: Invoice, sending: Record<string, string>) {
  const parts = invoice.lines
    .map((l) => ({ l, q: Number(sending[l.lineId]) || 0 }))
    .filter((x) => x.q > 0)
    .map(({ l, q }) => `${qty(q)}${l.uomCode ? ` ${l.uomCode}` : ""} ${l.itemCode}`);
  return parts.length === 0 ? "—" : parts.join(" · ");
}

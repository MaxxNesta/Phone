"use client";
import { WarehouseSelect } from "@/components/warehouse-select";

import { Fragment, useMemo, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { Lock, Building2, FileText, ClipboardList, Warehouse, CalendarDays, Clock, Hash, StickyNote, ChevronDown } from "lucide-react";
import { DocHeading } from "./doc-heading";
import type { ActionResult } from "@/lib/actions";
import { RelatedDocumentsPanel } from "./related-documents";
import { SerialEntry, type ScannedSerial } from "./serial-entry";
import { TrackMode } from "./track-mode";
import { useNotice } from "@/components/toast";

type BillLine = {
  lineId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  /** Each unit is named by IMEI. */
  tracksSerial?: boolean;
  /** Optional tracking: this receipt may name each unit or count them. */
  optionalSerial?: boolean;
  uomCode: string | null;
  billedQty: number;
  receivedQty: number;
  remainingQty: number;
  unitPrice: number;
  orderLineId: string | null;
  orderId: string | null;
  orderNo: string | null;
  orderOrdered: number | null;
  orderFulfilled: number | null;
  orderRemaining: number | null;
};

type Bill = {
  id: string; docNo: string; docDate: string;
  partnerId: string; partnerCode: string; partnerName: string;
  locationId: string | null;
  lines: BillLine[];
};

type Location = { id: string; code: string; name: string };

const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });
const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * Receiving goods against a bill that arrived before them.
 *
 * The bill is chosen before this screen opens, so the screen leads with what
 * it is working on rather than asking again: which bill, which order behind
 * it, which supplier. Changing it is a deliberate second action, not the
 * first field on the form.
 *
 * Two questions are kept apart throughout, because they have different
 * answers and conflating them is what made the old screen misleading. What
 * these goods match on the bill is one; what they allocate to the order is
 * another. Twenty units can match a bill in full and answer only the ten an
 * order still expects, and a screen that prints one figure for both is lying
 * about one of them.
 *
 * The preview is a calculation, not a reading of the link. An order being
 * connected to this bill does not mean every carton arriving answers it —
 * the order may have less left than is being received, or be answered by a
 * different line. So the figures below are worked out from the quantity
 * actually entered, against what each order line still expects, and they are
 * recomputed as that quantity changes. Where a bill names no order the
 * fulfilment rows say so rather than guessing.
 */
export function ReceiveAgainstBill({
  action, bill, locations, today, now, related, backHref, backLabel,
}: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  bill: Bill;
  locations: Location[];
  today: string;
  now: string;
  related: React.ReactNode;
  backHref: string;
  backLabel: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never, null,
  );
  useNotice(state);
  const [attemptKey] = useState(() => crypto.randomUUID());
  const [locationId, setLocationId] = useState(bill.locationId ?? locations[0]?.id ?? "");
  const [docDate, setDocDate] = useState(today);
  const [time, setTime] = useState(now);
  const [reference, setReference] = useState("");
  const [memo, setMemo] = useState("");

  // Everything still awaited starts filled in: the common case is that what
  // was billed is what turned up.
  const [receiving, setReceiving] = useState<Record<string, string>>(() =>
    Object.fromEntries(bill.lines.map((l) => [l.lineId, String(l.remainingQty)])));

  /** IMEIs scanned per bill line, for the lines that are phones. */
  const [scans, setScans] = useState<Record<string, ScannedSerial[]>>({});
  // Optional tracking, per bill line: true when this receipt names its units.
  const [withSerials, setWithSerials] = useState<Record<string, boolean>>({});
  const named = (l: BillLine) => !!l.tracksSerial || (!!l.optionalSerial && !!withSerials[l.lineId]);

  const entered = (l: BillLine) => Number(receiving[l.lineId]) || 0;
  const unitOf = (l: BillLine) => (l.uomCode ? ` ${l.uomCode}` : "");

  const totals = useMemo(() => {
    let received = 0;
    let value = 0;
    // Per order, worked out line by line: an order takes what it still
    // expects and no more, and the rest of the line answers no order at all.
    const orders = new Map<string, {
      orderNo: string; orderId: string;
      fulfilled: number; ordered: number; allocating: number;
    }>();
    let unallocated = 0;

    for (const l of bill.lines) {
      const q = entered(l);
      if (q <= 0) continue;
      received += q;
      value += q * l.unitPrice;

      if (!l.orderId || !l.orderNo || l.orderRemaining === null) {
        unallocated += q;
        continue;
      }
      const seen = orders.get(l.orderId) ?? {
        orderNo: l.orderNo, orderId: l.orderId,
        fulfilled: l.orderFulfilled ?? 0, ordered: l.orderOrdered ?? 0, allocating: 0,
      };
      // What this order line can still take, less anything earlier lines of
      // this same receipt have already claimed from it.
      const left = Math.max((l.orderRemaining ?? 0) - seen.allocating, 0);
      const takes = Math.min(q, left);
      seen.allocating += takes;
      orders.set(l.orderId, seen);
      unallocated += q - takes;
    }

    return {
      received: Math.round(received * 10000) / 10000,
      value: Math.round(value * 10000) / 10000,
      unallocated: Math.round(unallocated * 10000) / 10000,
      orders: [...orders.values()],
    };
  }, [receiving, bill.lines]);

  const billTotalRemaining = bill.lines.reduce((t, l) => t + l.remainingQty, 0);
  const billFullyReceived = totals.received >= billTotalRemaining - 0.0001;
  const unit = bill.lines[0]?.uomCode ? ` ${bill.lines[0].uomCode}` : "";
  // One unit across the bill, or none named at all: "15 CTN" for ten cartons
  // and five pieces would be a figure that is simply not true.
  const oneUnit = new Set(bill.lines.map((l) => l.uomCode ?? "")).size === 1;

  const payload = JSON.stringify(
    bill.lines
      .filter((l) => entered(l) > 0)
      .map((l) => ({
        itemId: l.itemId,
        qty: entered(l),
        unitCost: l.unitPrice,
        // The bill line these goods answer. The order behind it is reached
        // from here by the engine, which resolves the version that stands —
        // naming it from the browser would freeze a stale one.
        sourceLineId: l.lineId,
        serials: (named(l) ? scans[l.lineId] ?? [] : []).map((x) => x.serial),
        unitDetails: (named(l) ? scans[l.lineId] ?? [] : []).filter((x) => x.imei2)
          .map((x) => ({ serial: x.serial, imei2: x.imei2 })),
      }))
  );
  const serialShort = bill.lines.some((l) => named(l) && entered(l) > 0
    && (scans[l.lineId]?.length ?? 0) !== entered(l));

  return (
    <>
    {/* The same heading, sheet and commit bar as every other goods receipt:
        only what this one is answering (a bill already in) differs. */}
    <DocHeading
      back={{ href: backHref, label: backLabel }}
      trail={[
        { label: "Goods receipts", href: "/purchases/receive" },
        { label: bill.docNo, href: `/documents/${bill.id}` },
      ]}
      title="Goods receipt" status="New" />
    <form action={formAction} className="form wide gr docsheet waved">
      <input type="hidden" name="idempotency_key" value={attemptKey} />
      <input type="hidden" name="partner_id" value={bill.partnerId} />
      <input type="hidden" name="source_document_id" value={bill.id} />
      <input type="hidden" name="lines" value={payload} />

      {state && "error" in state && <div className="alert">{state.error}</div>}

      <div className="card doc-info">
        <div className="card-head">
          <h2>Receipt details</h2>
          <Link className="rcv-change" href="/purchases/receive/new">Change bill</Link>
        </div>
        <div className="card-body">
          <div className="doc-fields">
            <div className="field">
              <label><Building2 size={13} aria-hidden="true" />Supplier</label>
              <input type="text" value={`${bill.partnerCode} · ${bill.partnerName}`} readOnly aria-label="Supplier" />
            </div>
            <div className="field">
              <label><FileText size={13} aria-hidden="true" />Against bill</label>
              <span className="rcv-ro"><Link href={`/documents/${bill.id}`}>{bill.docNo}</Link></span>
            </div>
            <div className="field">
              <label><ClipboardList size={13} aria-hidden="true" />Purchase order</label>
              <span className="rcv-ro">{orderSummary(bill)}</span>
            </div>
            <div className="field">
              <label htmlFor="rcv_loc"><Warehouse size={13} aria-hidden="true" />Warehouse</label>
              <WarehouseSelect locations={locations} id="rcv_loc" name="location_id" required
                      value={locationId} onChange={(e) => setLocationId(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="rcv_date"><CalendarDays size={13} aria-hidden="true" />GR date</label>
              <input id="rcv_date" name="doc_date" type="date" required
                     value={docDate} onChange={(e) => setDocDate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="rcv_time"><Clock size={13} aria-hidden="true" />Time</label>
              <input id="rcv_time" name="received_time" type="time"
                     value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div className="doc-info-foot">
            <details className="moredetails" open={!!(reference || memo) || undefined}>
              <summary>Additional details <span className="page-sub">(delivery reference, remarks)</span></summary>
              <div className="row">
                <div className="field">
                  <label htmlFor="rcv_ref"><Hash size={13} aria-hidden="true" />Reference</label>
                  <input id="rcv_ref" name="reference" type="text" placeholder="Delivery note no."
                         value={reference} onChange={(e) => setReference(e.target.value)} />
                </div>
                <div className="field span-2">
                  <label htmlFor="rcv_memo"><StickyNote size={13} aria-hidden="true" />Remarks</label>
                  <input id="rcv_memo" name="memo" type="text" placeholder="Optional — English or Myanmar"
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
                <th className="r">Billed</th>
                <th className="r">Received before</th>
                <th className="r">Remaining</th>
                <th className="r vc-qty">Receive now <span aria-hidden="true">*</span></th>
                <th className="r">Unit cost</th>
                <th className="r">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {bill.lines.map((l, idx) => (
                <Fragment key={l.lineId}>
                <tr>
                  <td className="vc-no">{idx + 1}</td>
                  <td>
                    <strong>{l.itemCode}</strong>
                    <div className="subline">{l.itemName}</div>
                  </td>
                  <td className="r">{qty(l.billedQty)}{unitOf(l)}</td>
                  <td className="r">{qty(l.receivedQty)}{unitOf(l)}</td>
                  <td className="r">{qty(l.remainingQty)}{unitOf(l)}</td>
                  <td className="r">
                    <span className="rcv-qty">
                      <input type="number" min="0" step="any" required
                             aria-label={`Receive now, ${l.itemCode}`}
                             value={receiving[l.lineId] ?? ""}
                             onChange={(e) => setReceiving((r) =>
                               ({ ...r, [l.lineId]: e.target.value }))} />
                      {l.uomCode && <span className="rcv-uom">{l.uomCode}</span>}
                    </span>
                  </td>
                  <td className="r">
                    {/* The bill decided this. Overtyping it here put the gap
                        between the two in the P&L and carried the stock at a
                        figure nobody owed. */}
                    <span className="rcv-locked" title={`From ${bill.docNo}`}>
                      <Lock size={12} aria-hidden="true" /> {money(l.unitPrice)}
                    </span>
                  </td>
                  <td className="r">{money(entered(l) * l.unitPrice)}</td>
                </tr>
                {l.optionalSerial && (
                  <tr className="batchrow">
                    <td colSpan={8}>
                      <TrackMode code={l.itemCode} on={!!withSerials[l.lineId]}
                        onChange={(on) => setWithSerials((m) => ({ ...m, [l.lineId]: on }))} />
                    </td>
                  </tr>
                )}
                {named(l) && (
                  <tr className="batchrow">
                    <td colSpan={8}>
                      <SerialEntry
                        label={`${l.itemCode} — ${l.optionalSerial ? "serial number" : "IMEI"} of each unit`}
                        qty={entered(l)}
                        value={scans[l.lineId] ?? []}
                        withImei2={!l.optionalSerial}
                        onChange={(v) => {
                          setScans((m) => ({ ...m, [l.lineId]: v }));
                          // Scanning drives the quantity until one is typed.
                          if (!(entered(l) > 0) || entered(l) === (scans[l.lineId]?.length ?? 0)) {
                            setReceiving((r) => ({ ...r, [l.lineId]: String(v.length) }));
                          }
                        }}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="subline rcv-costnote"><Lock size={11} aria-hidden="true" /> Unit cost comes from {bill.docNo}.</p>
      </div>

      <div className="gr-bottom">
        <div />
        <div className="gr-side">
          <div className="card">
            <div className="card-head"><h2>Summary (MMK)</h2></div>
            <div className="card-body">
              <dl className="gr-sum">
                <dt>Lines</dt><dd>{bill.lines.filter((l) => entered(l) > 0).length}</dd>
                <dt>Received</dt><dd>{oneUnit ? `${qty(totals.received)}${unit}` : perItem(bill, receiving)}</dd>
                <dt>Bill</dt><dd>{billFullyReceived && totals.received > 0 ? "Fully received" : "Partly received"}</dd>
              </dl>
              <div className="gr-total"><span>Received value</span><span>{money(totals.value)}</span></div>
            </div>
          </div>

          {/* What posting will do, worked out from the quantities above: what it
              matches on the bill, what it answers on the order, what answers none. */}
          <details className="card gr-preview" open>
            <summary className="card-head">
              <h2>What this receipt does</h2>
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <div className="card-body">
              <dl className="gr-sum rcv-effects">
                <dt>Into the warehouse</dt>
                <dd>{oneUnit ? `${qty(totals.received)}${unit}` : perItem(bill, receiving)}</dd>
                <dt>Matched to bill</dt>
                <dd><Link href={`/documents/${bill.id}`}>{bill.docNo}</Link></dd>
                {totals.orders.length === 0 ? (
                  <><dt>Purchase order</dt><dd className="muted">No linked order</dd></>
                ) : totals.orders.map((o) => (
                  <Fragment key={o.orderId}>
                    <dt>Answers <Link href={`/documents/${o.orderId}`}>{o.orderNo}</Link></dt>
                    <dd>{qty(o.allocating)}{unit} · {qty(o.fulfilled + o.allocating)} of {qty(o.ordered)} received</dd>
                  </Fragment>
                ))}
                {totals.unallocated > 0 && (
                  <><dt>Answering no order</dt><dd>{qty(totals.unallocated)}{oneUnit ? unit : ""}</dd></>
                )}
                <dt>Supplier payment</dt><dd className="muted">Unchanged</dd>
              </dl>
              <p className="subline" style={{ marginTop: 8 }}>
                Matches the existing bill. No new invoice or payment is created.
              </p>
            </div>
          </details>
        </div>
      </div>

      {related}

      <div className="actions form-commit">
        {serialShort && (
          <span className="commit-hint" role="status">Every unit needs a valid IMEI or serial to post: fix the ones in red</span>
        )}
        <button type="submit" disabled={pending || totals.received <= 0 || serialShort}>
          {pending ? "Posting…" : `Post GR · ${qty(totals.received)}${oneUnit ? unit : ""}`}
        </button>
        <Link className="btn ghost" href={backHref}>{backLabel}</Link>
      </div>
    </form>
    </>
  );
}

/** The orders behind this bill, named rather than counted. */
function orderSummary(bill: Bill) {
  const seen = new Map<string, string>();
  for (const l of bill.lines) if (l.orderId && l.orderNo) seen.set(l.orderId, l.orderNo);
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

/**
 * Quantities per item, where the bill mixes units.
 *
 * Ten cartons and five pieces are not fifteen of anything, and summing them
 * under the first line's unit prints a figure that is simply untrue.
 */
function perItem(bill: Bill, receiving: Record<string, string>) {
  const parts = bill.lines
    .map((l) => ({ l, q: Number(receiving[l.lineId]) || 0 }))
    .filter((x) => x.q > 0)
    .map(({ l, q }) => `${qty(q)}${l.uomCode ? ` ${l.uomCode}` : ""} ${l.itemCode}`);
  return parts.length === 0 ? "—" : parts.join(" · ");
}

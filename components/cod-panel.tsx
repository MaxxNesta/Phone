"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConfirmDelete } from "./confirm-delete";
import { useNotice } from "@/components/toast";
import {
  depositAction, dispatchCodAction, handoverAction, lostInTransitAction, notHomeAction, receiveReturnAction, refusedAction,
} from "@/lib/cod-actions";
import type { CodSheet, Parcel } from "@/lib/cod";
import { collectText } from "@/lib/cod-collect";
import { RowMenu } from "./row-menu";

type Opt = { id: string; name: string };
type Account = { id: string; label: string };
type Act = (prev: { error?: string; ok?: string } | null, fd: FormData) => Promise<{ error?: string; ok?: string } | null>;

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const STATE: Record<Parcel["state"], string> = {
  OUT: "Out for delivery", NOT_HOME: "Not home · retry", REFUSED: "Refused · return in transit",
  RETURNED: "Back in stock", HANDED_OVER: "Delivered", LOST: "Lost in transit",
};
const TONE: Record<Parcel["state"], string> = { OUT: "info", NOT_HOME: "warn", REFUSED: "warn", RETURNED: "", HANDED_OVER: "ok", LOST: "bad" };

/** One dialog bound to one server action; reopens fresh after it succeeds. */
function Step({ action, children, ...rest }: { action: Act; children: React.ReactNode } & Omit<Parameters<typeof ConfirmDelete>[0], "action" | "pending" | "error" | "children">) {
  const router = useRouter();
  const [state, run, pending] = useActionState(action, null);
  const [round, setRound] = useState(0);
  useNotice(state, { errors: false });
  useEffect(() => { if (state?.ok) { setRound((r) => r + 1); router.refresh(); } }, [state, router]);
  const [key] = useState(() => crypto.randomUUID());
  return (
    <ConfirmDelete key={round} action={run} pending={pending} error={state?.error ?? null} failTitle="Not done" confirmClassName="" {...rest}>
      <input type="hidden" name="idempotency_key" value={`${key}-${round}`} />
      <div className="cod-collect">{children}</div>
    </ConfirmDelete>
  );
}

function DateField({ today }: { today: string }) {
  return (
    <div className="field">
      <label>Date</label>
      <input name="doc_date" type="date" defaultValue={today} max={today} required />
    </div>
  );
}

/** How the customer paid: cash to whoever carried it, or straight into the company's bank or wallet. */
function PayFields({ parcel, amount, accounts, deposit }: { parcel: Parcel; amount: number; accounts: Account[]; deposit?: boolean }) {
  const carrier = parcel.collector?.kind === "COURIER" ? "COURIER" : "DRIVER";
  const [to, setTo] = useState<"DRIVER" | "COURIER" | "ACCOUNT">(carrier);
  return (
    <>
      <div className="field">
        <label>Paid to</label>
        <select name="pay_to" value={to} onChange={(e) => setTo(e.target.value as typeof to)}>
          <option value={carrier}>{parcel.collector ? `${parcel.collector.name} (${carrier === "COURIER" ? "courier" : "driver"}), cash` : "Cash"}</option>
          {accounts.length > 0 && <option value="ACCOUNT">Straight into our bank or wallet</option>}
        </select>
      </div>
      <div className="field">
        <label>{deposit ? "Amount paid" : "Amount collected"}</label>
        <input name="amount" type="number" min="0" step="any" defaultValue={deposit ? undefined : amount} required />
      </div>
      {to === "ACCOUNT" && (
        <>
          <div className="field">
            <label>Into</label>
            <select name="account_id" required>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
          </div>
          <div className="field">
            <label>Transaction ID</label>
            <input name="reference" maxLength={80} autoComplete="off" />
          </div>
          <label className="check cod-wide"><input type="checkbox" name="verified" /> I can see this money in the account</label>
        </>
      )}
    </>
  );
}

/** Back to the shop, refused or nobody home: the same IMEIs scanned, anything else counted. */
function ReceiveBack({ p, today, primary }: { p: Parcel; today: string; primary?: boolean }) {
  const imeis = p.lines.flatMap((l) => l.serials);
  const counted = p.lines.filter((l) => l.serials.length === 0);
  return (
    <Step action={receiveReturnAction} className={primary ? "btn primary" : ""}
      label={primary ? "Receive returned phone" : "Back to shop"} pendingLabel="Posting…"
      title={`Receive ${p.no} back`}
      detail="Only what went out comes back: scan each IMEI, count anything without one. It goes back on sale in the warehouse; the invoice can be dispatched again."
      confirmLabel="Back in stock">
      <input type="hidden" name="parcel_id" value={p.id} />
      <DateField today={today} />
      {imeis.length > 0 && (
        <div className="field cod-wide">
          <label>Scan IMEIs</label>
          <textarea name="scanned" rows={3} required placeholder="Scan each phone" />
          <span className="hint">Expected: {imeis.join(", ")}</span>
        </div>
      )}
      {counted.map((l) => (
        <div key={l.lineId} className="field">
          <label>{l.item} · {l.qty} went out</label>
          <input name={`count_${l.lineId}`} type="number" min="0" step="1" required placeholder="Count back" />
        </div>
      ))}
    </Step>
  );
}

/** Paid at the door: this parcel, its IMEIs, and the cash it takes now (deposit and charge already counted). */
function Handover({ p, today, accounts, primary }: { p: Parcel; today: string; accounts: Account[]; primary?: boolean }) {
  return (
    <Step action={handoverAction} className={primary ? "btn primary" : "btn tiny"}
      label={primary ? "Confirm payment & hand over" : "Hand over"} pendingLabel="Posting…"
      title={`Hand over ${p.no}`}
      detail={`${p.lines.map((l) => `${l.item}${l.serials.length ? ` (${l.serials.join(", ")})` : ""}`).join("; ")}. `
        + `${fmt(p.collectNow)} MMK to collect${p.deposit > 0 ? `, after the ${fmt(Math.min(p.deposit, p.goods + p.extras))} deposit` : ""}. `
        + "The phone is released only when this is paid in full."}
      confirmLabel="Paid · hand over">
      <input type="hidden" name="parcel_id" value={p.id} />
      <DateField today={today} />
      <PayFields parcel={p} amount={p.collectNow} accounts={accounts} />
    </Step>
  );
}

/** Never arrived, not coming back: written off at cost, borne by the shop or by whoever carried it. */
function LostInTransit({ p, today }: { p: Parcel; today: string }) {
  return (
    <Step action={lostInTransitAction} className="" label="Lost in transit" pendingLabel="Posting…"
      title={`${p.no} lost in transit`}
      detail={`${p.lines.map((l) => (l.serials.length ? `IMEI ${l.serials.join(", ")}` : `${l.item} × ${l.qty}`)).join("; ")} `
        + "come off stock at their cost: to Inventory Damage if the shop bears it, or owed by the driver or courier if they pay. The customer owes nothing and the invoice can be dispatched again."}
      confirmLabel="Write off">
      <input type="hidden" name="parcel_id" value={p.id} />
      <DateField today={today} />
      <div className="field">
        <label>Who bears the loss</label>
        <select name="bearer" defaultValue="SHOP">
          <option value="SHOP">The shop</option>
          {p.collector && <option value="CARRIER">{p.collector.name} pays</option>}
        </select>
      </div>
      <div className="field cod-wide"><label>What happened</label><input name="reason" required placeholder="Stolen on the way, lost by the courier…" /></div>
    </Step>
  );
}

export function CodPanel({ invoiceId, invoiceNo, sheet, drivers, couriers, accounts, today, canPost, canAdjust = false, defaultCollector }: {
  invoiceId: string; invoiceNo: string; sheet: CodSheet; drivers: Opt[]; couriers: Opt[]; accounts: Account[];
  today: string; canPost: boolean; canAdjust?: boolean; defaultCollector: string;
}) {
  const open = sheet.parcels.filter((p) => p.state === "OUT" || p.state === "NOT_HOME");
  const returning = sheet.parcels.filter((p) => p.state === "REFUSED");
  const handed = sheet.parcels.filter((p) => p.state === "HANDED_OVER");
  const left = sheet.toDispatch.filter((l) => l.qty > 0);
  const total = sheet.toDispatch.reduce((t, l) => t + l.qty, 0) + sheet.parcels.filter((p) => p.state !== "RETURNED")
    .reduce((t, p) => t + p.lines.reduce((s, l) => s + l.qty, 0), 0);
  const handedQty = handed.reduce((t, p) => t + p.lines.reduce((s, l) => s + l.qty, 0), 0);
  const outQty = [...open, ...returning].reduce((t, p) => t + p.lines.reduce((s, l) => s + l.qty, 0), 0);

  const backQty = returning.reduce((t, p) => t + p.lines.reduce((s, l) => s + l.qty, 0), 0);
  const delivery = handedQty > 0 && handedQty === total ? "Delivered"
    : backQty > 0 ? `Refused · ${backQty} returning to the shop`
    : outQty > 0 ? `Out for delivery · ${outQty} of ${total}${open[0]?.collector ? ` with ${open[0].collector.name}` : ""}`
    : handedQty > 0 ? `Delivered ${handedQty} of ${total}`
    : "Waiting to dispatch";
  const payment = sheet.owed > 0.005 ? `Owes ${fmt(sheet.owed)}`
    : sheet.billed > 0 ? `Customer paid ${fmt(sheet.paid)}`
    : sheet.deposits > 0.005 ? `Deposit ${fmt(sheet.deposits)} paid · the rest at handover`
    : "Nothing owed until handover";
  const settle = [
    ...sheet.driverHolds.map((d) => `Driver ${d.name} holds ${fmt(d.amount)} MMK`),
    ...sheet.courierHolds.map((c) => `${c.name} holds ${fmt(c.amount)} MMK`),
    ...(sheet.direct > 0 ? [`${fmt(sheet.direct)} MMK paid straight to our account`] : []),
  ];

  const [dispatchLines, setDispatchLines] = useState(() =>
    Object.fromEntries(left.map((l) => [l.lineId, { qty: l.qty, serials: "" }])));
  const linesJson = useMemo(() => JSON.stringify(left.map((l) => ({
    lineId: l.lineId, qty: Number(dispatchLines[l.lineId]?.qty ?? 0),
    serials: (dispatchLines[l.lineId]?.serials ?? "").split(/[\s,]+/).filter(Boolean),
  })).filter((l) => l.qty > 0)), [left, dispatchLines]);

  const first = open[0];
  const oneProduct = new Set([...sheet.parcels.flatMap((p) => p.lines.map((l) => l.itemId)), ...sheet.toDispatch.map((l) => l.itemId)]).size <= 1;

  /* One primary action: whatever moves this sale forward next. */
  let primary: React.ReactNode = null;
  if (canPost && returning[0]) {
    primary = <ReceiveBack p={returning[0]} today={today} primary />;
  } else if (canPost && first && open.length === 1) {
    // One parcel out: its handover is the next step. With several, each row has its own.
    primary = <Handover p={first} today={today} accounts={accounts} primary />;
  } else if (canPost && left.length > 0) {
    primary = (
      <Step action={dispatchCodAction} className="btn primary" label="Dispatch" pendingLabel="Posting…"
        title={`Dispatch ${invoiceNo}`} detail="The phones leave the warehouse with the driver or courier. They stay company stock, out of sale, until handed over and paid."
        confirmLabel="Dispatch">
        <input type="hidden" name="invoice_id" value={invoiceId} />
        <input type="hidden" name="lines" value={linesJson} />
        <div className="field">
          <label>Delivered by</label>
          <select name="collector" defaultValue={defaultCollector} required>
            <option value="" disabled>Choose…</option>
            {drivers.length > 0 && <optgroup label="Our drivers">{drivers.map((d) => <option key={d.id} value={`D:${d.id}`}>{d.name}</option>)}</optgroup>}
            {couriers.length > 0 && <optgroup label="Courier companies">{couriers.map((c) => <option key={c.id} value={`C:${c.id}`}>{c.name}</option>)}</optgroup>}
          </select>
        </div>
        <DateField today={today} />
        {left.map((l) => (
          <div key={l.lineId} className="field cod-wide">
            <label>{l.item} · {l.qty} to go</label>
            <div className="cod-line">
              <input type="number" min="0" max={l.qty} step="1" value={dispatchLines[l.lineId]?.qty ?? 0} aria-label="Quantity"
                onChange={(e) => setDispatchLines((m) => ({ ...m, [l.lineId]: { ...m[l.lineId], qty: Number(e.target.value) } }))} />
              {l.serial && (
                <textarea rows={2} placeholder="Scan the IMEIs going out" value={dispatchLines[l.lineId]?.serials ?? ""}
                  onChange={(e) => setDispatchLines((m) => ({ ...m, [l.lineId]: { ...m[l.lineId], serials: e.target.value } }))} />
              )}
            </div>
          </div>
        ))}
      </Step>
    );
  } else if (open.length === 0 && sheet.driverHolds[0]) {
    primary = <Link href={`/receivables/drivers?driver=${sheet.driverHolds[0].driverId}`} className="btn primary">Receive from driver</Link>;
  } else if (open.length === 0 && sheet.courierHolds[0]) {
    primary = <Link href={`/receivables/couriers/pay?courier=${sheet.courierHolds[0].courierId}`} className="btn primary">Courier pay-in</Link>;
  }

  return (
    <section className="dl-sec cod-sec" aria-label="Cash on delivery">
      <div className="dl-sec-head">
        <h2>Cash on delivery</h2>
        {primary && <span className="dl-sec-end">{primary}</span>}
      </div>
      {/* Three facts, side by side, ruled like the details above: no boxes. */}
      <dl className="cod-facts">
        <div><dt>Delivery</dt><dd>{delivery}</dd></div>
        <div><dt>Customer payment</dt><dd>{payment}
          {sheet.deposits > 0.005 && sheet.billed > 0 && <span className="cod-sub">Deposit {fmt(sheet.deposits)} waiting for the next handover</span>}</dd></div>
        <div><dt>Driver / courier settlement</dt><dd>{settle.length ? settle.join(" · ") : sheet.billed > 0 ? "Settled" : "Nothing collected yet"}</dd></div>
      </dl>
      {sheet.parcels.length > 0 && (
        <div className="dl-tablewrap">
          <table className="dl-table cod-parcels">
            <thead><tr><th>Parcel</th><th>In this parcel</th><th>With</th><th>Status</th><th className="r">To collect</th><th /></tr></thead>
            <tbody>
              {sheet.parcels.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/documents/${p.id}`} className="m dl-link">{p.no}</Link>
                    <span className="cod-sub">{p.date} · <Link href={`/sales/deliver/slip/${p.id}`} className="dl-link">Slip</Link></span></td>
                  {/* The Items section names the product; a parcel says which units it holds.
                      The product is named here only when the invoice has more than one. */}
                  <td>{p.lines.map((l) => (
                    <div key={l.lineId}>
                      {oneProduct ? null : <span className="cod-sub cod-item">{l.item}</span>}
                      {l.serials.length ? `IMEI ${l.serials.join(", ")}` : `${l.qty} unit${l.qty === 1 ? "" : "s"}`}
                    </div>))}</td>
                  <td>{p.collector?.name ?? "—"}</td>
                  <td>
                    <span className={`dl-pill ${TONE[p.state] || "neutral"}`}>{STATE[p.state]}</span>
                    {p.lastReason && <span className="cod-sub">{p.lastReason}{p.retryOn ? ` · retry ${p.retryOn}` : ""}</span>}
                    {p.closedBy && <span className="cod-sub"><Link href={`/documents/${p.closedBy}`} className="dl-link">{p.closedByNo}</Link></span>}
                  </td>
                  <td className="r cod-collect-cell">{p.state === "OUT" || p.state === "NOT_HOME" ? (() => {
                    // "705,000 MMK" on top; "1,000,000 MMK if ST… goes first" beneath, smaller.
                    const [main, alt] = collectText(p).replace(/^Collect /, "").split(" (");
                    return <>{main}{alt && <span className="cod-sub">{alt.replace(/\)$/, "")}</span>}</>;
                  })() : "—"}</td>
                  <td className="tight">
                    {canPost && (p.state === "OUT" || p.state === "NOT_HOME") && (
                      <span className="cod-row-actions">
                        {open.length > 1 && <Handover p={p} today={today} accounts={accounts} />}
                        <RowMenu label={`More for ${p.no}`}>
                        <Step action={depositAction} className="" label="Partial payment" pendingLabel="Posting…"
                          title={`Partial payment on ${p.no}`} detail="Money taken before handover is kept as a deposit for this invoice and applied once, when the phone is handed over. The phone stays with the driver."
                          confirmLabel="Keep as deposit">
                          <input type="hidden" name="parcel_id" value={p.id} />
                          <DateField today={today} />
                          <PayFields parcel={p} amount={0} accounts={accounts} deposit />
                        </Step>
                        <Step action={notHomeAction} className="" label="Customer not home — retry" pendingLabel="Saving…"
                          title={`${p.no}: customer not home`} detail={`It stays with ${p.collector?.name ?? "the carrier"} for another try, with no second invoice and no stock moved. If it comes back to the shop meanwhile, use Back to shop: the same IMEIs are scanned in.`}
                          confirmLabel="Keep for retry">
                          <input type="hidden" name="parcel_id" value={p.id} />
                          <div className="field"><label>What happened</label><input name="reason" required placeholder="Nobody home, phone off…" /></div>
                          <div className="field"><label>Retry on</label><input name="retry_on" type="date" min={today} /></div>
                        </Step>
                        {p.state === "NOT_HOME" && <ReceiveBack p={p} today={today} />}
                        <Step action={refusedAction} className="" label="Customer refused — return to shop" pendingLabel="Saving…"
                          title={`${p.no}: customer refused`} detail="Nothing is owed. The phone is on its way back and stays out of sale until the warehouse scans it in."
                          confirmLabel="Return to shop">
                          <input type="hidden" name="parcel_id" value={p.id} />
                          <div className="field cod-wide"><label>Why</label><input name="reason" required placeholder="Changed mind, wrong model…" /></div>
                        </Step>
                        {canAdjust && <LostInTransit p={p} today={today} />}
                        </RowMenu>
                      </span>
                    )}
                    {/* Coming back and never arrived: the one thing left to say about it. */}
                    {canAdjust && p.state === "REFUSED" && (
                      <RowMenu label={`More for ${p.no}`}><LostInTransit p={p} today={today} /></RowMenu>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

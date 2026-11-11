"use client";

import { useActionState, useMemo, useState } from "react";
import type { ActionResult } from "@/lib/actions";
import { PartnerPicker } from "./partner-picker";
import { CurrencyRate, type FxOption } from "./currency-rate";
import type { Channel } from "@/lib/payment-channels";
import { ChannelPicker } from "./channel-picker";
import { useNotice } from "@/components/toast";
import Link from "next/link";
import { CalendarDays, Hash, MapPin, StickyNote, User } from "lucide-react";
import { DocHeading } from "./doc-heading";

type Partner = { id: string; code: string; name: string; currency?: string | null };
type CashAccount = { id: string; code: string; name: string };
type Branch = { id: string; code: string; name: string };
type Invoice = {
  document_id: string; doc_no: string; partner_id: string;
  posting_date: string; due_date: string | null;
  gross_total: string; paid: string; outstanding: string;
  payment_status: string; days_overdue: number | null;
  /** The bill's own currency, its carrying rate, and what is left in it. */
  currency?: string; exchange_rate?: number; fc_outstanding?: number;
  /** Of what is paid, the part an advance applied (kyat). */
  adv_applied?: number;
};
/** Money already on account with this partner, not yet against any bill. */
export type OpenAdvance = { payment_id: string; partner_id: string; doc_no: string; doc_date: string; currency: string; available: number };

/** What a bill still owes in the currency it is owed in. */
const out = (i: Invoice) =>
  i.currency && i.currency !== "MMK" ? Number(i.fc_outstanding) : Number(i.outstanding);

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const r2 = (n: number) => Math.round(n * 100) / 100;
const val = (v: string | undefined) => Number(v) || 0;

/**
 * A money box wide enough for a nine-digit kyat figure, with thousands
 * separators while it is not being typed in. Stores the plain number.
 */
function Amount({ value, onChange, label, invalid, placeholder, id }: {
  value: string; onChange: (v: string) => void; label: string; invalid?: boolean; placeholder?: string; id?: string;
}) {
  const [focus, setFocus] = useState(false);
  const shown = focus || value === "" || isNaN(Number(value)) ? value
    : Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (
    <input
      id={id} type="text" inputMode="decimal" className={`stl-amt${invalid ? " bad" : ""}`} aria-label={label}
      aria-invalid={invalid || undefined} placeholder={placeholder ?? "0"} value={shown}
      onFocus={(e) => { setFocus(true); requestAnimationFrame(() => e.target.select()); }}
      onBlur={() => setFocus(false)}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
    />
  );
}
const day = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/**
 * Settling invoices. The invoices themselves are never edited — this records
 * a payment document and allocates it, so outstanding stays derived and a
 * part payment leaves the balance attached to the invoice it belongs to.
 */
export function SettlementForm({
  kind,
  action,
  partners,
  invoices,
  cashAccounts,
  branches,
  today,
  initialPartnerId,
  initialInvoiceId,
  initialAll,
  initialUseAdvance,
  help,
  advances = [],
  fx,
  channels,
}: {
  /** The page's help, beside the title. */
  help?: React.ReactNode;
  /** Arriving from "Pay all" on the payables list: every bill ticked. */
  initialAll?: boolean;
  /** Arriving from "Use advance": the advance spread over the oldest bills, no new money. */
  initialUseAdvance?: boolean;
  advances?: OpenAdvance[];
  /** How the money moved. Replaces the account picker when given (kyat payments). */
  channels?: Channel[];
  /** Currencies and latest rates: a bill owed in yuan is paid in yuan. */
  fx?: { base: string; options: FxOption[] };
  kind: "pay" | "receive";
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  partners: Partner[];
  invoices: Invoice[];
  cashAccounts: CashAccount[];
  branches: Branch[];
  today: string;
  /** Arriving from a specific document's page — jump straight to it. */
  initialPartnerId?: string;
  initialInvoiceId?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never,
    null
  );
  useNotice(state);

  /** See the hidden field below. */
  const [attemptKey] = useState(() => crypto.randomUUID());

  const [partnerId, setPartnerId] = useState(initialPartnerId ?? "");
  const usable = (channels ?? []).filter((c) => c.accountId);

  const isPay = kind === "pay";
  const base = fx?.base ?? "MMK";
  /** The currency this payment is in — the bills it settles are owed in it. */
  const currencyOf = (id: string) => {
    const owedIn = invoices.find((i) => i.partner_id === id && i.currency && i.currency !== base)?.currency;
    return owedIn ?? partners.find((p) => p.id === id)?.currency ?? base;
  };
  const [currency, setCurrency] = useState(() => isPay ? currencyOf(initialPartnerId ?? "") : base);
  const latest = (c: string) => String(fx?.options.find((o) => o.code === c)?.rate ?? "");
  const [rate, setRate] = useState(() => (currency !== base ? latest(currency) : ""));
  const foreign = isPay && currency !== base;
  const unit = foreign ? currency : base;

  /**
   * What this money is for. Settling bills, or sitting on the partner's
   * account until there is a bill to settle.
   *
   * Two purposes rather than an amount field that may or may not be filled,
   * because they are genuinely different transactions — one relieves a
   * receivable, the other creates a liability — and a screen that lets both
   * happen at once would have to explain which part of the money the next
   * invoice may claim.
   */
  const [purpose, setPurpose] = useState<"settle" | "advance">("settle");
  const [advance, setAdvance] = useState("");

  // Only the bills owed in this payment's currency: a yuan payment cannot
  // settle a kyat bill, and the engine refuses it.
  const openFor = (pid: string, cur: string) => invoices.filter((i) => i.partner_id === pid
    && (!isPay || (i.currency ?? base) === cur));
  const poolFor = (pid: string, cur: string) => advances.filter((a) => a.partner_id === pid
    && a.currency === (isPay ? cur : base));
  // The bill this screen was opened from leads the list, so what was just
  // filled in is the first thing seen rather than a row below the fold.
  const open = useMemo(() => {
    const rows = openFor(partnerId, currency);
    const i = rows.findIndex((r) => r.document_id === initialInvoiceId);
    return i > 0 ? [rows[i], ...rows.slice(0, i), ...rows.slice(i + 1)] : rows;
  }, [invoices, partnerId, currency]); // eslint-disable-line react-hooks/exhaustive-deps
  const fromBill = open.find((r) => r.document_id === initialInvoiceId);
  const pool = useMemo(() => poolFor(partnerId, currency), [advances, partnerId, currency]); // eslint-disable-line react-hooks/exhaustive-deps
  const poolTotal = pool.reduce((t, a) => t + a.available, 0);

  /**
   * Per bill, two figures: how much of the advance already on account goes
   * against it, and how much new money. Ticking a bill settles it in full,
   * advance first; either figure can then be changed by hand.
   */
  type Split = { cash: Record<string, string>; adv: Record<string, string> };
  const [useAdv, setUseAdv] = useState(true);
  const fillRows = (rows: Invoice[], poolLeft: number, withAdv: boolean, cashCap = Infinity): Split => {
    const next: Split = { cash: {}, adv: {} };
    let left = poolLeft, cap = cashCap;
    for (const i of rows) {
      const a = withAdv ? r2(Math.min(left, out(i))) : 0;
      const c = r2(Math.max(0, Math.min(cap, out(i) - a)));
      left -= a; cap -= c;
      if (a > 0) next.adv[i.document_id] = String(a);
      if (c > 0) next.cash[i.document_id] = String(c);
    }
    return next;
  };
  /** What the screen opens with: the bill it was opened for, every bill, or the advance alone. */
  const initial = (pid: string, cur: string): Split => {
    const rows = openFor(pid, cur), left = poolFor(pid, cur).reduce((t, a) => t + a.available, 0);
    if (initialAll) return fillRows(rows, left, true);
    if (initialUseAdvance) return fillRows(rows, left, true, 0);
    // Only where it belongs to the partner being settled with. An amount
    // against somebody else's invoice is not a starting point, it is a
    // mistake waiting to be posted.
    const inv = rows.find((i) => i.document_id === initialInvoiceId);
    return inv ? fillRows([inv], left, true) : { cash: {}, adv: {} };
  };
  const [split, setSplit] = useState<Split>(() => initial(initialPartnerId ?? "", currency));
  const amounts = split.cash;
  const setAmounts = (cash: Record<string, string>) => setSplit({ cash, adv: {} });

  const owed = open.reduce((s, i) => s + out(i), 0);
  const applied = open.reduce((s, i) => s + val(amounts[i.document_id]), 0);
  const advUsed = open.reduce((s, i) => s + val(split.adv[i.document_id]), 0);
  const advOver = advUsed > poolTotal + 0.005;
  const takenBy = (i: Invoice) => val(amounts[i.document_id]) + val(split.adv[i.document_id]);

  // Every invoice this will touch, named in the summary: one filled in before
  // anyone looked at the screen must not ride along unread.
  const settling = open.filter((i) => takenBy(i) > 0);
  const overApplied = open.filter((i) => takenBy(i) > out(i) + 0.005);

  const toggle = (i: Invoice) => {
    if (takenBy(i) > 0) {
      const cash = { ...split.cash }, adv = { ...split.adv };
      delete cash[i.document_id]; delete adv[i.document_id];
      setSplit({ cash, adv });
      return;
    }
    const f = fillRows([i], Math.max(0, poolTotal - advUsed), useAdv);
    setSplit({ cash: { ...split.cash, ...f.cash }, adv: { ...split.adv, ...f.adv } });
  };
  const [spread, setSpread] = useState("");
  /** The amount being paid now, put against the oldest bills first, after the advance. */
  const spreadOldest = () => setSplit(fillRows(open, useAdv ? poolTotal : 0, useAdv, spread === "" ? Infinity : val(spread)));
  // The advance documents, drawn oldest first: what each gives and keeps.
  let draw = advUsed;
  const drawn = pool.map((a) => { const use = Math.max(0, Math.min(a.available, draw)); draw -= use; return { ...a, use, after: a.available - use }; });

  // Kyat leaving the till at today's rate, against kyat the bills are carried
  // at: the difference is booked as exchange gain or loss when this posts.
  const kyatPaid = foreign ? applied * (Number(rate) || 0) : applied;
  const kyatCarried = foreign
    ? open.reduce((s, i) => s + (Number(amounts[i.document_id]) || 0) * (i.exchange_rate ?? 1), 0)
    : applied;

  function payAll() { setSplit(fillRows(open, useAdv ? poolTotal : 0, useAdv)); }
  const allTicked = open.length > 0 && open.every((i) => takenBy(i) >= out(i) - 0.005);

  const payload = JSON.stringify(
    open
      .map((i) => ({ invoiceId: i.document_id, amount: val(amounts[i.document_id]) }))
      .filter((a) => a.amount > 0)
  );
  const advPayload = JSON.stringify(
    open
      .map((i) => ({ invoiceId: i.document_id, amount: val(split.adv[i.document_id]) }))
      .filter((a) => a.amount > 0)
  );
  const settleOk = applied + advUsed > 0 && overApplied.length === 0 && !advOver;
  const cashWord = isPay ? "Pay" : "Receive";

  return (
    <>
      <DocHeading back={{ href: isPay ? "/payables" : "/receivables", label: isPay ? "Back to payables" : "Back to receivables" }}
      trail={[]} title={isPay ? "Pay a supplier" : "Receive from a customer"}>{help}</DocHeading>
    {/* Two different transactions, so a choice made first: settling bills
        relieves what is owed; an advance is held on account until there is
        a bill for it. Outside the form — the form posts the hidden purpose. */}
    <fieldset className="purpose stl-purpose">
      <legend>{isPay ? "Payment purpose" : "Receipt purpose"}</legend>
      {([
        ["settle", isPay ? "Pay existing bills" : "Settle existing invoices"],
        ["advance", isPay ? "Advance to supplier" : "Customer advance"],
      ] as const).map(([value, label]) => (
        <label key={value} className={purpose === value ? "on" : undefined}>
          <input type="radio" name="purpose_choice" value={value}
            checked={purpose === value} onChange={() => setPurpose(value)} />
          {label}
        </label>
      ))}
    </fieldset>
    <form action={formAction} className="form wide docsheet stl-form">


      {/* One submission, one posting. Generated when this form mounts, so a
          double-click or a resent request carries the same key and is handed
          the document the first one posted; a new form is a new key. */}
      <input type="hidden" name="idempotency_key" value={attemptKey} />

      {state && "error" in state && <div className="alert">{state.error}</div>}

      <input type="hidden" name="allocations" value={payload} />
      <input type="hidden" name="advance_use" value={purpose === "settle" ? advPayload : "[]"} />
      <input type="hidden" name="purpose" value={purpose} />

      <div className="card doc-meta doc-info">
        <div className="card-head">
          <h2>{isPay ? "Payment details" : "Receipt details"}</h2>
        </div>
        <div className="card-body">
          <div className="doc-fields">
            <div className="field">
              <label htmlFor="partner_id"><User size={13} aria-hidden="true" />{isPay ? "Supplier" : "Customer"}</label>
              {/* Amounts belong to one partner's bills, so changing partner
                  clears them — but the invoice this screen was opened for is
                  filled in again where it belongs to the new one. */}
              <PartnerPicker
                partners={partners as never}
                value={partnerId}
                placeholder={isPay ? "Type a supplier…" : "Type a customer…"}
                onPick={(id) => {
                  const c = isPay ? currencyOf(id) : currency;
                  setPartnerId(id); setSplit(initial(id, c)); setSpread("");
                  if (isPay) { setCurrency(c); setRate(c !== base ? latest(c) : ""); }
                }}
              />
            </div>

            {usable.length > 0 && (!isPay || currency === base) ? (
              <ChannelPicker channels={channels ?? []} direction={isPay ? "out" : "in"}
                label={isPay ? "Paid by" : "Received by"}
                disabled={purpose === "settle" && applied <= 0 && advUsed > 0} />
            ) : (
              <div className="field">
                <label htmlFor="cash_account_id">{isPay ? "Paid from" : "Received into"}</label>
                <select id="cash_account_id" name="cash_account_id" required
                  defaultValue={cashAccounts[0]?.id ?? ""}>
                  {cashAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                  ))}
                </select>
              </div>
            )}

            {branches.length > 1 && (
              <div className="field">
                <label htmlFor="location_id">
                  <MapPin size={13} aria-hidden="true" />Branch
                </label>
                {/* An advance settles nothing, so there are no invoices for the
                    cash side to follow. Asked for rather than guessed. */}
                <select
                  id="location_id" name="location_id" defaultValue=""
                  required={purpose === "advance"}
                >
                  <option value="">
                    {purpose === "advance" ? "Choose a branch…" : "Follow the invoices"}
                  </option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.code} · {b.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="field">
              <label htmlFor="doc_date"><CalendarDays size={13} aria-hidden="true" />Date</label>
              <input id="doc_date" name="doc_date" type="date" defaultValue={today} required />
            </div>

            {isPay && fx && (
              <CurrencyRate options={fx.options} base={base} currency={currency} rate={rate}
                onChange={(c, r) => { setCurrency(c); setRate(r); setSplit({ cash: {}, adv: {} }); }} />
            )}

            <div className="field">
              <label htmlFor="reference"><Hash size={13} aria-hidden="true" />Reference</label>
              <input id="reference" name="reference" type="text"
                placeholder={isPay ? "Cheque or transfer no." : "Their receipt no."} />
            </div>

            <div className="field span-rest">
              <label htmlFor="memo"><StickyNote size={13} aria-hidden="true" />Note</label>
              <input id="memo" name="memo" type="text" maxLength={300} placeholder="Optional — English or Myanmar" />
            </div>
          </div>
        </div>
      </div>

      {purpose === "advance" ? (
        <section className="card stl-adv">
          <div className="card-head">
            <h2>{isPay ? "Advance to supplier" : "Customer advance"}<span className="stl-tag">No {isPay ? "bill" : "invoice"} yet</span></h2>
          </div>
          <div className="card-body stl-adv-body">
            <label htmlFor="stl-advance" className="stl-adv-label">Amount {isPay ? "paid" : "received"}</label>
            <div className="amountbox stl-amountbox">
              <Amount id="stl-advance" value={advance} onChange={setAdvance} label={`Amount ${isPay ? "paid" : "received"}`} />
              <input type="hidden" name="advance" value={advance} />
              <span className="amountbox-unit">{unit}</span>
            </div>
            <p className="hint">
              Held on account and listed under {isPay ? "Supplier" : "Customer"} advances; it settles the next {isPay ? "bill" : "invoice"} from this screen.
            </p>
          </div>
        </section>
      ) : (
      <>
      {partnerId && pool.length > 0 && (
        <section className="card stl-adv" aria-label="Advance on account">
          <div className="card-head">
            <h2>
              <span className="stl-step">1</span>
              Advance on account
              <span className="stl-tag">No money moves</span>
            </h2>
            <span className="actions">
              <span className="page-sub">{fmt(poolTotal)} {unit} on account</span>
              <label className="stl-switch">
                <input type="checkbox" checked={useAdv} onChange={(e) => {
                  const on = e.target.checked; setUseAdv(on);
                  // Re-settle the ticked bills the new way, so the totals stay true.
                  const ticked = open.filter((i) => takenBy(i) > 0);
                  const f = fillRows(ticked, on ? poolTotal : 0, on);
                  setSplit(f);
                }} />
                Use it first
              </label>
            </span>
          </div>
          <div className="tablewrap">
            <table className="stl-table">
              <thead><tr><th>Advance</th><th>{isPay ? "Paid" : "Received"} on</th><th className="r">On account</th><th className="r">Using now</th><th className="r">Left after</th></tr></thead>
              <tbody>
                {drawn.map((a) => (
                  <tr key={a.payment_id}>
                    <td className="code">
                      <Link href={`/documents/${a.payment_id}`} target="_blank" rel="noopener" title="Open in a new tab">{a.doc_no}</Link>
                    </td>
                    <td className="code">{day(a.doc_date)}</td>
                    <td className="r">{fmt(a.available)}</td>
                    <td className="r">{a.use > 0 ? <strong className="stl-adv-use">{fmt(a.use)}</strong> : "—"}</td>
                    <td className="r">{fmt(a.after)}</td>
                  </tr>
                ))}
              </tbody>
              {pool.length > 1 && (
                <tfoot><tr><td colSpan={2}>Total</td><td className="r">{fmt(poolTotal)}</td><td className="r">{fmt(advUsed)}</td><td className="r">{fmt(poolTotal - advUsed)}</td></tr></tfoot>
              )}
            </table>
          </div>
          <p className="stl-note">{isPay ? "Paid to this supplier earlier" : "Received from this customer earlier"}, used oldest first against the ticked {isPay ? "bills" : "invoices"} below.</p>
        </section>
      )}

      <section className="card stl-bills">
        <div className="card-head stl-head">
          <h2>{pool.length > 0 && <span className="stl-step">2</span>}{isPay ? "Bills to pay" : "Invoices to settle"}{open.length > 0 && <span className="page-sub"> · {open.length} open · {fmt(owed)} {unit} owed</span>}</h2>
          {open.length > 0 && (
            <span className="actions stl-quick">
              <label htmlFor="stl-spread" className="page-sub">{cashWord} amount</label>
              <Amount id="stl-spread" value={spread} onChange={setSpread} label={`${cashWord} amount, spread oldest first`} placeholder="Full amount" />
              <button type="button" className="ghost tiny" onClick={spreadOldest}>Spread oldest first</button>
              <button type="button" className="tiny" onClick={payAll} disabled={allTicked}>{isPay ? "Pay all" : "Receive all"}</button>
              {settling.length > 0 && <button type="button" className="ghost tiny" onClick={() => setSplit({ cash: {}, adv: {} })}>Clear</button>}
            </span>
          )}
          {fromBill && <p className="stl-from">{isPay ? "Paying" : "Receiving for"} <strong>{fromBill.doc_no}</strong>, opened from that {isPay ? "bill" : "invoice"}. Tick others to settle them in the same {isPay ? "payment" : "receipt"}.</p>}
        </div>

        {!partnerId ? (
          <div className="empty">Choose a {isPay ? "supplier" : "customer"} to see what is outstanding.</div>
        ) : open.length === 0 ? (
          <div className="empty">Nothing outstanding — everything is settled.{pool.length > 0 && " The advance stays on account for the next bill."}</div>
        ) : (
          <div className="tablewrap">
            <table className="stl-table">
              <thead>
                <tr>
                  <th className="stl-check">
                    <input type="checkbox" aria-label={isPay ? "Pay all bills" : "Settle all invoices"} checked={allTicked}
                      onChange={() => (allTicked ? setSplit({ cash: {}, adv: {} }) : payAll())} />
                  </th>
                  <th>{isPay ? "Bill" : "Invoice"}</th><th>Due</th>
                  <th className="r">Outstanding</th>
                  {pool.length > 0 && <th className="r">From advance</th>}
                  <th className="r">{cashWord} now</th>
                  <th className="r">Left after</th>
                </tr>
              </thead>
              <tbody>
                {open.map((i) => {
                  const taken = takenBy(i);
                  const over = taken > out(i) + 0.005;
                  const late = i.days_overdue !== null && i.days_overdue > 0;
                  const rate = foreign ? (i.exchange_rate ?? 1) : 1;
                  const paidBefore = Number(i.paid) / rate, advBefore = Number(i.adv_applied ?? 0) / rate;
                  return (
                    <tr key={i.document_id} className={[taken > 0 && "on", i.document_id === initialInvoiceId && "from"].filter(Boolean).join(" ") || undefined}>
                      <td className="stl-check">
                        <input type="checkbox" checked={taken > 0} onChange={() => toggle(i)} aria-label={`Settle ${i.doc_no} in full`} />
                      </td>
                      <td>
                        <span className="code">{i.doc_no}</span>
                        <div className="subline">{day(i.posting_date)} · total {fmt(Number(i.gross_total) / rate)}
                          {paidBefore - advBefore > 0.005 && <> · paid {fmt(paidBefore - advBefore)}</>}
                          {advBefore > 0.005 && <> · advance {fmt(advBefore)}</>}
                        </div>
                        {i.document_id === initialInvoiceId && taken > 0 && <div className="hint stl-hint">filled in for you</div>}
                      </td>
                      <td>
                        <span className="code">{day(i.due_date)}</span>
                        <div><span className={`pill ${late ? "overdue" : i.payment_status === "PARTIALLY_PAID" ? "warn" : "ok"}`}>
                          {late ? `${i.days_overdue}d late` : i.payment_status === "PARTIALLY_PAID" ? "Part paid" : "Open"}
                        </span></div>
                      </td>
                      <td className="r">
                        <strong>{foreign ? out(i).toLocaleString("en-US", { maximumFractionDigits: 2 }) : fmt(out(i))}</strong>
                        {foreign && <div className="subline">at {(i.exchange_rate ?? 1).toLocaleString("en-US")}</div>}
                      </td>
                      {pool.length > 0 && (
                        <td className="r">
                          <Amount value={split.adv[i.document_id] ?? ""} placeholder="—" label={`Advance for ${i.doc_no}`} invalid={over || advOver}
                            onChange={(v) => setSplit({ ...split, adv: { ...split.adv, [i.document_id]: v } })} />
                        </td>
                      )}
                      <td className="r">
                        <Amount value={amounts[i.document_id] ?? ""} placeholder="—" label={`${cashWord} now for ${i.doc_no}`} invalid={over}
                          onChange={(v) => setSplit({ ...split, cash: { ...split.cash, [i.document_id]: v } })} />
                      </td>
                      <td className="r">{taken > 0 ? (out(i) - taken > 0.005 ? fmt(out(i) - taken) : <span className="stl-done">Settled</span>) : <span className="page-sub">{fmt(out(i))}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td colSpan={2}>Total</td>
                  <td className="r">{fmt(owed)}</td>
                  {pool.length > 0 && <td className="r">{fmt(advUsed)}</td>}
                  <td className="r">{fmt(applied)}</td>
                  <td className="r">{fmt(owed - applied - advUsed)}</td>
                </tr>
                {foreign && applied > 0 && (
                  <tr>
                    <td colSpan={pool.length > 0 ? 7 : 6} className="r">
                      {base} paid {fmt(kyatPaid)} · carried at {fmt(kyatCarried)} ·{" "}
                      <strong className={kyatCarried - kyatPaid >= 0 ? "ok-qty" : "low"}>
                        exchange {kyatCarried - kyatPaid >= 0 ? "gain" : "loss"} {fmt(Math.abs(kyatCarried - kyatPaid))} {base}
                      </strong>
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )}
      </section>
      </>
      )}

      {purpose === "settle" && (overApplied.length > 0 || advOver) && (
        <div className="alert">
          {overApplied.length > 0 && <>More than what is outstanding is put against {overApplied.map((i) => i.doc_no).join(", ")}. </>}
          {advOver && <>That is more advance than is on account ({fmt(poolTotal)} {unit}).</>}
        </div>
      )}

      {/* The document's commands at the foot and kept in view, as on every
          invoice: the button says what it is; the figures beside it say
          how much and from where. */}
      <div className="actions form-commit stl-commit">
        <button type="submit" disabled={pending || (purpose === "advance" ? !(Number(advance) > 0) : !settleOk)}>
          {pending ? "Posting…" : isPay ? "Post payment" : "Post receipt"}
        </button>
        <Link href={isPay ? "/payables" : "/receivables"} className="btn ghost">Cancel</Link>
        <dl className="stl-sum" aria-live="polite">
          {purpose === "advance" ? (
            <div><dt>{isPay ? "Advance paid" : "Advance received"}</dt><dd>{fmt(Number(advance) || 0)} <small>{unit}</small></dd></div>
          ) : settling.length === 0 ? (
            <div className="stl-sum-empty"><dt>{isPay ? "Tick the bills to pay" : "Tick the invoices to settle"}</dt><dd /></div>
          ) : (
            <>
              <div><dt>{isPay ? "Bills" : "Invoices"}</dt><dd title={settling.map((i) => i.doc_no).join(", ")}>{settling.length}</dd></div>
              {advUsed > 0 && <div><dt>From advance</dt><dd>{fmt(advUsed)}</dd></div>}
              <div className="stl-sum-cash"><dt>{isPay ? "Paid now" : "Received now"}</dt><dd>{fmt(applied)} <small>{unit}</small></dd></div>
            </>
          )}
        </dl>
      </div>
    </form>
    </>
  );
}

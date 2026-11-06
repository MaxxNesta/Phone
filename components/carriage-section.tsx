"use client";

import { useEffect, useState } from "react";
import { HelpHint } from "./help-hint";
import { CircleSlash, Clock, FileText, Hash, Wallet } from "lucide-react";
import { SpreadField, postedSpread, type Spread } from "./spread-field";

type Partner = { id: string; code?: string | null; name: string };

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * The courier's charge for bringing these goods in, on the receipt itself.
 * Off unless switched on: most receipts have no charge to add, and the
 * section stays one quiet line until somebody has one. On, it posts with the
 * receipt — Dr Carriage Inward / Cr Payable (Other) under the courier, then
 * spread onto the items — so they arrive at what they really cost.
 */
export function CarriageSection({ couriers, units, base, onBlocked, paidFrom = [] }: {
  couriers: Partner[];
  /** Items on the receipt, every product, not only phones with an IMEI. */
  units: number; base: string; onBlocked: (why: string | null) => void;
  /** Cash and bank accounts, for a charge paid on the spot. */
  paidFrom?: { id: string; label: string }[];
}) {
  // The question the receiver can answer: is there a courier charge, and is its bill here?
  const [mode, setMode] = useState<"none" | "now" | "later">("none");
  const on = mode === "now";
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Spread>("EQUAL");
  // "" = owed to the courier, paid later; otherwise the account it was paid from now.
  const [payment, setPayment] = useState("");
  const value = Number(amount) || 0;
  const total = method === "PER" ? value * units : value;
  const paidNow = payment !== "";

  const why = !on ? null
    : !(value > 0) ? "Enter the courier's charge"
    : units === 0 ? "A courier charge needs items on this receipt"
    : null;
  useEffect(() => { onBlocked(why); }, [why, onBlocked]);

  return (
    <section className={`card carriage${on ? " on" : ""}`}>
      <input type="hidden" name="carriage_on" value={on ? "1" : ""} />
      <input type="hidden" name="carriage_paid" value={paidNow ? "1" : ""} />
      <input type="hidden" name="carriage_paid_from" value={payment} />
      <input type="hidden" name="carriage_amount" value={total > 0 ? String(total) : ""} />
      <input type="hidden" name="carriage_method" value={postedSpread(method)} />
      <div className="carriage-head receive-row">
        <span className="receive-q" id="carriage-q">Carriage inward for these goods? <HelpHint label="What carriage inward covers">Carriage inward is everything paid to a third party to bring these goods in: the car or driver fee, and any freight, customs and clearance the forwarder handles and bills as one amount. It is added to the items' cost and reaches cost of sales only as each item sells.</HelpHint></span>
        <div className="segmented" role="radiogroup" aria-labelledby="carriage-q">
          {([
            ["none", <CircleSlash key="i" size={16} aria-hidden="true" />, "No charge"],
            ["now", <FileText key="i" size={16} aria-hidden="true" />, "Bill is here now"],
            ["later", <Clock key="i" size={16} aria-hidden="true" />, "Bill comes later"],
          ] as const).map(([key, icon, title]) => (
            <button key={key} type="button" role="radio" aria-checked={mode === key}
              className={`seg${mode === key ? " on" : ""}`} onClick={() => setMode(key)}>
              {icon} {title}
            </button>
          ))}
        </div>
      </div>
      {mode === "later" && (
        <p className="receive-explain carriage-later">
          Post the receipt as it is. When the courier&rsquo;s bill arrives, open this receipt and choose
          <strong> Record carriage inward</strong>; the charge is added to these items then.
        </p>
      )}

      {on && (
        <div className="card-body carriage-body">
          <div className="doc-fields">
            <SpreadField id="carriage_method" value={method} onChange={setMethod} />
            <div className="field">
              <label htmlFor="carriage_amount"><Hash size={13} aria-hidden="true" />{method === "PER" ? `Per item (${base})` : `Total charge (${base})`}</label>
              <input id="carriage_amount" type="number" min="0" step="any" inputMode="decimal"
                value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={method === "PER" ? "e.g. 45000" : "e.g. 900000"} />
            </div>
            <div className="field">
              <label htmlFor="carriage_payment"><Wallet size={13} aria-hidden="true" />Payment</label>
              <select id="carriage_payment" value={payment} onChange={(e) => setPayment(e.target.value)}>
                <option value="">Pay later · owed to courier</option>
                {paidFrom.map((a) => <option key={a.id} value={a.id}>Paid now · {a.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="carriage_reference"><Hash size={13} aria-hidden="true" />Slip no.</label>
              <input id="carriage_reference" name="carriage_reference" type="text" placeholder="Optional" />
            </div>
          </div>
          {/* One line: each item's share, and where the money goes. */}
          <p className="carriage-note">
            {value > 0 && units > 0 && <>{method === "PER"
              ? <><strong>{fmt(value)}</strong> × {units} item{units === 1 ? "" : "s"} = <strong>{fmt(total)}</strong></>
              : units === 1 ? <>All <strong>{fmt(value)}</strong> on the one item</>
              : method === "EQUAL" ? <>{fmt(value)} ÷ {units} items = <strong>{fmt(value / units)}</strong> each</>
              : <>{fmt(value)} shared across {units} items by what each cost</>} · </>}
            <span className="carriage-posts">{paidNow
              ? "Paid from the till now; nothing is owed."
              : "Owed to the courier until paid from Payables → Couriers."}</span>
          </p>
        </div>
      )}
    </section>
  );
}

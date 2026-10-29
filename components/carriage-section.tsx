"use client";

import { useEffect, useState } from "react";
import { Hash, Layers, Truck, User } from "lucide-react";

type Partner = { id: string; code?: string | null; name: string };

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * The courier's charge for bringing these goods in, on the receipt itself.
 * Off unless switched on: most receipts have no charge to add, and the
 * section stays one quiet line until somebody has one. On, it posts with the
 * receipt — Dr Carriage Inward / Cr Payable (Other) under the courier, then
 * spread onto the phones — so the phones arrive at what they really cost.
 */
export function CarriageSection({ couriers, phones, base, onBlocked }: {
  couriers: Partner[]; phones: number; base: string; onBlocked: (why: string | null) => void;
}) {
  const [on, setOn] = useState(false);
  const [partnerId, setPartnerId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"EQUAL" | "VALUE">("EQUAL");
  const value = Number(amount) || 0;

  const why = !on ? null
    : !partnerId ? "Choose the courier for the charge"
    : !(value > 0) ? "Enter the courier's charge"
    : phones === 0 ? "A courier charge needs phones with IMEIs on this receipt"
    : null;
  useEffect(() => { onBlocked(why); }, [why, onBlocked]);

  return (
    <section className={`card carriage${on ? " on" : ""}`}>
      <input type="hidden" name="carriage_on" value={on ? "1" : ""} />
      <div className="carriage-head">
        <span className="carriage-title"><Truck size={15} aria-hidden="true" /> Courier charge on this delivery</span>
        <span className="carriage-sub">{on ? "Added to each phone's cost" : "Car, bus gate or forwarder fee for these goods"}</span>
        <label className="pf2-toggle carriage-toggle">
          <input type="checkbox" role="switch" checked={on} onChange={(e) => setOn(e.target.checked)} aria-label="Add a courier charge" />
          <span className="track" aria-hidden="true" />
        </label>
      </div>

      {on && (
        <div className="card-body carriage-body">
          <div className="doc-fields cols-4">
            <div className="field">
              <label htmlFor="carriage_partner_id"><User size={13} aria-hidden="true" />Courier</label>
              <select id="carriage_partner_id" name="carriage_partner_id" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} required>
                <option value="">Choose the courier or driver</option>
                {couriers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.code ? ` · ${c.code}` : ""}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="carriage_amount"><Hash size={13} aria-hidden="true" />Charge ({base})</label>
              <input id="carriage_amount" name="carriage_amount" type="number" min="0" step="any" inputMode="decimal"
                value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 900000" />
            </div>
            <div className="field">
              <label htmlFor="carriage_method"><Layers size={13} aria-hidden="true" />Spread</label>
              <select id="carriage_method" name="carriage_method" value={method} onChange={(e) => setMethod(e.target.value as "EQUAL" | "VALUE")}>
                <option value="EQUAL">Equal per phone</option>
                <option value="VALUE">By purchase value</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="carriage_reference"><Hash size={13} aria-hidden="true" />Slip no.</label>
              <input id="carriage_reference" name="carriage_reference" type="text" placeholder="Optional" />
            </div>
          </div>
          <p className="carriage-note">
            {value > 0 && phones > 0
              ? <>{phones === 1 ? <>All <strong>{fmt(value)}</strong> on the one phone</>
                  : method === "EQUAL" ? <><strong>{fmt(value / phones)}</strong> on each of {phones} phones</>
                  : <>Shared across {phones} phones by what each cost</>}
                  <span className="carriage-posts"> · Carriage Inward → owed to the courier in Payable (Other) → spread onto the phones</span></>
              : "The charge is owed to the courier until paid from Payables → Couriers, and reaches cost of sales only as each phone sells."}
          </p>
        </div>
      )}
    </section>
  );
}

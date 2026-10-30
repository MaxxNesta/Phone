"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { CalendarDays, Hash, Layers, Package, StickyNote, Tag, Wallet } from "lucide-react";

type Opt = { id: string; label: string };
type Receipt = { id: string; no: string; date: string; supplier: string | null; warehouse: string | null; phones: number; landed: number };

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

export function CourierBillForm({ action, couriers, receipts, types, carriageAccount, payableAccount, clearingAccount, initialPartnerId, initialReceiptId, today, paidFrom = [] }: {
  action: (prev: { error?: string } | null, fd: FormData) => Promise<{ error?: string } | null>;
  couriers: Opt[]; receipts: Receipt[]; types: (Opt & { code: string; method: string })[];
  carriageAccount: string | null; payableAccount: string | null;
  /** Where any cost but carriage waits when paid now: Landed Cost Clearing. */
  clearingAccount?: string | null;
  initialPartnerId?: string; initialReceiptId?: string; today: string;
  /** Cash and bank accounts, for a bill paid when it is recorded. */
  paidFrom?: Opt[];
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [chosen, setChosen] = useState<string[]>(initialReceiptId ? [initialReceiptId] : []);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("EQUAL");
  // "" = owed to the courier, paid later; otherwise the account it is paid from now.
  const [payment, setPayment] = useState("");
  const paidNow = payment !== "";
  const paidLabel = paidFrom.find((a) => a.id === payment)?.label;
  const phones = receipts.filter((r) => chosen.includes(r.id)).reduce((s, r) => s + r.phones, 0);
  const value = Number(amount) || 0;
  const total = method === "PER" ? value * phones : value;
  const each = phones > 0 && value > 0 ? (method === "PER" ? value : value / phones) : 0;
  const defaultType = types.find((t) => t.code === "CARRIAGE") ?? types[0];
  const [typeId, setTypeId] = useState(defaultType?.id ?? "");
  const type = types.find((t) => t.id === typeId) ?? defaultType;
  const carriage = type?.code === "CARRIAGE";
  // What the debit side is called: carriage reads as the shop's books do,
  // anything else waits in clearing when paid now, or goes straight on when owed.
  const via = carriage ? (carriageAccount ?? "Carriage Inward") : (clearingAccount ?? "Landed Cost Clearing");
  const credit = paidNow ? `${paidLabel} · paid now` : `${payableAccount ?? "Payable (Other)"} · owed`;

  return (
    <form action={formAction} className="form wide">
      {state?.error && <div className="alert">{state.error}</div>}
      <input type="hidden" name="cost_type_id" value={typeId} />
      <div className="card doc-info">
        {/* With more than carriage in use, the first question is what the cost is. */}
        {types.length > 1 && (
          <div className="receive-row cost-type-row">
            <span className="receive-q" id="cost-type-q">What is this cost?</span>
            <div className="segmented" role="radiogroup" aria-labelledby="cost-type-q">
              {types.map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={typeId === t.id}
                  className={`seg${typeId === t.id ? " on" : ""}`} onClick={() => setTypeId(t.id)}>{t.label}</button>
              ))}
            </div>
          </div>
        )}
        <div className="card-body">
          <div className="doc-fields">
            <div className="field">
              <label htmlFor="doc_date"><CalendarDays size={13} aria-hidden="true" />Bill date</label>
              <input id="doc_date" name="doc_date" type="date" defaultValue={today} max={today} required />
            </div>
            <div className="field">
              <label htmlFor="amount"><Hash size={13} aria-hidden="true" />{method === "PER" ? "Per phone" : "Amount"}</label>
              <input id="amount" type="number" min="0" step="any" inputMode="decimal" value={amount}
                onChange={(e) => setAmount(e.target.value)} placeholder={method === "PER" ? "e.g. 45000" : "e.g. 900000"} required />
              <input type="hidden" name="amount" value={total > 0 ? String(total) : ""} />
            </div>
            <div className="field">
              <label htmlFor="payment"><Wallet size={13} aria-hidden="true" />Payment</label>
              <select id="payment" value={payment} onChange={(e) => setPayment(e.target.value)}>
                <option value="">{carriage ? "Pay later · owed to courier" : "Pay later · owed"}</option>
                {paidFrom.map((a) => <option key={a.id} value={a.id}>Paid now · {a.label}</option>)}
              </select>
              <input type="hidden" name="paid_from" value={payment} />
            </div>
            <div className="field">
              <label htmlFor="method"><Layers size={13} aria-hidden="true" />Spread</label>
              <select id="method" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="EQUAL">Total, shared equally</option>
                <option value="PER">Fixed per phone</option>
                <option value="VALUE">Total, by purchase value</option>
              </select>
              <input type="hidden" name="method" value={method === "VALUE" ? "VALUE" : "EQUAL"} />
            </div>
          </div>
          <div className="doc-info-foot">
            <details className="moredetails">
              <summary>Additional details <span className="page-sub">(reference, note)</span></summary>
              <div className="row">
                <div className="field">
                  <label htmlFor="reference"><Hash size={13} aria-hidden="true" />Reference</label>
                  <input id="reference" name="reference" type="text" placeholder="Courier's slip or waybill no." />
                </div>
                <div className="field span-2">
                  <label htmlFor="memo"><StickyNote size={13} aria-hidden="true" />Note</label>
                  <input id="memo" name="memo" type="text" placeholder="e.g. Car charges for iPhone (China) 20 qty × 45,000" />
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>

      <section className="card">
        <div className="card-head"><h2><Package size={15} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> {carriage ? "Which goods did they carry?" : `Which goods is this ${type?.label.toLowerCase() ?? "cost"} for?`}</h2>
          <span className="page-sub">{chosen.length ? `${phones} phone${phones === 1 ? "" : "s"} chosen` : "Choose one or more posted goods receipts"}</span></div>
        <div className="tablewrap" style={{ maxHeight: 340, overflow: "auto" }}>
          <table>
            <thead><tr><th className="tight" /><th>Goods receipt</th><th>Date</th><th>Supplier</th><th>Warehouse</th><th className="r">Phones</th><th>Landed costs</th></tr></thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id}>
                  <td className="tight"><input type="checkbox" name="receipt_id" value={r.id} checked={chosen.includes(r.id)} aria-label={`Spread onto ${r.no}`}
                    onChange={(e) => setChosen((c) => e.target.checked ? [...c, r.id] : c.filter((x) => x !== r.id))} /></td>
                  <td className="code"><Link href={`/documents/${r.id}`} target="_blank" style={{ color: "var(--link)" }}>{r.no}</Link></td>
                  <td>{r.date}</td>
                  <td>{r.supplier ?? "—"}</td>
                  <td>{r.warehouse ?? "—"}</td>
                  <td className="r">{r.phones}</td>
                  <td>{r.landed > 0 ? `${r.landed} already` : "—"}</td>
                </tr>
              ))}
              {receipts.length === 0 && <tr><td colSpan={7} className="empty">No posted goods receipts with phones yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* What posting writes, said before it is written. */}
      {total > 0 && (
        <section className="card">
          <div className="card-head"><h2>What this posts</h2>
            {method !== "VALUE" && each > 0 && <span className="page-sub">{fmt(each)} on each phone{method === "PER" ? ` · ${phones} phones = ${fmt(total)}` : ""}</span>}</div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Entry</th><th>Account</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
              <tbody>
                {carriage || paidNow ? (
                  <>
                    <tr><td>{type?.label ?? "Charge"}</td><td>{via}</td><td className="r">{fmt(total)}</td><td /></tr>
                    <tr><td /><td>{credit}</td><td /><td className="r">{fmt(total)}</td></tr>
                    <tr><td>Spread onto phones</td><td>Inventory · {phones || "the chosen"} phone{phones === 1 ? "" : "s"}</td><td className="r">{fmt(total)}</td><td /></tr>
                    <tr><td /><td>{via}</td><td /><td className="r">{fmt(total)}</td></tr>
                  </>
                ) : (
                  <>
                    <tr><td>{type?.label ?? "Charge"}, onto phones</td><td>Inventory · {phones || "the chosen"} phone{phones === 1 ? "" : "s"}</td><td className="r">{fmt(total)}</td><td /></tr>
                    <tr><td /><td>{credit}</td><td /><td className="r">{fmt(total)}</td></tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="actions form-commit">
        <button type="submit" disabled={pending || chosen.length === 0 || !(total > 0)}>
          {pending ? "Posting…" : "Record and spread"}
        </button>
        <span className="page-sub">Cost of sales takes each phone&rsquo;s share when that phone is sold.</span>
      </div>
    </form>
  );
}

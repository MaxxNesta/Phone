"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { CalendarDays, Hash, Layers, Package, StickyNote, Tag, User } from "lucide-react";

type Opt = { id: string; label: string };
type Receipt = { id: string; no: string; date: string; supplier: string | null; warehouse: string | null; phones: number; landed: number };

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

export function CourierBillForm({ action, couriers, receipts, types, carriageAccount, payableAccount, initialPartnerId, initialReceiptId, today }: {
  action: (prev: { error?: string } | null, fd: FormData) => Promise<{ error?: string } | null>;
  couriers: Opt[]; receipts: Receipt[]; types: (Opt & { code: string; method: string })[];
  carriageAccount: string | null; payableAccount: string | null;
  initialPartnerId?: string; initialReceiptId?: string; today: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [chosen, setChosen] = useState<string[]>(initialReceiptId ? [initialReceiptId] : []);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("EQUAL");
  const phones = receipts.filter((r) => chosen.includes(r.id)).reduce((s, r) => s + r.phones, 0);
  const each = phones > 0 && Number(amount) > 0 ? Number(amount) / phones : 0;
  const defaultType = types.find((t) => t.code === "CARRIAGE") ?? types[0];

  return (
    <form action={formAction} className="form">
      {state?.error && <div className="alert">{state.error}</div>}
      <div className="card doc-info">
        <div className="card-body">
          <div className="doc-fields">
            <div className="field">
              <label htmlFor="partner_id"><User size={13} aria-hidden="true" />Courier</label>
              <select id="partner_id" name="partner_id" defaultValue={initialPartnerId ?? ""} required>
                <option value="">Choose the courier or driver</option>
                {couriers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="doc_date"><CalendarDays size={13} aria-hidden="true" />Bill date</label>
              <input id="doc_date" name="doc_date" type="date" defaultValue={today} max={today} required />
            </div>
            <div className="field">
              <label htmlFor="cost_type_id"><Tag size={13} aria-hidden="true" />Charge</label>
              <select id="cost_type_id" name="cost_type_id" defaultValue={defaultType?.id ?? ""} required>
                {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="amount"><Hash size={13} aria-hidden="true" />Amount</label>
              <input id="amount" name="amount" type="number" min="0" step="any" inputMode="decimal" value={amount}
                onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 900000" required />
            </div>
            <div className="field">
              <label htmlFor="method"><Layers size={13} aria-hidden="true" />Spread</label>
              <select id="method" name="method" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="EQUAL">Equal per phone</option>
                <option value="VALUE">By purchase value</option>
              </select>
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
        <div className="card-head"><h2><Package size={15} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> Which goods did they carry?</h2>
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
      {Number(amount) > 0 && (
        <section className="card">
          <div className="card-head"><h2>What this posts</h2>
            {method === "EQUAL" && each > 0 && <span className="page-sub">{fmt(each)} on each phone</span>}</div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Entry</th><th>Account</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
              <tbody>
                <tr><td>Courier bill</td><td>{carriageAccount ?? "Carriage Inward"}</td><td className="r">{fmt(Number(amount))}</td><td /></tr>
                <tr><td /><td>{payableAccount ?? "Payable (Other)"} · under the courier</td><td /><td className="r">{fmt(Number(amount))}</td></tr>
                <tr><td>Spread onto phones</td><td>Inventory · {phones || "the chosen"} phone{phones === 1 ? "" : "s"}</td><td className="r">{fmt(Number(amount))}</td><td /></tr>
                <tr><td /><td>{carriageAccount ?? "Carriage Inward"}</td><td /><td className="r">{fmt(Number(amount))}</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="actions form-commit">
        <button type="submit" disabled={pending || chosen.length === 0 || !(Number(amount) > 0)}>
          {pending ? "Posting…" : "Record and spread"}
        </button>
        <span className="page-sub">Cost of sales takes each phone&rsquo;s share when that phone is sold.</span>
      </div>
    </form>
  );
}

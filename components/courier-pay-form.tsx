"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { DocRefs } from "./doc-refs";
import { Building2, CalendarDays, Hash, StickyNote, User, Wallet } from "lucide-react";

type Charge = { id: string; partnerId: string; lcId: string; lcNo: string; date: string; type: string; receipts: { id: string; no: string }[]; open: number; owed: number };
type Opt = { id: string; label: string };

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

export function CourierPayForm({ action, couriers, charges, branches, accounts, initialPartnerId, today }: {
  action: (prev: { error?: string } | null, fd: FormData) => Promise<{ error?: string } | null>;
  couriers: { id: string; name: string; code: string; outstanding: number }[];
  charges: Charge[]; branches: Opt[]; accounts: Opt[]; initialPartnerId?: string; today: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [partnerId, setPartnerId] = useState(couriers.some((c) => c.id === initialPartnerId) ? initialPartnerId! : couriers[0]?.id ?? "");
  const mine = useMemo(() => charges.filter((c) => c.partnerId === partnerId), [charges, partnerId]);
  // Every open charge ticked at its full open amount: the usual payment is "settle what we owe".
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(charges.map((c) => [c.id, String(c.open)])));
  const [ticked, setTicked] = useState<Record<string, boolean>>(() => Object.fromEntries(charges.map((c) => [c.id, true])));

  const allocations = mine.filter((c) => ticked[c.id]).map((c) => ({ chargeId: c.id, amount: Number(amounts[c.id]) || 0 }));
  const total = allocations.reduce((s, a) => s + a.amount, 0);
  const over = mine.some((c) => ticked[c.id] && (Number(amounts[c.id]) || 0) > c.open + 0.0001);

  return (
    <form action={formAction} className="form">
      {state?.error && <div className="alert">{state.error}</div>}
      <input type="hidden" name="allocations" value={JSON.stringify(allocations)} />
      <div className="card doc-info">
        <div className="card-body">
          <div className="doc-fields">
            <div className="field">
              <label htmlFor="partner_id"><User size={13} aria-hidden="true" />Courier</label>
              <select id="partner_id" name="partner_id" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} required>
                {couriers.map((c) => <option key={c.id} value={c.id}>{c.name} · owed {fmt(c.outstanding)}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="doc_date"><CalendarDays size={13} aria-hidden="true" />Date</label>
              <input id="doc_date" name="doc_date" type="date" defaultValue={today} required />
            </div>
            <div className="field">
              <label htmlFor="location_id"><Building2 size={13} aria-hidden="true" />Branch</label>
              <select id="location_id" name="location_id" defaultValue={branches.length === 1 ? branches[0].id : ""} required={branches.length > 1}>
                {branches.length > 1 && <option value="">Choose a branch</option>}
                {branches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="money_account_id"><Wallet size={13} aria-hidden="true" />Paid from</label>
              <select id="money_account_id" name="money_account_id" defaultValue={accounts[0]?.id ?? ""} required>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="reference"><Hash size={13} aria-hidden="true" />Reference</label>
              <input id="reference" name="reference" type="text" placeholder="Receipt or slip no." />
            </div>
          </div>
          <div className="doc-info-foot">
            <details className="moredetails">
              <summary>Additional details <span className="page-sub">(note)</span></summary>
              <div className="row">
                <div className="field span-2">
                  <label htmlFor="memo"><StickyNote size={13} aria-hidden="true" />Note</label>
                  <input id="memo" name="memo" type="text" placeholder="Optional — English or Myanmar" />
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>

      <section className="card">
        <div className="card-head"><h2>Unpaid charges</h2><span className="page-sub">{mine.length} open</span></div>
        <div className="tablewrap">
          <table>
            <thead><tr><th className="tight" /><th>Date</th><th>Landed cost</th><th>Charge</th><th>Goods receipt</th><th className="r">Charged</th><th className="r">Open</th><th className="r">Pay now</th></tr></thead>
            <tbody>
              {mine.map((c) => (
                <tr key={c.id}>
                  <td className="tight"><input type="checkbox" checked={!!ticked[c.id]} aria-label={`Pay ${c.lcNo}`}
                    onChange={(e) => setTicked((t) => ({ ...t, [c.id]: e.target.checked }))} /></td>
                  <td>{c.date}</td>
                  <td className="code"><Link href={`/purchases/landed-costs/${c.lcId}`} target="_blank" style={{ color: "var(--link)" }}>{c.lcNo}</Link></td>
                  <td>{c.type}</td>
                  <td className="code"><DocRefs refs={c.receipts} newTab /></td>
                  <td className="r">{fmt(c.owed)}</td>
                  <td className="r">{fmt(c.open)}</td>
                  <td className="narrow pricecell">
                    <input type="number" min="0" step="any" value={amounts[c.id] ?? ""} disabled={!ticked[c.id]} aria-label={`Amount for ${c.lcNo}`}
                      onChange={(e) => setAmounts((m) => ({ ...m, [c.id]: e.target.value }))} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={7}>Paying now</td><td className="r"><strong>{fmt(total)}</strong></td></tr></tfoot>
          </table>
        </div>
      </section>

      <div className="actions form-commit">
        {over && <span className="commit-hint" role="status">An amount is more than that charge has open</span>}
        <button type="submit" disabled={pending || total <= 0 || over}>{pending ? "Posting…" : `Pay ${fmt(total)}`}</button>
      </div>
    </form>
  );
}

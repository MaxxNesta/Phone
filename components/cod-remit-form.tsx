"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Building2, CalendarDays, Hash, StickyNote, Truck, Wallet } from "lucide-react";
import { useNotice } from "@/components/toast";

type Parcel = { id: string; courierId: string; no: string; invoiceNo: string; date: string; customer: string; outstanding: number; branchId: string | null };
type Opt = { id: string; label: string };

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * A courier pays in the cash on delivery it collected (0232), the same sheet
 * as paying a courier for carriage inward. What it already holds comes in
 * with it; any parcel ticked is marked collected in the same step. The fee
 * it kept back is Carriage Outward.
 */
export function CodRemitForm({ action, couriers, parcels, branches, accounts, initialCourierId, today }: {
  action: (prev: { error?: string } | null, fd: FormData) => Promise<{ error?: string } | null>;
  couriers: { id: string; name: string; held: number }[];
  parcels: Parcel[]; branches: Opt[]; accounts: Opt[]; initialCourierId?: string; today: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  useNotice(state);
  const [courierId, setCourierId] = useState(couriers.some((c) => c.id === initialCourierId) ? initialCourierId! : couriers[0]?.id ?? "");
  const courier = couriers.find((c) => c.id === courierId);
  const mine = useMemo(() => parcels.filter((p) => p.courierId === courierId), [parcels, courierId]);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [fee, setFee] = useState("");
  const [received, setReceived] = useState<string | null>(null);

  const held = courier?.held ?? 0;
  const collecting = mine.filter((p) => ticked[p.id]).reduce((s, p) => s + p.outstanding, 0);
  const due = held + collecting;
  const feeN = Number(fee) || 0;
  // What arrived: everything due less the fee, unless typed otherwise.
  const receivedN = received === null ? Math.max(0, due - feeN) : Number(received) || 0;
  const left = Math.round((due - receivedN - feeN) * 100) / 100;

  return (
    <form action={formAction} className="form wide docsheet">
      {state?.error && <div className="alert">{state.error}</div>}
      <div className="card doc-info">
        <div className="card-head"><h2>Pay-in details</h2></div>
        <div className="card-body">
          <div className="doc-fields">
            <div className="field">
              <label htmlFor="courier_id"><Truck size={13} aria-hidden="true" />Courier</label>
              <select id="courier_id" name="courier_id" value={courierId} required
                onChange={(e) => { setCourierId(e.target.value); setTicked({}); setReceived(null); }}>
                {couriers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.held > 0 ? ` · holds ${fmt(c.held)}` : ""}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="doc_date"><CalendarDays size={13} aria-hidden="true" />Date</label>
              <input id="doc_date" name="doc_date" type="date" defaultValue={today} max={today} required />
            </div>
            <div className="field">
              <label htmlFor="location_id"><Building2 size={13} aria-hidden="true" />Branch</label>
              {/* The branch its parcels were sold from, so the money lands where the sale did. */}
              <select key={courierId} id="location_id" name="location_id" required={branches.length > 1}
                defaultValue={branches.length === 1 ? branches[0].id
                  : branches.find((b) => b.id === mine[0]?.branchId)?.id ?? ""}>
                {branches.length > 1 && <option value="">Choose a branch</option>}
                {branches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="money_account_id"><Wallet size={13} aria-hidden="true" />Paid into</label>
              <select id="money_account_id" name="money_account_id" defaultValue={accounts[0]?.id ?? ""} required>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="reference"><Hash size={13} aria-hidden="true" />Reference</label>
              <input id="reference" name="reference" type="text" placeholder="Courier statement or slip no." />
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
        <div className="card-head">
          <h2>Parcels out with {courier?.name ?? "the courier"}</h2>
          <span className="page-sub">Tick the parcels this payment covers that are not confirmed handed over yet</span>
        </div>
        {mine.length === 0 ? (
          <div className="card-body"><p className="page-sub">No cash-on-delivery parcel is out with this courier.</p></div>
        ) : (
          <div className="tablewrap">
            <table>
              <thead><tr><th className="tight" /><th>Date</th><th>Parcel</th><th>Customer</th><th className="r">To collect</th></tr></thead>
              <tbody>
                {mine.map((p) => (
                  <tr key={p.id}>
                    <td className="tight"><input type="checkbox" name="parcel_id" value={p.id} checked={!!ticked[p.id]} aria-label={`Collected ${p.no}`}
                      onChange={(e) => { setTicked((t) => ({ ...t, [p.id]: e.target.checked })); setReceived(null); }} /></td>
                    <td>{p.date}</td>
                    <td className="code"><Link href={`/documents/${p.id}`} target="_blank" style={{ color: "var(--link)" }}>{p.no}</Link><div className="subline">{p.invoiceNo}</div></td>
                    <td>{p.customer}</td>
                    <td className="r">{fmt(p.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card paycard">
        <div className="card-head"><h2>Paid in</h2></div>
        <div className="card-body">
          <div className="row">
            <div className="field">
              <label htmlFor="fee">Courier fee kept back</label>
              <input id="fee" name="fee" type="number" min="0" step="any" placeholder="0" value={fee}
                onChange={(e) => setFee(e.target.value)} />
              <span className="hint">Booked to Carriage Outward.</span>
            </div>
            <div className="field">
              <label htmlFor="received">Money received</label>
              <input id="received" name="received" type="number" min="0" step="any" value={received ?? String(receivedN)}
                onChange={(e) => setReceived(e.target.value)} />
              <span className="hint">What arrived in the account above.</span>
            </div>
          </div>
          <dl className="cod-remit-sum">
            <div><dt>Held by the courier</dt><dd>{fmt(held)}</dd></div>
            {collecting > 0 && <div><dt>Collected with this payment</dt><dd>{fmt(collecting)}</dd></div>}
            <div><dt>Received and fee</dt><dd>{fmt(receivedN + feeN)}</dd></div>
            <div className={left < 0 ? "bad" : undefined}><dt>{left < 0 ? "More than the courier holds" : "Still with the courier"}</dt><dd><strong>{fmt(Math.abs(left))}</strong></dd></div>
          </dl>
        </div>
      </section>

      <div className="actions form-commit">
        {left < 0 && <span className="commit-hint" role="status">Tick the parcels this payment covers</span>}
        <button type="submit" disabled={pending || receivedN + feeN <= 0 || left < -0.005}>
          {pending ? "Posting…" : `Post pay-in ${fmt(receivedN)}`}
        </button>
      </div>
    </form>
  );
}

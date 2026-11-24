"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, CalendarDays, StickyNote, Truck, Wallet } from "lucide-react";
import { useNotice } from "@/components/toast";
import type { DriverCash } from "@/lib/cod";

type Opt = { id: string; label: string };
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * Receive from driver (0233): the cashier ticks the collections the driver is
 * handing in, counts the cash, and it goes from Cash with Drivers into the
 * till. Counted short, the difference stays against the driver.
 */
export function DriverHandinForm({ action, drivers, branches, tills, initialDriverId, today }: {
  action: (prev: { error?: string; ok?: string } | null, fd: FormData) => Promise<{ error?: string; ok?: string } | null>;
  drivers: DriverCash[]; branches: Opt[]; tills: Opt[]; initialDriverId?: string; today: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, null);
  useNotice(state);
  const [round, setRound] = useState(0);
  useEffect(() => { if (state?.ok) { setRound((r) => r + 1); router.refresh(); } }, [state, router]);
  const [key] = useState(() => crypto.randomUUID());
  const [driverId, setDriverId] = useState(drivers.some((d) => d.driverId === initialDriverId) ? initialDriverId! : drivers[0]?.driverId ?? "");
  const driver = drivers.find((d) => d.driverId === driverId);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const isTicked = (id: string) => ticked[id] ?? true;
  const chosen = useMemo(() => (driver?.collections ?? []).filter((c) => isTicked(c.id)), [driver, ticked]); // eslint-disable-line react-hooks/exhaustive-deps
  const expected = chosen.reduce((t, c) => t + c.amount, 0);
  const [counted, setCounted] = useState<string | null>(null);
  const countedN = counted === null ? expected : Number(counted) || 0;
  const short = Math.round((expected - countedN) * 100) / 100;

  return (
    <form action={formAction} className="form wide docsheet" key={round}>
      {state?.error && <div className="alert">{state.error}</div>}
      <input type="hidden" name="idempotency_key" value={`${key}-${round}`} />
      <div className="card doc-info">
        <div className="card-head"><h2>Hand-in details</h2></div>
        <div className="card-body">
          <div className="doc-fields">
            <div className="field">
              <label htmlFor="driver_id"><Truck size={13} aria-hidden="true" />Driver</label>
              <select id="driver_id" name="driver_id" value={driverId} required
                onChange={(e) => { setDriverId(e.target.value); setTicked({}); setCounted(null); }}>
                {drivers.map((d) => <option key={d.driverId} value={d.driverId}>{d.driver} · holds {fmt(d.held)}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="doc_date"><CalendarDays size={13} aria-hidden="true" />Date</label>
              <input id="doc_date" name="doc_date" type="date" defaultValue={today} max={today} required />
            </div>
            <div className="field">
              <label htmlFor="location_id"><Building2 size={13} aria-hidden="true" />Branch</label>
              {/* Where the collections were taken, so the cash lands in that branch's till. */}
              <select key={driverId} id="location_id" name="location_id" required={branches.length > 1}
                defaultValue={branches.length === 1 ? branches[0].id
                  : branches.find((b) => b.id === driver?.collections[0]?.branchId)?.id ?? ""}>
                {branches.length > 1 && <option value="">Choose a branch</option>}
                {branches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="till_account_id"><Wallet size={13} aria-hidden="true" />Into till</label>
              <select id="till_account_id" name="till_account_id" defaultValue={tills[0]?.id ?? ""} required>
                {tills.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="memo"><StickyNote size={13} aria-hidden="true" />Note</label>
              <input id="memo" name="memo" type="text" placeholder="Optional" />
            </div>
          </div>
        </div>
      </div>

      <section className="card">
        <div className="card-head"><h2>Collections not handed in</h2><span className="page-sub">{driver?.collections.length ?? 0} open</span></div>
        {(driver?.collections.length ?? 0) === 0 ? (
          <div className="card-body"><p className="page-sub">
            {driver && driver.held > 0.005 ? `No open collection, but ${driver.driver} still owes ${fmt(driver.held)}: a hand-in counted short, or a lost parcel charged to them.` : "Nothing to hand in."}
          </p></div>
        ) : (
          <div className="tablewrap">
            <table>
              <thead><tr><th className="tight" /><th>Date</th><th>Receipt</th><th>Customer</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {driver!.collections.map((c) => (
                  <tr key={c.id}>
                    <td className="tight"><input type="checkbox" name="receipt_id" value={c.id} checked={isTicked(c.id)} aria-label={`Hand in ${c.no}`}
                      onChange={(e) => { setTicked((t) => ({ ...t, [c.id]: e.target.checked })); setCounted(null); }} /></td>
                    <td>{c.date}</td>
                    <td className="code"><Link href={`/documents/${c.id}`} target="_blank" style={{ color: "var(--link)" }}>{c.no}</Link>
                      {c.memo && <div className="subline">{c.memo}</div>}</td>
                    <td>{c.customer}</td>
                    <td className="r">{fmt(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card paycard">
        <div className="card-head"><h2>Cash counted</h2></div>
        <div className="card-body">
          <div className="row">
            <div className="field">
              <label htmlFor="counted">Cash counted</label>
              <input id="counted" name="counted" type="number" min="0" step="any" value={counted ?? String(expected)}
                onChange={(e) => setCounted(e.target.value)} />
              <span className="hint">What is actually in the driver&rsquo;s hand, counted at the till.</span>
            </div>
          </div>
          <dl className="cod-remit-sum">
            <div><dt>Collections ticked</dt><dd>{fmt(expected)}</dd></div>
            <div><dt>Counted</dt><dd>{fmt(countedN)}</dd></div>
            <div className={short > 0.005 ? "bad" : undefined}><dt>{short > 0.005 ? "Short, stays against the driver" : "Difference"}</dt><dd><strong>{fmt(Math.max(0, short))}</strong></dd></div>
          </dl>
        </div>
      </section>

      <div className="actions form-commit">
        <button type="submit" disabled={pending || countedN <= 0 || !driver}>{pending ? "Posting…" : `Receive ${fmt(countedN)}`}</button>
      </div>
    </form>
  );
}

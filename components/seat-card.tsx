"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Users, Minus, Plus } from "lucide-react";
import type { ActionResult } from "@/lib/actions";
import { useNotice } from "@/components/toast";

/**
 * User seats: the one person every package includes, plus those bought. On a
 * test site the extra seats can be set here; in production the provider does.
 */
export function SeatCard({ included, extra, active, locked, action }: {
  included: number; extra: number; active: number; locked: boolean;
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
}) {
  const [state, formAction, working] = useActionState<ActionResult | null, FormData>(action as never, null);
  useNotice(state);
  const router = useRouter();
  useEffect(() => { if (state && "ok" in state) router.refresh(); }, [state, router]);
  const [n, setN] = useState(extra);
  const seats = included + extra;
  const over = active > seats;

  return (
    <section className="card">
      <div className="card-head">
        <h2>User seats</h2>
        <span className="page-sub">Every package includes {included} user; each further person is a seat</span>
      </div>
      <div className="card-body seat-body">
        <span className="mod-icon seat-icon"><Users size={20} aria-hidden="true" /></span>
        <dl className="seat-figs">
          <div><dt>Included</dt><dd>{included}</dd></div>
          <div><dt>Extra seats</dt><dd>{extra}</dd></div>
          <div><dt>Total</dt><dd>{seats}</dd></div>
          <div><dt>Active users</dt><dd className={over ? "seat-over" : undefined}>{active}</dd></div>
        </dl>
        {!locked && (
          <form action={formAction} className="seat-form">
            <span className="seat-stepper">
              <button type="button" className="btn ghost tiny" aria-label="One seat fewer" onClick={() => setN((v) => Math.max(0, v - 1))}><Minus size={14} /></button>
              <input name="extra_users" type="number" min={0} max={500} value={n} onChange={(e) => setN(Math.max(0, Number(e.target.value) || 0))} aria-label="Extra seats" />
              <button type="button" className="btn ghost tiny" aria-label="One seat more" onClick={() => setN((v) => v + 1)}><Plus size={14} /></button>
            </span>
            <button type="submit" className="btn primary tiny" disabled={working || n === extra}>Save seats</button>
          </form>
        )}
      </div>
      {over && (
        <div className="card-body">
          <span className="page-sub">
            {active - seats} more active than seats. Everyone keeps working; adding or reactivating a person is refused until a seat is free.
          </span>
        </div>
      )}
    </section>
  );
}

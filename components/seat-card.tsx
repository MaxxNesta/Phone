"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus } from "lucide-react";
import type { ActionResult } from "@/lib/actions";
import { useNotice } from "@/components/toast";

type Line = { key: string; name: string; included: number; bought: number; used: number; blocked?: string };

/**
 * User seats. Package seats come in levels: the company's own level brings
 * one, and more are bought at a level no higher than the company's. Module
 * seats hold one module's roles. On a test site the counts can be set here;
 * in production the provider sets them.
 */
export function SeatCard({ packages, modules, locked, action }: {
  packages: Line[];
  modules: Line[];
  locked: boolean;
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
}) {
  const [state, formAction, working] = useActionState<ActionResult | null, FormData>(action as never, null);
  useNotice(state);
  const router = useRouter();
  useEffect(() => { if (state && "ok" in state) router.refresh(); }, [state, router]);
  const all = [...packages, ...modules];
  const [n, setN] = useState<Record<string, number>>(Object.fromEntries(all.map((x) => [x.key, x.bought])));
  const changed = all.some((x) => n[x.key] !== x.bought);

  const Row = ({ x, field }: { x: Line; field: string }) => {
    const total = x.included + (n[x.key] ?? 0);
    const over = x.used > x.included + x.bought;
    return (
      <div className={`seat-mod${x.blocked ? " blocked" : ""}`}>
        <div className="seat-mod-text">
          <strong>{x.name}</strong>
          <span className={over ? "seat-over" : undefined}>
            {x.blocked ?? `${x.used} in use of ${x.included + x.bought}${x.included ? ` (${x.included} included)` : ""}`}
          </span>
        </div>
        <input type="hidden" name={field} value={n[x.key] ?? 0} />
        {!locked && !x.blocked && (
          <span className="seat-stepper">
            <button type="button" className="btn ghost tiny" aria-label={`One ${x.name} fewer`}
              onClick={() => setN((s) => ({ ...s, [x.key]: Math.max(0, (s[x.key] ?? 0) - 1) }))}><Minus size={14} /></button>
            <span className="seat-mod-n" title={`${total} in all`}>{n[x.key] ?? 0}</span>
            <button type="button" className="btn ghost tiny" aria-label={`One ${x.name} more`}
              onClick={() => setN((s) => ({ ...s, [x.key]: (s[x.key] ?? 0) + 1 }))}><Plus size={14} /></button>
          </span>
        )}
      </div>
    );
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>User seats</h2>
        <span className="page-sub">Each person who signs in takes one seat</span>
      </div>
      <form action={formAction}>
        <div className="card-body seat-mods">
          <span className="seat-group">Package seats · any role, at their level</span>
          {packages.map((x) => <Row key={x.key} x={x} field={`pkg_${x.key}`} />)}
          <span className="seat-group">Module seats · that module’s roles only</span>
          {modules.map((x) => <Row key={x.key} x={x} field={`seats_${x.key}`} />)}
          <span className="page-sub seat-mods-note">
            The number beside each is the seats bought on top of what the package includes. A package seat can’t be above the
            company’s package: to give someone Advanced, move the company to Advanced first. Module seats: Sales — cashier or
            salesperson; Purchases — purchaser; Inventory — inventory clerk.
          </span>
        </div>
        {!locked && (
          <div className="card-body seat-save">
            <button type="submit" className="btn primary" disabled={working || !changed}>{working ? "Saving…" : "Save seats"}</button>
          </div>
        )}
      </form>
    </section>
  );
}

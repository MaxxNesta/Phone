"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ShoppingCart, Package, Boxes, BookOpen, Ship, Landmark, Briefcase, PieChart, Truck, Check, Plus,
  type LucideIcon,
} from "lucide-react";
import type { ActionResult } from "@/lib/actions";
import type { Module } from "@/lib/plans";
import { useNotice } from "@/components/toast";

const ICON: Record<Module, LucideIcon> = {
  sales: ShoppingCart, purchases: Package, inventory: Boxes, accounting: BookOpen,
  landed_cost: Ship, fixed_assets: Landmark, hr: Briefcase, equity: PieChart, logistics: Truck,
};

/**
 * The modules as cards: the core that comes with the package, then the
 * add-ons, each added or removed on its own. On a live site the provider
 * sets them, so the cards are shown without their buttons.
 */
export function ModuleSwitcher({ all, current, core, planName, locked, action }: {
  all: { key: Module; name: string; covers: string }[];
  current: string[];
  core: Module[];
  planName: string;
  locked: boolean;
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
}) {
  const [state, formAction, working] = useActionState<ActionResult | null, FormData>(action as never, null);
  useNotice(state);
  const router = useRouter();
  useEffect(() => { if (state && "ok" in state) router.refresh(); }, [state, router]);
  const included = all.filter((m) => core.includes(m.key));
  const addons = all.filter((m) => !core.includes(m.key));
  const added = addons.filter((m) => current.includes(m.key)).length;

  const Card = ({ m, on, isCore }: { m: (typeof all)[number]; on: boolean; isCore: boolean }) => {
    const Icon = ICON[m.key];
    return (
      <div className={`mod-card${on ? " on" : ""}`}>
        <span className="mod-icon"><Icon size={20} aria-hidden="true" /></span>
        <div className="mod-text">
          <strong>{m.name}</strong>
          <span>{m.covers}</span>
        </div>
        <div className="mod-foot">
          {isCore ? (
            <span className="mod-state"><Check size={14} aria-hidden="true" /> In {planName}</span>
          ) : locked ? (
            <span className="mod-state">{on ? <><Check size={14} aria-hidden="true" /> Added</> : "Not added"}</span>
          ) : (
            <form action={formAction}>
              <input type="hidden" name="module" value={m.key} />
              <input type="hidden" name="on" value={on ? "0" : "1"} />
              <button type="submit" className={`btn tiny ${on ? "ghost" : "primary"}`} disabled={working}>
                {on ? "Remove" : <><Plus size={14} aria-hidden="true" /> Add</>}
              </button>
            </form>
          )}
          {!isCore && on && !locked && <span className="mod-state"><Check size={14} aria-hidden="true" /> Added</span>}
        </div>
      </div>
    );
  };

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Included in your package</h2>
          <span className="page-sub">{planName} sets how deep each one goes</span>
        </div>
        <div className="card-body mod-grid">
          {included.map((m) => <Card key={m.key} m={m} on isCore />)}
        </div>
      </section>
      <section className="card">
        <div className="card-head">
          <h2>Add-on modules</h2>
          <span className="page-sub">{added} of {addons.length} added · on top of any package</span>
        </div>
        <div className="card-body mod-grid">
          {addons.map((m) => <Card key={m.key} m={m} on={current.includes(m.key)} isCore={false} />)}
        </div>
      </section>
    </>
  );
}

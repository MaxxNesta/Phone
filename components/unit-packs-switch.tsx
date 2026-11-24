"use client";

import { useActionState } from "react";
import { useNotice } from "@/components/toast";
import type { ActionResult } from "@/lib/actions";

type Result = ActionResult | null;

/**
 * The shop's own switch for packs and unit conversion (Settings → Units).
 * Off, a product is counted and sold in its one unit and the pack tools stay
 * out of sight; a phone shop never needs them.
 */
export function UnitPacksSwitch({ on, action }: { on: boolean; action: (prev: Result, fd: FormData) => Promise<Result> }) {
  const [state, formAction, pending] = useActionState(action, null);
  useNotice(state, { ok: "Saved." });
  return (
    <form action={formAction} className="card" style={{ marginBottom: "var(--s3)" }}>
      <div className="card-body" style={{ display: "flex", alignItems: "center", gap: "var(--s3)", flexWrap: "wrap" }}>
        <input type="hidden" name="on" value={on ? "0" : "1"} />
        <div style={{ flex: "1 1 320px" }}>
          <strong>Packs and unit conversion</strong>{" "}
          <span className={`pill ${on ? "ok" : "neutral"}`}>{on ? "On" : "Off"}</span>
          <div className="subline">
            Boxes and cartons on a product (1 CTN = 3 BOX = 30 PCS), and measures such as 1 FT = 0.3048 M.
            Off: every product is bought and sold in its one unit, as a phone shop does.
          </div>
        </div>
        <button type="submit" className={on ? "ghost" : undefined} disabled={pending}>
          {pending ? "Saving…" : on ? "Turn off" : "Turn on"}
        </button>
      </div>
    </form>
  );
}

"use client";

import { Layers } from "lucide-react";
import { HelpHint } from "./help-hint";

/**
 * How a courier's charge is spread over the goods it brought: one field for
 * the receipt, the bill and Record carriage inward alike, so all three ask
 * the same question in the same words.
 *
 *   PER    one figure for each item, multiplied by the items received
 *   EQUAL  one total, the same share on every item
 *   VALUE  one total, shared in proportion to what each item cost
 *
 * A fixed amount per item posts as its total shared equally — the same
 * thing, entered the other way round.
 */
export type Spread = "PER" | "EQUAL" | "VALUE";

export const SPREAD: Record<Spread, { label: string; says: string }> = {
  PER: { label: "Fixed amount per item", says: "Type the charge for one item; it is multiplied by every item received." },
  EQUAL: { label: "One total, split equally", says: "Type the courier's total; every item gets the same share." },
  VALUE: { label: "One total, split by item cost", says: "Type the courier's total; dearer items carry more of it, in proportion to what they cost." },
};

/** What the engine is told: a fixed amount per item is its total, shared equally. */
export const postedSpread = (s: Spread) => (s === "VALUE" ? "VALUE" : "EQUAL");

export function SpreadField({ id, value, onChange }: { id: string; value: Spread; onChange: (s: Spread) => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>
        <Layers size={13} aria-hidden="true" />Spread
        <HelpHint label="How the charge is spread">
          {(Object.keys(SPREAD) as Spread[]).map((k) => <span key={k} style={{ display: "block", marginBottom: 6 }}><strong>{SPREAD[k].label}.</strong> {SPREAD[k].says}</span>)}
        </HelpHint>
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as Spread)}>
        {(Object.keys(SPREAD) as Spread[]).map((k) => <option key={k} value={k}>{SPREAD[k].label}</option>)}
      </select>
    </div>
  );
}

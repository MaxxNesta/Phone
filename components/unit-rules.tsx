"use client";

import { useState } from "react";

type U = { id: string; code: string; name: string; ref_uom_id?: string | null };

/**
 * A unit's two rules (0214), for a spare-parts shop: what it equals in a
 * reference unit (1 FT = 0.3048 M, then every product counted in M can be
 * sold in FT), and whether it takes whole numbers only (no 2.5 PCS).
 */
export function UnitRules({ units, self, refId, refQty, whole }: {
  units: U[]; self?: { id: string; code: string };
  refId?: string | null; refQty?: number | null; whole?: boolean;
}) {
  const [code, setCode] = useState(self?.code ?? "");
  // A reference is a unit with no reference of its own, and never itself.
  const refs = units.filter((u) => !u.ref_uom_id && u.id !== self?.id);
  return (
    <div className="unitrules">
      <input type="hidden" name="unit_rules" value="1" />
      <div className="field">
        <label>Equals</label>
        <span className="unitrules-eq">
          <span>1 {self?.code ?? (code || "unit")} =</span>
          <input name="ref_qty" type="number" min="0" step="any" defaultValue={refQty ?? ""} placeholder="0.3048"
                 aria-label="How much of the reference unit" onFocus={(e) => { const c = e.currentTarget.form?.elements.namedItem("code") as HTMLInputElement | null; if (c) setCode(c.value.toUpperCase()); }} />
          <select name="ref_uom_id" defaultValue={refId ?? ""} aria-label="Reference unit">
            <option value="">— no reference</option>
            {refs.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}
          </select>
        </span>
        <span className="hint">For measures only: 1 FT = 0.3048 M lets every product counted in metres sell in feet. Boxes and cans stay on each product.</span>
      </div>
      <label className="check">
        <input name="whole_numbers" type="checkbox" defaultChecked={!!whole} />
        Whole numbers only <span className="hint">— pieces, boxes, sets: no 2.5</span>
      </label>
    </div>
  );
}

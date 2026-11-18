"use client";

import { useState } from "react";
import { UOM, unitLabel } from "@/lib/uom-labels";

type U = { id: string; code: string; name: string; name_my?: string | null; ref_uom_id?: string | null };

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
        <label>{UOM.equals}</label>
        <span className="unitrules-eq">
          <span>1 {self?.code ?? (code || "unit")} =</span>
          <input name="ref_qty" type="number" min="0" step="any" defaultValue={refQty ?? ""} placeholder="0.3048"
                 aria-label="How much of the reference unit" onFocus={(e) => { const c = e.currentTarget.form?.elements.namedItem("code") as HTMLInputElement | null; if (c) setCode(c.value.toUpperCase()); }} />
          <select name="ref_uom_id" defaultValue={refId ?? ""} aria-label="Reference unit">
            <option value="">— မရှိ · no reference</option>
            {refs.map((u) => <option key={u.id} value={u.id}>{unitLabel(u)}</option>)}
          </select>
        </span>
        <span className="hint">တိုင်းတာမှုအတွက်သာ: 1 ပေ = 0.3048 မီတာ ဆိုလျှင် မီတာဖြင့် ရေတွက်သော ပစ္စည်းတိုင်းကို ပေဖြင့် ရောင်းနိုင်သည်။ ဗူး၊ ကာတွန်တို့သည် ပစ္စည်းတစ်ခုချင်းအလိုက် · For measures only: 1 FT = 0.3048 M lets every product counted in metres sell in feet. Boxes and cartons stay on each product.</span>
      </div>
      <label className="check">
        <input name="whole_numbers" type="checkbox" defaultChecked={!!whole} />
        {UOM.whole} <span className="hint">— ခု၊ ဗူး၊ စုံ: 2.5 မရ · pieces, boxes, sets: no 2.5</span>
      </label>
    </div>
  );
}

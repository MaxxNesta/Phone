"use client";

import { useState } from "react";

export type PartNo = { kind: string; no: string; maker: string };
type Row = PartNo & { key: number };

const KINDS = [
  { v: "OEM", label: "OEM" },
  { v: "EQUIVALENT", label: "Equivalent" },
  { v: "SUPPLIER", label: "Supplier code" },
];

/**
 * The numbers a part is asked for by: the vehicle maker's (OEM), other
 * brands' equivalents, the supplier's own code. Any of them typed or scanned
 * at the counter finds this item. Laid out like Pack sizes beside it.
 */
export function PartNumbers({ initial }: { initial: PartNo[] }) {
  const [rows, setRows] = useState<Row[]>(initial.map((p, i) => ({ ...p, key: i })));
  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const payload = JSON.stringify(rows.filter((r) => r.no.trim()).map(({ kind, no, maker }) => ({ kind, no: no.trim(), maker: maker.trim() })));

  return (
    <div className="field">
      <label>Part numbers</label>
      <input type="hidden" name="part_numbers" value={payload} />
      {rows.length === 0 && <span className="hint">None yet. Add the OEM number so a search for it finds this part.</span>}
      {rows.map((r) => (
        <div key={r.key} className="partrow">
          <select value={r.kind} onChange={(e) => set(r.key, { kind: e.target.value })} aria-label="Kind of number">
            {KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}
          </select>
          <input value={r.no} onChange={(e) => set(r.key, { no: e.target.value })} placeholder="e.g. 04465-0K240"
                 aria-label="Part number" />
          <input value={r.maker} onChange={(e) => set(r.key, { maker: e.target.value })} placeholder="Maker (optional)"
                 aria-label="Maker" />
          <button type="button" className="ghost tiny" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>Remove</button>
        </div>
      ))}
      <button type="button" className="ghost tiny" style={{ marginTop: "0.4rem" }}
              onClick={() => setRows((rs) => [...rs, { key: Date.now(), kind: rs.length ? "EQUIVALENT" : "OEM", no: "", maker: "" }])}>
        + Part number
      </button>
      <span className="hint">Searched with spaces, dashes and dots ignored, so 04465-0K240 and 044650K240 find the same part.</span>
    </div>
  );
}

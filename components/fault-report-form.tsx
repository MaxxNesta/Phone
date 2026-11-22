"use client";

import { useActionState } from "react";
import { AlertTriangle } from "lucide-react";
import { reportFaultyAction } from "@/lib/fault-actions";

export type FaultLine = {
  lineId: string; itemCode: string; itemName: string;
  identity: string | null;
  /** Units of this line still on the shelf, not yet reported; empty for an untracked item. */
  units: string[];
  tracked: boolean;
  /** For an untracked item: how many may still be reported. */
  maxQty: number;
};

/** Choose the faulty units, say what is wrong, replace or credit (0224). */
export function FaultReportForm({ receiptId, lines, preselect }: { receiptId: string; lines: FaultLine[]; preselect: string[] }) {
  const [state, action, pending] = useActionState(reportFaultyAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="receipt_id" value={receiptId} />
      {state?.error && <div className="alert">{state.error}</div>}
      <div className="card">
        <div className="card-head"><h2>Which units</h2></div>
        <div className="card-body" style={{ display: "grid", gap: "var(--s3)" }}>
          {lines.map((l) => (
            <div key={l.lineId} className="field" style={{ margin: 0 }}>
              <input type="hidden" name="line_id" value={l.lineId} />
              <label>{l.itemName} <span className="subline" style={{ display: "inline" }}>{l.itemCode}</span></label>
              {l.tracked ? (
                l.units.length === 0
                  ? <span className="subline">Nothing from this line is still on the shelf.</span>
                  : (
                    <div className="reject-imeis">
                      {l.units.map((sn) => (
                        <label key={sn} className="reject-imei">
                          <input type="checkbox" name={`serial_${l.lineId}`} value={sn} defaultChecked={preselect.includes(sn)} /> {sn}
                        </label>
                      ))}
                    </div>
                  )
              ) : (
                <input type="number" name={`qty_${l.lineId}`} min="0" max={l.maxQty} step="any" defaultValue=""
                  placeholder={`Up to ${l.maxQty}`} aria-label={`Faulty ${l.itemCode}`} style={{ maxWidth: 160 }} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="reject-panel" style={{ margin: "var(--s3) 0" }}>
        <div className="reject-panel-head">
          <AlertTriangle size={16} aria-hidden="true" style={{ color: "#B07F00" }} />
          What is wrong
          <span className="page-sub" style={{ fontWeight: 400, marginLeft: 4 }}>
            The units move into this warehouse&rsquo;s quarantine bin, off sale, until they go back.
          </span>
        </div>
        <div className="reject-grid" style={{ gridTemplateColumns: "minmax(240px, 1.4fr) minmax(240px, 1fr)" }}>
          <div className="field">
            <label htmlFor="reason">Fault</label>
            <input id="reason" name="reason" type="text" required
              placeholder="Battery drains overnight, no signal, camera fails…" />
            <span className="hint">Printed on the rejection note that goes back with them.</span>
          </div>
          <div className="field">
            <label>The supplier will</label>
            <div className="choice-list">
              <label className="choice">
                <input type="radio" name="outcome" value="REPLACE" required defaultChecked />
                <span>Replace it<small>The order waits for another once it goes back.</small></span>
              </label>
              <label className="choice">
                <input type="radio" name="outcome" value="CREDIT" />
                <span>Credit it<small>The order is done; the bill or return covers it.</small></span>
              </label>
            </div>
          </div>
        </div>
      </div>
      <button className="btn" disabled={pending}>{pending ? "Moving to quarantine…" : "Move to quarantine"}</button>
    </form>
  );
}

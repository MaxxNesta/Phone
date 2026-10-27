"use client";

import { useActionState, useState } from "react";
import { Plus, X } from "lucide-react";
import type { ActionResult } from "@/lib/actions";

type Asset = { id: string; code: string; name: string; expected: Record<string, string> };
type Row = { assetId: string; kind: "DEPRECIATION" | "CORRECTION" | "ACQUISITION" | "OPENING"; month: string; amount: string };

const kyat = (s: string) => Number(s).toLocaleString("en-US", { maximumFractionDigits: 0 });
// Exact enough for a running total: ten-thousandths as integers.
const units = (s: string) => { const [i, f = ""] = (s || "0").replace(/,/g, "").split("."); return BigInt(i || "0") * 10000n + BigInt((f + "0000").slice(0, 4)); };
const show = (u: bigint) => (Number(u) / 10000).toLocaleString("en-US", { maximumFractionDigits: 4 });

/**
 * Splits one journal line across assets. The schedule's own figure for each
 * asset month is shown beside it, so a historical entry that differs from
 * what the engine expects is visible before it is linked, not after.
 */
export function FaLinkForm({ action, lineId, role, credit, remaining, defaultMonth, assets }: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  lineId: string; role: "ASSET" | "ACCUM"; credit: boolean; remaining: string; defaultMonth: string;
  assets: Asset[];
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action as never, null);
  const kind: Row["kind"] = role === "ASSET" ? "ACQUISITION" : credit ? "DEPRECIATION" : "CORRECTION";
  const blank = (): Row => ({ assetId: "", kind, month: defaultMonth, amount: "" });
  const [rows, setRows] = useState<Row[]>([blank()]);
  const set = (i: number, p: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const total = rows.reduce((s, r) => s + units(r.amount), 0n);
  const left = units(remaining) - total;
  const byId = new Map(assets.map((a) => [a.id, a]));

  if (assets.length === 0) return <p className="fa-muted">No asset uses this account, so there is nothing to link it to.</p>;
  return (
    <form action={formAction} className="far-form">
      <input type="hidden" name="line_id" value={lineId} />
      <input type="hidden" name="allocations" value={JSON.stringify(rows.filter((r) => r.assetId && r.amount))} />
      {state && "error" in state && <div className="alert" role="alert">{state.error}</div>}
      {state && "ok" in state && <p className="fa-ok" role="status">Linked. Nothing was posted; the register now counts this journal.</p>}
      {rows.map((r, i) => {
        const exp = r.kind === "DEPRECIATION" || r.kind === "CORRECTION" ? byId.get(r.assetId)?.expected[r.month] : undefined;
        const differs = exp !== undefined && r.amount && units(exp) !== units(r.amount);
        return (
          <div key={i} className="far-row">
            <select value={r.assetId} onChange={(e) => set(i, { assetId: e.target.value })} aria-label="Asset" required>
              <option value="">Asset…</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
            {role === "ACCUM" && (
              <>
                <select value={r.kind} onChange={(e) => set(i, { kind: e.target.value as Row["kind"] })} aria-label="Carries">
                  {credit && <option value="DEPRECIATION">Depreciation</option>}
                  {credit && <option value="OPENING">Opening: accumulated to</option>}
                  <option value="CORRECTION">Correction</option>
                </select>
                <input type="month" value={r.month} onChange={(e) => set(i, { month: e.target.value })} aria-label="For month" required />
              </>
            )}
            <span className="ie-money"><i>MMK</i>
              <input value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} inputMode="decimal" aria-label="Amount" placeholder="0" /></span>
            <button type="button" className="far-x" aria-label="Remove row" onClick={() => setRows(rows.length > 1 ? rows.filter((_, k) => k !== i) : [blank()])}><X size={14} /></button>
            {exp !== undefined && (
              <small className={`far-exp${differs ? " differs" : ""}`}>Schedule expects {kyat(exp)} for {r.month}{differs ? "; the difference is absorbed by later months" : ""}</small>
            )}
          </div>
        );
      })}
      <div className="far-foot">
        <button type="button" className="ie-btn" onClick={() => setRows([...rows, blank()])}><Plus size={14} /> Another asset</button>
        <button type="button" className="ie-btn" disabled={left <= 0n}
          onClick={() => { const k = rows.length - 1; set(k, { amount: show(units(rows[k].amount) + left).replace(/,/g, "") }); }}>Fill remaining</button>
        <span className={`far-left${left < 0n ? " over" : ""}`}>{left < 0n ? `${show(-left)} more than the line` : `${show(left)} left of ${kyat(remaining)}`}</span>
        <button className="ie-btn primary" disabled={pending || total === 0n || left < 0n}>{pending ? "Linking…" : "Link"}</button>
      </div>
    </form>
  );
}

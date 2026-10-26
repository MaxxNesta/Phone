"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import type { ActionResult } from "@/lib/actions";
import { AGING_DEFAULTS, PACE_DEFAULTS, bucketRanges, type AgingRules, type PaceRules } from "@/lib/aging-rules";

type T = [number, number, number];
const rising = (t: number[]) => t.every((n) => Number.isInteger(n) && n > 0) && t[0] < t[1] && t[1] < t[2];

/**
 * The shop's age groups with a live preview, the sales-pace cut-offs on
 * their own, and the categories that keep limits of their own.
 */
export function AgingSettingsForm({ action, rules, pace, groups }: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  rules: AgingRules; pace: PaceRules;
  groups: { id: string; name: string; thresholds: T | null }[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action as never, null);
  const [t, setT] = useState<number[]>([...rules.thresholds]);
  const [labels, setLabels] = useState<string[]>([...rules.labels]);
  const [p, setP] = useState({ ...pace });
  const [over, setOver] = useState<Record<string, number[] | null>>(Object.fromEntries(groups.map((g) => [g.id, g.thresholds ? [...g.thresholds] : null])));
  useEffect(() => { if (state && "ok" in state) router.refresh(); }, [state, router]);

  const ok = rising(t) && labels.every((l) => l.trim()) && p.fastDays > 0 && p.fastDays < p.slowDays
    && Object.values(over).every((o) => !o || rising(o));
  const payload = JSON.stringify({ thresholds: t, labels, fastDays: p.fastDays, slowDays: p.slowDays,
    overrides: Object.entries(over).filter(([, o]) => o).map(([groupId, thresholds]) => ({ groupId, thresholds })) });
  const num = (v: string) => Math.floor(Number(v)) || 0;
  const ranges = rising(t) ? bucketRanges(t as T) : ["—", "—", "—", "—"];

  return (
    <form action={formAction} className="ags">
      <input type="hidden" name="settings" value={payload} />
      {state && "error" in state && <div className="alert" role="alert">{state.error}</div>}
      {state && "ok" in state && <div className="ags-saved" role="status">Settings saved. Inventory Aging now uses them.</div>}

      <section className="ie-card">
        <div className="ie-head">
          <h3>Stock age groups</h3>
          <button type="button" className="ie-btn" onClick={() => { setT([...AGING_DEFAULTS.thresholds]); setLabels([...AGING_DEFAULTS.labels]); }}>
            <RotateCcw size={14} aria-hidden="true" /> Reset defaults
          </button>
        </div>
        <p className="ie-note" style={{ marginTop: 0 }}>Days since a unit was received. Each limit is the last day of its group.</p>
        <div className="ags-rows">
          {labels.map((l, b) => (
            <div key={b} className="ags-row">
              <i className={`ag-dot ag-b${b}`} aria-hidden="true" />
              <label className="ie-field"><span>Name</span>
                <input value={l} maxLength={30} onChange={(e) => setLabels(labels.map((x, k) => (k === b ? e.target.value : x)))} />
              </label>
              {b < 3 ? (
                <label className="ie-field"><span>Up to</span>
                  <span className="ags-days"><input type="number" min="1" step="1" value={t[b]}
                    onChange={(e) => setT(t.map((x, k) => (k === b ? num(e.target.value) : x)))} /> <small>days</small></span>
                </label>
              ) : <div className="ie-field"><span>Beyond</span><output className="ie-ro">{t[2] || "—"} days</output></div>}
            </div>
          ))}
        </div>
        {!rising(t) && <p className="ags-warn">Each limit must be larger than the one before.</p>}

        <h4 className="ags-sub">Live classification preview</h4>
        <ul className="ags-preview">
          {labels.map((l, b) => (
            <li key={b}><i className={`ag-dot ag-b${b}`} aria-hidden="true" /><strong>{l || "—"}</strong><span>{ranges[b]}</span></li>
          ))}
        </ul>
      </section>

      <section className="ie-card">
        <div className="ie-head">
          <h3>Sales pace</h3>
          <button type="button" className="ie-btn" onClick={() => setP({ ...PACE_DEFAULTS })}><RotateCcw size={14} aria-hidden="true" /> Reset defaults</button>
        </div>
        <p className="ie-note" style={{ marginTop: 0 }}>
          Judged by sales, not by age: how many days the stock on hand lasts at the last 90 days&apos; selling rate.
          A phone received 10 days ago that has not sold is fresh, and slow.
        </p>
        <div className="ags-pace">
          <label className="ie-field"><span>Fast: lasts up to</span>
            <span className="ags-days"><input type="number" min="1" value={p.fastDays} onChange={(e) => setP({ ...p, fastDays: num(e.target.value) })} /> <small>days</small></span></label>
          <label className="ie-field"><span>Moderate: up to</span>
            <span className="ags-days"><input type="number" min="2" value={p.slowDays} onChange={(e) => setP({ ...p, slowDays: num(e.target.value) })} /> <small>days</small></span></label>
          <div className="ie-field"><span>Slow</span><output className="ie-ro">More than {p.slowDays} days</output></div>
          <div className="ie-field"><span>No sales</span><output className="ie-ro">Nothing sold in 90 days</output></div>
        </div>
        {!(p.fastDays > 0 && p.fastDays < p.slowDays) && <p className="ags-warn">Fast must be fewer days than Moderate.</p>}
      </section>

      {groups.length > 0 && (
        <section className="ie-card">
          <h3>By category</h3>
          <p className="ie-note" style={{ marginTop: 0 }}>A category can keep tighter or looser age limits, for example iPhones sooner than accessories. Names stay the same.</p>
          <table className="ie-table ags-cats">
            <thead><tr><th>Category</th><th>Limits</th><th className="r">{labels[0]}</th><th className="r">{labels[1]}</th><th className="r">{labels[2]}</th></tr></thead>
            <tbody>
              {groups.map((g) => {
                const o = over[g.id];
                return (
                  <tr key={g.id}>
                    <td>{g.name}</td>
                    <td>
                      <select value={o ? "own" : "default"} aria-label={`Limits for ${g.name}`}
                        onChange={(e) => setOver({ ...over, [g.id]: e.target.value === "own" ? [...t] : null })}>
                        <option value="default">Company default</option><option value="own">Its own</option>
                      </select>
                    </td>
                    {[0, 1, 2].map((b) => (
                      <td key={b} className="r">
                        {o ? <input type="number" min="1" value={o[b]} aria-label={`${g.name}: ${labels[b]} up to`}
                               onChange={(e) => setOver({ ...over, [g.id]: o.map((x, k) => (k === b ? num(e.target.value) : x)) })} />
                           : <span className="page-sub">{t[b]} d</span>}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <footer className="ie-bar">
        <Link className="ie-btn" href="/reports/phone-stock">Back to Inventory Aging</Link>
        <span className="ie-bar-note" />
        <button type="submit" className="ie-btn primary" disabled={pending || !ok}>{pending ? "Saving…" : "Save settings"}</button>
      </footer>
    </form>
  );
}

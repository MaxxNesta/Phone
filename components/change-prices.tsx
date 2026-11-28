"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions";
import { useNotice } from "@/components/toast";
import type { PriceProduct } from "@/components/price-list";

type Level = { id: string; name: string; isDefault: boolean };
type Act = (prev: unknown, fd: FormData) => Promise<ActionResult>;
const mmk = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const ROUNDS = [["0", "Don’t round"], ["100", "Nearest 100"], ["500", "Nearest 500"], ["1000", "Nearest 1,000"], ["10000", "Nearest 10,000"]] as const;

/**
 * Change prices (2026-11-28, after the Astryx preview): many prices up or
 * down at once. The form on the left — which products, levels and units, by
 * how much, rounded how, from when, and why — and on the right every price it
 * will change, today's figure against the new one. The amount goes onto each
 * chosen unit's own price; changeAction (lib/actions.ts) repeats the sum.
 */
export function ChangePrices({ open, onClose, products, selected, matching, q, levels, today, action }: {
  open: boolean; onClose: () => void; products: PriceProduct[]; selected: Set<string>; matching: PriceProduct[]; q: string;
  levels: Level[]; today: string; action: Act;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const start = () => (selected.size ? "selected" : q.trim() ? "search" : "all");
  const [scope, setScope] = useState<"selected" | "search" | "all">(start);
  const [lv, setLv] = useState<Set<string>>(() => new Set(levels.map((l) => l.id)));
  const [un, setUn] = useState<Set<string> | null>(null);   // unit codes; null = every unit
  const [dir, setDir] = useState<"up" | "down">("up");
  const [by, setBy] = useState<"amount" | "percent">("amount");
  const [value, setValue] = useState("");
  const [round, setRound] = useState("0");
  const [from, setFrom] = useState(today);
  const [note, setNote] = useState("");
  const [state, submit, saving] = useActionState<ActionResult | null, FormData>(action as never, null);
  useNotice(state, { ok: "Prices changed" });

  useEffect(() => {
    // Each opening starts fresh: every level and unit, the scope the list suggests.
    if (open) { setScope(start()); setLv(new Set(levels.map((l) => l.id))); setUn(null); dialog.current?.showModal(); } else dialog.current?.close();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (state && "ok" in state) { router.refresh(); setValue(""); setNote(""); onClose(); }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const pool = scope === "selected" ? products.filter((p) => selected.has(p.itemId)) : scope === "search" ? matching : products;
  const units = [...new Set(pool.flatMap((p) => p.units.map((u) => u.code)))];
  const unitOn = (c: string) => un === null || un.has(c);
  const v = Number(value) || 0;

  // Every price set at a chosen level and unit: the one in force on the date, and the new one.
  const rows = useMemo(() => {
    const out: { key: string; p: PriceProduct; unit: string; uomId: string; level: Level; now: number; next: number }[] = [];
    const r = Number(round), d = dir === "up" ? v : -v;
    for (const p of pool) for (const u of p.units) for (const l of levels) {
      if (!unitOn(u.code) || !lv.has(l.id)) continue;
      const now = u.cells[l.id]?.history.find((h) => h.from <= from)?.price;
      if (now == null) continue;   // a blank stays blank
      const x = by === "amount" ? now + d : now * (1 + d / 100);
      out.push({ key: `${p.itemId}|${u.uomId}|${l.id}`, p, unit: u.code, uomId: u.uomId, level: l, now, next: r ? Math.round(x / r) * r : Math.round(x) });
    }
    return out;
  }, [pool, levels, lv, un, v, by, dir, round, from]); // eslint-disable-line react-hooks/exhaustive-deps
  const changing = rows.filter((r) => r.next !== r.now);
  const below = rows.filter((r) => r.next <= 0).length;
  const hit = new Set(changing.map((r) => r.p.itemId)).size;
  const tooMuch = by === "percent" && dir === "down" && v >= 100;
  const ready = v > 0 && changing.length > 0 && below === 0 && !tooMuch;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const error = state && "error" in state ? state.error : null;

  const flip = (s: Set<string>, id: string, on: boolean) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; };

  return (
    <dialog ref={dialog} className="pl3-dialog cp-dialog" aria-labelledby="cp-title" onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pl3-dialog-head">
        <div>
          <h2 id="cp-title">Change prices</h2>
          <p>Raise or lower many prices at once. Each change is a new dated price; the old one stays in the history.</p>
        </div>
        <button type="button" className="pl3-x" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <form action={submit} className="cp-body" id="cp-form">
        {[...new Set(changing.map((r) => r.p.itemId))].map((id) => <input key={id} type="hidden" name="item_id" value={id} />)}
        {[...new Set(changing.map((r) => r.level.id))].map((id) => <input key={id} type="hidden" name="price_level_id" value={id} />)}
        {[...new Set(changing.map((r) => r.uomId))].map((id) => <input key={id} type="hidden" name="uom_id" value={id} />)}
        <input type="hidden" name="direction" value={dir} />
        <input type="hidden" name="by" value={by} />

        <div className="cp-form">
          {error && <div className="alert">{error}</div>}
          <fieldset className="cp-set">
            <legend>Products</legend>
            {([
              ["selected", "Selected products", selected.size, selected.size ? null : "Tick products in the list first"],
              ["search", "Products matching the search", q.trim() ? matching.length : 0, q.trim() ? `“${q.trim()}”` : "Search the list by name or code first"],
              ["all", "All products", products.length, null],
            ] as const).map(([k, label, n, hint]) => (
              <label key={k} className={`cp-radio${n === 0 ? " off" : ""}`}>
                <input type="radio" name="cp-scope" checked={scope === k} disabled={n === 0} onChange={() => setScope(k)} />
                <span>{label}{hint && <small>{hint}</small>}</span>
                <span className="pl3-badge">{n}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="cp-set">
            <legend>Price levels</legend>
            <div className="cp-checks">
              {levels.map((l) => (
                <label key={l.id} className="pl3-check"><input type="checkbox" checked={lv.has(l.id)} onChange={(e) => setLv(flip(lv, l.id, e.target.checked))} />
                  <span>{l.name}{l.isDefault ? " (Default)" : ""}</span></label>
              ))}
            </div>
          </fieldset>

          <fieldset className="cp-set">
            <legend>Units</legend>
            <div className="cp-checks">
              {units.map((c) => (
                <label key={c} className="pl3-check"><input type="checkbox" checked={unitOn(c)} onChange={(e) => setUn(flip(un ?? new Set(units), c, e.target.checked))} />
                  <span>{c}</span></label>
              ))}
            </div>
            <p className="pl3-hint">An amount goes onto each ticked unit’s own price: a pack raised leaves its pieces as they are.</p>
          </fieldset>

          <hr />

          <fieldset className="cp-set">
            <legend>Change</legend>
            <div className="cp-segs">
              <div className="cp-seg" role="radiogroup" aria-label="Increase or decrease">
                <button type="button" role="radio" aria-checked={dir === "up"} onClick={() => setDir("up")}><span aria-hidden="true">↗</span> Increase</button>
                <button type="button" role="radio" aria-checked={dir === "down"} onClick={() => setDir("down")}><span aria-hidden="true">↘</span> Decrease</button>
              </div>
              <div className="cp-seg" role="radiogroup" aria-label="By">
                <button type="button" role="radio" aria-checked={by === "amount"} onClick={() => { setBy("amount"); setRound("0"); }}>MMK</button>
                <button type="button" role="radio" aria-checked={by === "percent"} onClick={() => { setBy("percent"); setRound("100"); }}>%</button>
              </div>
            </div>
          </fieldset>
          <label className="pl3-field">{by === "amount" ? "Amount (MMK)" : "Percentage"}
            <span className="pl3-hint">{by === "amount" ? "Added to or taken off each price as it is." : "Of each price as it is."}</span>
            <input name="value" type="number" min="0" step="any" inputMode="decimal" required autoFocus value={value}
              placeholder={by === "amount" ? "10,000" : "1"} onChange={(e) => setValue(e.target.value)} />
          </label>
          <div className="cp-pair">
            <label className="pl3-field">Round to
              <select name="round" value={round} onChange={(e) => setRound(e.target.value)}>
                {ROUNDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
            <label className="pl3-field">Effective from
              <input name="valid_from" type="date" value={from} required onChange={(e) => setFrom(e.target.value || today)} />
            </label>
          </div>
          <p className="pl3-hint">Invoices before this date keep their price.</p>
          <label className="pl3-field">Note <span className="pl3-hint">Optional. Shown beside these changes in the price history.</span>
            <input name="note" maxLength={200} value={note} placeholder="November price rise" onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>

        <div className="cp-side">
          <div className="cp-sum">
            <strong>{v > 0 ? `${plural(changing.length, "price")} on ${plural(hit, "product")}` : "Preview"}</strong>
            {v > 0 && <span className={`pl3-badge ${dir === "up" ? "cp-up" : "cp-down"}`}>{dir === "up" ? "+" : "−"}{by === "amount" ? `${mmk(v)} MMK` : `${v}%`}</span>}
          </div>
          {below > 0 && <div className="alert">{plural(below, "price")} would fall to zero or below. Lower the amount, or leave those products out.</div>}
          {tooMuch && <div className="alert">A decrease must be less than 100%.</div>}
          {rows.length === 0 ? (
            <div className="cp-empty">No prices are set at these levels and units for these products. A blank price stays blank.</div>
          ) : (
            <div className="cp-preview">
              <table className="pl3-table cp-table">
                <colgroup><col /><col style={{ width: 64 }} /><col style={{ width: 64 }} /><col style={{ width: 112 }} /><col style={{ width: 120 }} /></colgroup>
                <thead><tr><th>Product</th><th>Unit</th><th>Level</th><th className="r">Now</th><th className="r">New</th></tr></thead>
                <tbody>
                  {rows.slice(0, 500).map((r) => (
                    <tr key={r.key}>
                      <td className="cp-prod"><span>{r.p.name}</span><small>{r.p.code}</small></td>
                      <td>{r.unit}</td>
                      <td>{r.level.name}</td>
                      <td className="r cp-now">{mmk(r.now)}</td>
                      <td className="r">
                        <strong className={r.next <= 0 ? "cp-bad" : undefined}>{mmk(r.next)}</strong>
                        {r.next !== r.now && <small className="cp-diff">{r.next > r.now ? "+" : "−"}{mmk(Math.abs(r.next - r.now))}</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 500 && <p className="pl3-hint cp-more">and {rows.length - 500} more</p>}
            </div>
          )}
          <p className="pl3-hint">Only prices already set change. Products with no price at a level are left as they are.</p>
        </div>
      </form>
      <div className="pl3-dialog-foot cp-foot">
        <button type="button" className="pl3-btn" onClick={onClose}>Cancel</button>
        <button type="submit" form="cp-form" className="pl3-btn primary" disabled={!ready || saving}>
          {saving ? "Applying…" : ready ? `Apply to ${plural(changing.length, "price")}` : "Apply"}
        </button>
      </div>
    </dialog>
  );
}

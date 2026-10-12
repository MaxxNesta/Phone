"use client";

import { useActionState, useMemo, useState } from "react";
import { Plus, Trash2, Link2 } from "lucide-react";
import { saveLandedCostAction, landedCostStepAction } from "@/lib/landed-cost-actions";

type Method = "VALUE" | "EQUAL" | "MANUAL";
const METHODS: [Method, string][] = [
  ["VALUE", "By purchase value"],
  ["EQUAL", "Equal per phone"],
  ["MANUAL", "Manual by product variant"],
];

export type EditorCharge = {
  key: number;
  costTypeId: string;
  partnerId: string;
  sourceJournalLineId: string;
  description: string;
  currency: string;
  exchangeRate: string;
  rateDate: string;
  amount: string;
  method: Method;
  clearingAccountId: string;
  reference: string;
  manual: Record<string, string>;
};

type Option = { id: string; label: string };
type Source = {
  id: string; entry_no: string; entry_date: string; doc_no: string | null; partner: string | null;
  currency: string; fc_amount: number; base_amount: number; exchange_rate: number; memo: string;
};

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function LandedCostEditor(props: {
  id: string;
  base: string;
  header: { docDate: string; templateId: string; shipmentRef: string; carrierRef: string; notes: string };
  receipts: { id: string; label: string; meta: string; earlier: string }[];
  chosen: string[];
  charges: EditorCharge[];
  types: (Option & { method: Method; partnerId: string | null; currency: string | null; accountId: string | null })[];
  templates: (Option & { lines: { costTypeId: string; method: Method }[] })[];
  partners: Option[];
  accounts: Option[];
  currencies: { code: string; rate: number | null; rateDate: string | null }[];
  sources: Source[];
  variants: { itemId: string; name: string; phones: number }[];
  clearingId: string;
}) {
  const [state, save, saving] = useActionState(saveLandedCostAction, null);
  const [header, setHeader] = useState(props.header);
  const [chosen, setChosen] = useState<string[]>(props.chosen);
  const [charges, setCharges] = useState<EditorCharge[]>(props.charges);
  const [nextKey, setNextKey] = useState(props.charges.length + 1);

  const typeOf = (id: string) => props.types.find((t) => t.id === id);
  const sourceOf = (id: string) => props.sources.find((s) => s.id === id);
  const blank = (costTypeId = "", method: Method = "VALUE"): EditorCharge => {
    const t = typeOf(costTypeId);
    const currency = t?.currency || props.base;
    const fx = props.currencies.find((c) => c.code === currency);
    return {
      key: 0, costTypeId, partnerId: t?.partnerId ?? "", sourceJournalLineId: "", description: "",
      currency, exchangeRate: currency === props.base ? "1" : fx?.rate ? String(fx.rate) : "",
      rateDate: fx?.rateDate ?? header.docDate, amount: "", method: t ? (method ?? t.method) : method,
      clearingAccountId: t?.accountId ?? "", reference: "", manual: {},
    };
  };
  const add = (c: EditorCharge) => { setCharges((cs) => [...cs, { ...c, key: nextKey }]); setNextKey((k) => k + 1); };
  const set = (key: number, patch: Partial<EditorCharge>) =>
    setCharges((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const applyTemplate = (id: string) => {
    setHeader((h) => ({ ...h, templateId: id }));
    const t = props.templates.find((x) => x.id === id);
    if (!t) return;
    const filled = charges.filter((c) => Number(c.amount) > 0 || c.sourceJournalLineId);
    let k = nextKey;
    const fromTemplate = t.lines
      .filter((l) => !filled.some((c) => c.costTypeId === l.costTypeId))
      .map((l) => ({ ...blank(l.costTypeId, l.method), key: k++ }));
    setCharges([...filled, ...fromTemplate]);
    setNextKey(k);
  };

  const baseOf = (c: EditorCharge) => {
    if (c.sourceJournalLineId) return sourceOf(c.sourceJournalLineId)?.base_amount ?? 0;
    const amt = Number(c.amount) || 0;
    return c.currency === props.base ? amt : amt * (Number(c.exchangeRate) || 0);
  };
  const total = useMemo(() => charges.reduce((t, c) => t + Math.round(baseOf(c)), 0), [charges]); // eslint-disable-line react-hooks/exhaustive-deps

  const payload = JSON.stringify({
    id: props.id,
    docDate: header.docDate, templateId: header.templateId || null,
    shipmentRef: header.shipmentRef, carrierRef: header.carrierRef, notes: header.notes,
    receiptIds: chosen,
    charges: charges.map((c) => ({
      costTypeId: c.costTypeId, partnerId: c.partnerId || null,
      sourceJournalLineId: c.sourceJournalLineId || null, description: c.description,
      currency: c.currency, exchangeRate: Number(c.exchangeRate) || null, rateDate: c.rateDate || null,
      amount: Number(c.amount) || null, method: c.method, clearingAccountId: c.clearingAccountId || null,
      reference: c.reference,
      manual: c.method === "MANUAL"
        ? Object.entries(c.manual).map(([itemId, amount]) => ({ itemId, amount: Number(amount) || 0 }))
        : [],
    })),
  });

  return (
    <form action={save} className="lc-editor">
      <input type="hidden" name="payload" value={payload} />

      <section className="card">
        <div className="card-head"><h2>Shipment</h2></div>
        <div className="card-body">
          <div className="row">
            <div className="field">
              <label htmlFor="lc-date">Date</label>
              <input id="lc-date" type="date" value={header.docDate} required
                onChange={(e) => setHeader({ ...header, docDate: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="lc-template">Template</label>
              <select id="lc-template" value={header.templateId} onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">No template</option>
                {props.templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="lc-ship">Shipment reference</label>
              <input id="lc-ship" value={header.shipmentRef} onChange={(e) => setHeader({ ...header, shipmentRef: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="lc-carrier">Carrier or tracking number <span className="opt">optional</span></label>
              <input id="lc-carrier" value={header.carrierRef} onChange={(e) => setHeader({ ...header, carrierRef: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="lc-notes">Notes <span className="opt">optional</span></label>
            <textarea id="lc-notes" rows={2} value={header.notes} onChange={(e) => setHeader({ ...header, notes: e.target.value })} />
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Received goods</h2>
          <span className="page-sub">{chosen.length} chosen</span>
        </div>
        <div className="lc-picklist" role="group" aria-label="Goods receipts">
          {/* Those already on the draft first, so what it covers is in view; ticking
              one does not move it, so a row never jumps from under the pointer. */}
          {[...props.receipts].sort((a, b) => Number(props.chosen.includes(b.id)) - Number(props.chosen.includes(a.id))).map((r) => (
            <label key={r.id} className="lc-pick">
              <input type="checkbox" checked={chosen.includes(r.id)}
                onChange={(e) => setChosen((c) => (e.target.checked ? [...c, r.id] : c.filter((x) => x !== r.id)))} />
              <span className="lc-pick-main"><span className="m">{r.label}</span></span>
              <span className="lc-pick-meta">
                {r.meta}
                {r.earlier && <span className="lc-note"> · already carries {r.earlier} — this one adds to it</span>}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Additional charges</h2>
          <span className="page-sub">Total {fmt(total)} {props.base}</span>
        </div>
        <div className="lc-charges">
          {charges.length === 0 && <p className="empty">No charges yet. Choose a template above, or add one.</p>}
          {charges.map((c, i) => {
            const src = c.sourceJournalLineId ? sourceOf(c.sourceJournalLineId) : null;
            const foreign = !src && c.currency !== props.base;
            const manualSum = Object.values(c.manual).reduce((t, v) => t + (Number(v) || 0), 0);
            return (
              <fieldset key={c.key} className="lc-charge">
                <legend>Charge {i + 1}{typeOf(c.costTypeId) ? ` · ${typeOf(c.costTypeId)!.label}` : ""}</legend>
                <div className="row">
                  <div className="field">
                    <label htmlFor={`t${c.key}`}>Cost type</label>
                    <select id={`t${c.key}`} value={c.costTypeId} required
                      onChange={(e) => {
                        const t = typeOf(e.target.value);
                        set(c.key, { costTypeId: e.target.value, method: t?.method ?? c.method,
                          partnerId: c.partnerId || t?.partnerId || "", clearingAccountId: c.clearingAccountId || t?.accountId || "" });
                      }}>
                      <option value="">Choose…</option>
                      {props.types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`m${c.key}`}>Spread</label>
                    <select id={`m${c.key}`} value={c.method} onChange={(e) => set(c.key, { method: e.target.value as Method })}>
                      {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div className="field lc-wide">
                    <label htmlFor={`s${c.key}`}><Link2 size={13} aria-hidden="true" /> Bill already recorded <span className="opt">optional</span></label>
                    <select id={`s${c.key}`} value={c.sourceJournalLineId}
                      onChange={(e) => set(c.key, { sourceJournalLineId: e.target.value })}>
                      <option value="">None — enter the amount here</option>
                      {props.sources
                        .filter((s) => s.id === c.sourceJournalLineId || !charges.some((o) => o.key !== c.key && o.sourceJournalLineId === s.id))
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.doc_no ?? s.entry_no} · {s.entry_date} · {fmt(s.base_amount)} {props.base}
                            {s.currency !== props.base ? ` (${fmt(Math.abs(s.fc_amount))} ${s.currency})` : ""}{s.partner ? ` · ${s.partner}` : ""}
                          </option>
                        ))}
                    </select>
                    <span className="hint">A bill or payment already posted to Landed Cost Clearing. Its amount and rate are used as recorded.</span>
                  </div>
                </div>

                {src ? (
                  <p className="lc-src">
                    {fmt(src.base_amount)} {props.base}
                    {src.currency !== props.base && <> — {fmt(Math.abs(src.fc_amount))} {src.currency} at {src.exchange_rate}, {src.entry_date}</>}
                    {src.memo && <> · {src.memo}</>}
                  </p>
                ) : (
                  <div className="row">
                    <div className="field">
                      <label htmlFor={`c${c.key}`}>Currency</label>
                      <select id={`c${c.key}`} value={c.currency}
                        onChange={(e) => {
                          const fx = props.currencies.find((x) => x.code === e.target.value);
                          set(c.key, { currency: e.target.value,
                            exchangeRate: e.target.value === props.base ? "1" : fx?.rate ? String(fx.rate) : "",
                            rateDate: fx?.rateDate ?? header.docDate });
                        }}>
                        {props.currencies.map((x) => <option key={x.code} value={x.code}>{x.code}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`a${c.key}`}>Amount{foreign ? ` in ${c.currency}` : ""}</label>
                      <input id={`a${c.key}`} type="number" inputMode="decimal" min="0" step="any" value={c.amount} required
                        onChange={(e) => set(c.key, { amount: e.target.value })} />
                    </div>
                    {foreign && (
                      <>
                        <div className="field">
                          <label htmlFor={`r${c.key}`}>Rate — {props.base} per 1 {c.currency}</label>
                          <input id={`r${c.key}`} type="number" inputMode="decimal" min="0" step="any" value={c.exchangeRate} required
                            onChange={(e) => set(c.key, { exchangeRate: e.target.value })} />
                        </div>
                        <div className="field">
                          <label htmlFor={`rd${c.key}`}>Rate date</label>
                          <input id={`rd${c.key}`} type="date" value={c.rateDate} required
                            onChange={(e) => set(c.key, { rateDate: e.target.value })} />
                        </div>
                      </>
                    )}
                    <div className="field">
                      <span className="lbl">In {props.base}</span>
                      <span className="lc-base">{fmt(Math.round(baseOf(c)))}</span>
                    </div>
                  </div>
                )}

                <details className="lc-more">
                  <summary>Payee, clearing account and reference</summary>
                  <div className="row">
                    <div className="field">
                      <label htmlFor={`p${c.key}`}>Payee</label>
                      <select id={`p${c.key}`} value={c.partnerId} onChange={(e) => set(c.key, { partnerId: e.target.value })}>
                        <option value="">—</option>
                        {props.partners.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                    </div>
                    {!src && (
                      <div className="field">
                        <label htmlFor={`ac${c.key}`}>Clearing account</label>
                        <select id={`ac${c.key}`} value={c.clearingAccountId || props.clearingId}
                          onChange={(e) => set(c.key, { clearingAccountId: e.target.value })}>
                          {props.accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                        </select>
                      </div>
                    )}
                    <div className="field">
                      <label htmlFor={`d${c.key}`}>Description</label>
                      <input id={`d${c.key}`} value={c.description} onChange={(e) => set(c.key, { description: e.target.value })} />
                    </div>
                    <div className="field">
                      <label htmlFor={`f${c.key}`}>Reference</label>
                      <input id={`f${c.key}`} value={c.reference} onChange={(e) => set(c.key, { reference: e.target.value })} />
                    </div>
                  </div>
                </details>

                {c.method === "MANUAL" && (
                  <div className="lc-manual">
                    <p className="hint">
                      Give each product variant its share in {props.base}. The shares must add up to the
                      whole charge; each variant&rsquo;s share is then divided evenly among its phones.
                    </p>
                    {props.variants.length === 0 && <p className="hint">Choose receipts and save to list their variants.</p>}
                    {props.variants.map((v) => (
                      <div key={v.itemId} className="lc-manual-row">
                        <label htmlFor={`mv${c.key}-${v.itemId}`}>{v.name} <span className="m">({v.phones})</span></label>
                        <input id={`mv${c.key}-${v.itemId}`} type="number" inputMode="numeric" min="0" step="1"
                          value={c.manual[v.itemId] ?? ""}
                          onChange={(e) => set(c.key, { manual: { ...c.manual, [v.itemId]: e.target.value } })} />
                      </div>
                    ))}
                    {props.variants.length > 0 && (
                      <p className={Math.round(manualSum) === Math.round(baseOf(c)) ? "lc-sum ok" : "lc-sum"}>
                        {fmt(manualSum)} of {fmt(Math.round(baseOf(c)))} {props.base}
                        {Math.round(manualSum) === Math.round(baseOf(c)) ? " — adds up" : " — must add up to the whole charge"}
                      </p>
                    )}
                  </div>
                )}

                <button type="button" className="btn ghost tiny lc-remove"
                  onClick={() => setCharges((cs) => cs.filter((x) => x.key !== c.key))}>
                  <Trash2 size={14} aria-hidden="true" /> Remove charge
                </button>
              </fieldset>
            );
          })}
          <button type="button" className="btn ghost" onClick={() => add(blank())}>
            <Plus size={16} aria-hidden="true" /> Add charge
          </button>
        </div>
      </section>

      {state?.error && <div className="alert" role="alert">{state.error}</div>}
      {state?.ok && <div className="flash ok" role="status">{state.ok}</div>}
      <div className="lc-actions">
        <button type="submit" className="btn" disabled={saving}>{saving ? "Saving…" : "Save draft"}</button>
      </div>
    </form>
  );
}

/** One step — calculate, post, reverse, discard — with its answer shown beside it. */
export function LandedCostStep({ id, step, label, prominent, confirm, children }: {
  id: string; step: "acknowledge" | "calculate" | "post" | "reverse" | "delete";
  label: string; prominent?: boolean; confirm?: string; children?: React.ReactNode;
}) {
  const [state, act, pending] = useActionState(landedCostStepAction, null);
  return (
    <form action={act} className="lc-step"
      onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="step" value={step} />
      {children}
      <button type="submit" className={prominent ? "btn" : "btn ghost"} disabled={pending}>
        {pending ? "Working…" : label}
      </button>
      {state?.error && <span className="lc-step-msg bad" role="alert">{state.error}</span>}
      {state?.ok && <span className="lc-step-msg ok" role="status">{state.ok}</span>}
    </form>
  );
}

/** A settings form whose answer — saved, or what is wrong — shows beside its button. */
export function LcForm({ action, submitLabel, children, className }: {
  action: (prev: { error?: string; ok?: string } | null, fd: FormData) => Promise<{ error?: string; ok?: string } | null>;
  submitLabel: string; children: React.ReactNode; className?: string;
}) {
  const [state, act, pending] = useActionState(action, null);
  return (
    <form action={act} className={`form ${className ?? ""}`}>
      {children}
      <div className="actions">
        <button type="submit" className="btn" disabled={pending}>{pending ? "Saving…" : submitLabel}</button>
        {state?.error && <span className="lc-step-msg bad" role="alert">{state.error}</span>}
        {state?.ok && <span className="lc-step-msg ok" role="status">{state.ok}</span>}
      </div>
    </form>
  );
}

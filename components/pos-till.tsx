"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Search, Smartphone, X, Minus, Plus, Trash2, Gift, ChevronDown, ShoppingBag } from "lucide-react";
import { posSearchAction, posUnitsAction, posPostSale, type PosSale } from "@/lib/pos-actions";
import type { SellableItem, ScannedUnit } from "@/lib/phone";
import { money } from "@/lib/format";

type Loc = { id: string; name: string; branch: string | null };
type Opt = { id: string; name: string; code?: string };
type Account = { id: string; code: string; name: string; is_bank_account: boolean };
type Tax = { id: string; code: string; name: string; rate: number };
type Mode = "CASH" | "QR" | "CARD" | "CREDIT" | "SPLIT";

type Line = {
  key: string; itemId: string; name: string; variant: string | null; photo: string | null;
  tracksSerial: boolean; serial: string | null; qty: number; onHand: number;
  unitPrice: number; discountPct: number; taxCodeId: string; warrantyMonths: number | null;
  unitCost?: number;
  /** Given free: not charged, still leaves the shelf. The reason says why. */
  focReasonId: string | null;
};

const newKey = () => Math.random().toString(36).slice(2);
const maskImei = (s: string) => (s.length > 8 ? `${s.slice(0, 4)}•••••${s.slice(-3)}` : s);

export function PosTill(props: {
  locations: Loc[]; customers: Opt[]; salesmen: Opt[]; accounts: Account[]; taxCodes: Tax[];
  focReasons: Opt[];
  showCost: boolean; discountCeiling: number | null; defaultSalesman: string | null;
}) {
  const noTax = props.taxCodes.find((t) => t.code === "NONE")?.id ?? props.taxCodes[0]?.id ?? "";
  const cashAcct = props.accounts.find((a) => !a.is_bank_account) ?? props.accounts[0];
  const bankAccts = props.accounts.filter((a) => a.is_bank_account);
  const defaultFoc = props.focReasons.find((r) => /promo/i.test(r.name))?.id ?? props.focReasons[0]?.id ?? null;

  const [locationId, setLocationId] = useState(props.locations[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<SellableItem[]>([]);
  // Browse filters: type, model, one per option the shelf actually has.
  const [type, setType] = useState("");
  const [model, setModel] = useState("");
  const [optFilter, setOptFilter] = useState<Record<string, string>>({});
  const [inStockOnly, setInStockOnly] = useState(true);
  const [picking, setPicking] = useState<{ item: SellableItem; units: ScannedUnit[] } | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [partnerId, setPartnerId] = useState("");
  const [salesmanId, setSalesmanId] = useState(props.defaultSalesman ?? "");
  const [inclusive, setInclusive] = useState(true);
  const [mode, setMode] = useState<Mode>("CASH");
  const [bankId, setBankId] = useState(bankAccts[0]?.id ?? "");
  const [split, setSplit] = useState([{ accountId: cashAcct?.id ?? "", amount: "" }]);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string; id?: string } | null>(null);
  const [attempt, setAttempt] = useState(newKey);
  const [busy, start] = useTransition();
  const scan = useRef<HTMLInputElement>(null);

  const taxRate = (id: string) => props.taxCodes.find((t) => t.id === id)?.rate ?? 0;

  // The shelf at this location, before anything is typed.
  useEffect(() => {
    start(async () => setItems((await posSearchAction(locationId, "")).items));
  }, [locationId]);

  // ------------------------------------------------------------ browsing --
  const types = useMemo(() => [...new Set(items.map((i) => i.type).filter((t): t is string => !!t))].sort(), [items]);
  const ofType = items.filter((i) => !type || i.type === type);
  const models = useMemo(() => [...new Set(ofType.map((i) => i.model))].sort(), [ofType]);
  const ofModel = ofType.filter((i) => !model || i.model === model);
  // The option lists (Storage, Colour, SIM…) the items in view actually carry.
  const optLists = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const i of ofModel) for (const [a, v] of Object.entries(i.opts ?? {})) {
      if (!m.has(a)) m.set(a, new Set());
      m.get(a)!.add(v);
    }
    return [...m.entries()].map(([a, s]) => ({ attr: a, values: [...s].sort() }));
  }, [ofModel]);
  const shown = ofModel.filter((i) =>
    (!inStockOnly || i.on_hand > 0)
    && Object.entries(optFilter).every(([a, v]) => !v || i.opts?.[a] === v));
  const filtered = !!(type || model || Object.values(optFilter).some(Boolean));
  const clearFilters = () => { setType(""); setModel(""); setOptFilter({}); };

  // --------------------------------------------------------------- totals --
  // Indicative only: the server prices the sale and is what posts.
  const totals = useMemo(() => {
    let sub = 0, disc = 0, net = 0, tax = 0, cost = 0, freeValue = 0, freeQty = 0, units = 0;
    for (const l of lines) {
      units += l.qty;
      cost += (l.unitCost ?? 0) * l.qty;
      if (l.focReasonId) { freeValue += l.qty * l.unitPrice; freeQty += l.qty; continue; }
      const gross = l.qty * l.unitPrice;
      const amount = gross * (1 - l.discountPct / 100);
      sub += gross; disc += gross - amount;
      const r = taxRate(l.taxCodeId) / 100;
      const lineNet = inclusive ? amount / (1 + r) : amount;
      net += lineNet; tax += inclusive ? amount - lineNet : amount * r;
    }
    return { sub, disc, net, tax, total: net + tax, cost, freeValue, freeQty, units };
  }, [lines, inclusive, props.taxCodes]);

  const flash = (kind: "error" | "ok", text: string, id?: string) => setMessage({ kind, text, id });

  // ---------------------------------------------------------------- cart --
  const addUnit = (u: ScannedUnit, item?: SellableItem) => {
    if (lines.some((l) => l.serial === u.imei)) return flash("error", `${u.imei} is already on this sale.`);
    if (u.status !== "IN_STOCK") return flash("error", `${u.imei} is ${u.status.toLowerCase().replace(/_/g, " ")}.`);
    if (u.location_id !== locationId) return flash("error", `${u.imei} is at ${u.location_name}. Transfer it here first.`);
    setLines((ls) => [...ls, {
      key: newKey(), itemId: u.item_id, name: item?.model ?? u.item_name, variant: item?.variant ?? null,
      photo: item?.photo ?? null, tracksSerial: true, serial: u.imei, qty: 1, onHand: 1,
      unitPrice: item?.price ?? 0, discountPct: 0, taxCodeId: noTax,
      warrantyMonths: item?.warranty_months ?? null, unitCost: u.unit_cost, focReasonId: null,
    }]);
    setPicking(null);
    setMessage(null);
  };

  const addItem = async (item: SellableItem) => {
    if (item.tracks_serial) {
      const units = await posUnitsAction(item.id, locationId);
      setPicking({ item, units: units.filter((u) => !lines.some((l) => l.serial === u.imei)) });
      return;
    }
    setLines((ls) => {
      const same = ls.find((l) => l.itemId === item.id && !l.tracksSerial && !l.focReasonId);
      if (same) return ls.map((l) => (l === same ? { ...l, qty: Math.min(l.qty + 1, l.onHand) } : l));
      return [...ls, {
        key: newKey(), itemId: item.id, name: item.model, variant: item.variant, photo: item.photo,
        tracksSerial: false, serial: null, qty: 1, onHand: item.on_hand,
        unitPrice: item.price ?? 0, discountPct: 0, taxCodeId: noTax,
        warrantyMonths: item.warranty_months, focReasonId: null,
      }];
    });
  };

  const search = (term: string) => start(async () => {
    const r = await posSearchAction(locationId, term);
    // A scan that is an IMEI goes straight onto the sale.
    if (r.units.length === 1 && term.trim()) {
      const unit = r.units[0];
      addUnit(unit, r.items.find((i) => i.id === unit.item_id) ?? items.find((i) => i.id === unit.item_id));
      setQ("");
      return;
    }
    // A barcode naming exactly one product adds it.
    const byBarcode = r.items.filter((i) => i.barcode && i.barcode === term.trim());
    if (byBarcode.length === 1) { await addItem(byBarcode[0]); setQ(""); return; }
    setItems(r.items);
    clearFilters();
  });

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));
  const step = (l: Line, by: number) => {
    const next = l.qty + by;
    if (next <= 0) return removeLine(l.key);
    setLine(l.key, { qty: Math.min(next, Math.max(l.onHand, 1)) });
  };

  const payments = (): PosSale["payments"] => {
    const total = Math.round(totals.total * 100) / 100;
    switch (mode) {
      case "CASH": return [{ accountId: cashAcct?.id ?? "", amount: total }];
      case "QR": case "CARD": return [{ accountId: bankId, amount: total }];
      case "CREDIT": return [];
      case "SPLIT": return split.map((p) => ({ accountId: p.accountId, amount: Number(p.amount) || 0 }));
    }
  };

  const post = () => start(async () => {
    setMessage(null);
    const r = await posPostSale({
      locationId, partnerId: partnerId || null, salesmanId: salesmanId || null,
      priceIncludesTax: inclusive, memo: mode === "QR" ? "Paid by QR" : mode === "CARD" ? "Paid by card" : null,
      attempt,
      lines: lines.map((l) => ({
        itemId: l.itemId, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.focReasonId ? 0 : l.discountPct,
        taxCodeId: l.taxCodeId || null, serials: l.serial ? [l.serial] : [], warrantyMonths: l.warrantyMonths,
        focReasonId: l.focReasonId,
      })),
      payments: payments(),
    });
    if (!r.ok) return flash("error", r.error);
    flash("ok", `Sale ${r.docNo} posted`, r.id);
    setLines([]);
    setEditing(null);
    setPartnerId("");
    setMode("CASH");
    setSplit([{ accountId: cashAcct?.id ?? "", amount: "" }]);
    setAttempt(newKey());
    setItems((await posSearchAction(locationId, "")).items);
    scan.current?.focus();
  });

  const customerName = props.customers.find((c) => c.id === partnerId)?.name ?? "Walk-in customer";
  const splitPaid = split.reduce((s, p) => s + (Number(p.amount) || 0), 0);

  return (
    <div className="pos3">
      <section className="pos3-shelf" aria-label="Products">
        {message && (
          <div className={message.kind === "error" ? "alert" : "alert ok"} role="status">
            {message.text}
            {message.id && <> · <Link href={`/pos/receipt/${message.id}`} target="_blank">Print receipt</Link></>}
          </div>
        )}

        <form className="pos2-search" onSubmit={(e) => { e.preventDefault(); search(q); }}>
          <Search size={17} aria-hidden="true" />
          <input ref={scan} autoFocus value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
            placeholder="Scan IMEI or barcode, or search a product…" aria-label="Search product, barcode or IMEI" />
          {props.locations.length > 1 && (
            <select aria-label="Selling from" value={locationId}
              onChange={(e) => { setLocationId(e.target.value); setPicking(null); }}>
              {props.locations.map((l) => (
                <option key={l.id} value={l.id}>{l.branch ? `${l.branch} · ${l.name}` : l.name}</option>
              ))}
            </select>
          )}
        </form>

        <div className="pos3-filters" role="group" aria-label="Filter products">
          <select aria-label="Type" value={type} onChange={(e) => { setType(e.target.value); setModel(""); setOptFilter({}); }}>
            <option value="">All types</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select aria-label="Model" value={model} onChange={(e) => { setModel(e.target.value); setOptFilter({}); }}>
            <option value="">All models</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          {optLists.map((o) => (
            <select key={o.attr} aria-label={o.attr} value={optFilter[o.attr] ?? ""}
              onChange={(e) => setOptFilter((f) => ({ ...f, [o.attr]: e.target.value }))}>
              <option value="">Any {o.attr.toLowerCase()}</option>
              {o.values.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          ))}
          <label className="pos3-instock">
            <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} />
            In stock
          </label>
          {filtered && <button type="button" className="dt-tool" onClick={clearFilters}>Clear</button>}
        </div>

        {picking && (
          <div className="pos3-units">
            <div className="pos3-units-head">
              <strong>Which {picking.item.model}{picking.item.variant ? ` · ${picking.item.variant}` : ""}?</strong>
              <button type="button" className="dt-step" aria-label="Close" onClick={() => setPicking(null)}><X size={14} /></button>
            </div>
            {picking.units.length === 0 && <p className="page-sub">None on the shelf here.</p>}
            <div className="pos3-unit-list">
              {picking.units.map((u) => (
                <button type="button" key={u.serial_id} className="pos3-unit" onClick={() => addUnit(u, picking.item)}>
                  <span className="m">{u.imei}</span>
                  {props.showCost && <span className="subline">cost {money(u.unit_cost)}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="pos3-grid">
          {shown.map((i) => {
            const inCart = lines.filter((l) => l.itemId === i.id).reduce((s, l) => s + l.qty, 0);
            return (
              <button type="button" key={i.id} className="pos3-card" onClick={() => addItem(i)} disabled={i.on_hand <= 0}>
                {inCart > 0 && <span className="pos3-badge" aria-label={`${inCart} in cart`}>{inCart}</span>}
                <span className="pos3-img">
                  {i.photo ? <img src={i.photo} alt="" /> : <Smartphone size={26} aria-hidden="true" />}
                </span>
                <span className="pos3-name">{i.model}</span>
                <span className="pos3-sub">{i.variant ?? i.brand ?? i.code}</span>
                <span className="pos3-foot">
                  <span className="pos3-price">{i.price != null ? money(i.price) : "No price"}</span>
                  <span className={`pos3-stock${i.on_hand <= 0 ? " none" : i.on_hand <= 2 ? " low" : ""}`}>{i.on_hand} left</span>
                </span>
              </button>
            );
          })}
          {shown.length === 0 && !busy && (
            <p className="page-sub">Nothing here.{filtered || inStockOnly ? " Try clearing the filters." : ""}</p>
          )}
        </div>
      </section>

      <aside className="pos3-cart" aria-label="Current sale">
        <div className="pos3-cart-head">
          <h2><ShoppingBag size={17} aria-hidden="true" /> Cart</h2>
          <span className="subline">{totals.units} item{totals.units === 1 ? "" : "s"}</span>
        </div>
        <select aria-label="Customer" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className="pos3-customer">
          <option value="">Walk-in customer</option>
          {props.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <div className="pos3-lines">
          {lines.length === 0 && (
            <div className="pos3-empty">
              <ShoppingBag size={28} aria-hidden="true" />
              <span>Scan an IMEI or tap a product.</span>
            </div>
          )}
          {lines.map((l) => {
            const charged = l.focReasonId ? 0 : l.qty * l.unitPrice * (1 - l.discountPct / 100);
            const open = editing === l.key;
            return (
              <div className={`pos3-line${l.focReasonId ? " free" : ""}`} key={l.key}>
                <span className="pos3-line-img">
                  {l.photo ? <img src={l.photo} alt="" /> : <Smartphone size={18} aria-hidden="true" />}
                </span>
                <div className="pos3-line-main">
                  <div className="pos3-line-name">{l.name}</div>
                  <div className="pos3-line-sub">
                    {[l.variant, l.serial ? `IMEI ${maskImei(l.serial)}` : null].filter(Boolean).join(" · ")}
                  </div>
                  <div className="pos3-line-row">
                    {l.tracksSerial ? (
                      <span className="pos3-qty-one">1 unit</span>
                    ) : (
                      <span className="pos3-stepper" role="group" aria-label={`Quantity of ${l.name}`}>
                        <button type="button" aria-label="One less" onClick={() => step(l, -1)}><Minus size={13} /></button>
                        <span aria-live="polite">{l.qty}</span>
                        <button type="button" aria-label="One more" onClick={() => step(l, 1)}
                          disabled={l.qty >= l.onHand}><Plus size={13} /></button>
                      </span>
                    )}
                    <span className="pos3-line-price">
                      {l.focReasonId ? (
                        <><s>{money(l.qty * l.unitPrice)}</s> <strong className="pos3-free">FREE</strong></>
                      ) : (
                        <>
                          {l.discountPct > 0 && <s>{money(l.qty * l.unitPrice)}</s>} <strong>{money(charged)}</strong>
                        </>
                      )}
                    </span>
                  </div>
                  <div className="pos3-line-tools">
                    <button type="button" className={`pos3-tool${l.focReasonId ? " on" : ""}`}
                      disabled={props.focReasons.length === 0}
                      onClick={() => setLine(l.key, { focReasonId: l.focReasonId ? null : defaultFoc })}>
                      <Gift size={13} aria-hidden="true" /> {l.focReasonId ? "Free" : "Make free"}
                    </button>
                    <button type="button" className="pos3-tool" aria-expanded={open}
                      onClick={() => setEditing(open ? null : l.key)}>
                      Edit <ChevronDown size={13} aria-hidden="true" />
                    </button>
                    <button type="button" className="pos3-bin" aria-label={`Remove ${l.name}`} onClick={() => removeLine(l.key)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                  {l.focReasonId && (
                    <select className="pos3-reason" aria-label="Why it is free" value={l.focReasonId}
                      onChange={(e) => setLine(l.key, { focReasonId: e.target.value })}>
                      {props.focReasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  )}
                  {open && (
                    <div className="pos3-edit">
                      <label>Price<input type="number" min={0} value={l.unitPrice}
                        onChange={(e) => setLine(l.key, { unitPrice: Number(e.target.value) || 0 })} /></label>
                      {!l.focReasonId && (
                        <label>Discount %<input type="number" min={0} max={props.discountCeiling ?? 100} value={l.discountPct}
                          onChange={(e) => setLine(l.key, { discountPct: Number(e.target.value) || 0 })} /></label>
                      )}
                      <label>Tax<select value={l.taxCodeId} onChange={(e) => setLine(l.key, { taxCodeId: e.target.value })}>
                        {props.taxCodes.map((t) => <option key={t.id} value={t.id}>{t.code}</option>)}
                      </select></label>
                      <label>Warranty (mo)<input type="number" min={0} value={l.warrantyMonths ?? ""}
                        onChange={(e) => setLine(l.key, { warrantyMonths: e.target.value === "" ? null : Number(e.target.value) })} /></label>
                      {props.showCost && l.unitCost != null && (
                        <span className="subline">Margin {money(charged - l.unitCost * l.qty)}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <dl className="pos3-slip">
          <dt>Subtotal</dt><dd>{money(totals.sub)}</dd>
          {totals.disc > 0 && <><dt>Discount</dt><dd className="neg">−{money(totals.disc)}</dd></>}
          {totals.freeQty > 0 && (
            <><dt>Free items ({totals.freeQty})</dt><dd className="subline">{money(totals.freeValue)} not charged</dd></>
          )}
          {totals.tax > 0 && <><dt>Tax{inclusive ? " (incl.)" : ""}</dt><dd>{money(totals.tax)}</dd></>}
          <dt className="grand">Total</dt><dd className="grand">{money(totals.total)} <small>MMK</small></dd>
          {props.showCost && lines.length > 0 && <><dt>Gross profit</dt><dd>{money(totals.net - totals.cost)}</dd></>}
        </dl>

        <div className="paymodes" role="group" aria-label="Payment method">
          {(["CASH", "QR", "CARD", "CREDIT"] as const).map((m) => (
            <button type="button" key={m} className="paymode" aria-pressed={mode === m}
              disabled={(m === "QR" || m === "CARD") && bankAccts.length === 0}
              onClick={() => setMode(m)}>
              {m === "QR" ? "QR" : m.charAt(0) + m.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        {(mode === "QR" || mode === "CARD") && bankAccts.length > 1 && (
          <select aria-label="Into which account" value={bankId} onChange={(e) => setBankId(e.target.value)}>
            {bankAccts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        {mode === "CREDIT" && (
          <p className="hint">{partnerId ? `The total goes on ${customerName}'s account.` : "Credit needs a customer — choose one above."}</p>
        )}
        {mode === "SPLIT" && (
          <div className="pos-pay">
            {split.map((p, i) => (
              <div className="pos-pay-row" key={i}>
                <select aria-label="Account" value={p.accountId}
                  onChange={(e) => setSplit((ps) => ps.map((x, j) => (j === i ? { ...x, accountId: e.target.value } : x)))}>
                  {props.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <input type="number" min={0} aria-label="Amount" value={p.amount} className="pos-num"
                  onChange={(e) => setSplit((ps) => ps.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
              </div>
            ))}
            <button type="button" className="linkish"
              onClick={() => setSplit((ps) => [...ps, { accountId: bankAccts[0]?.id ?? cashAcct?.id ?? "", amount: "" }])}>
              Add another tender
            </button>
            <p className="hint">
              {splitPaid >= totals.total - 0.005 ? "Paid in full." : partnerId
                ? `${money(totals.total - splitPaid)} goes on account.` : "A walk-in customer pays in full."}
            </p>
          </div>
        )}
        <div className="pos3-more">
          <button type="button" className="linkish" onClick={() => setMode(mode === "SPLIT" ? "CASH" : "SPLIT")}>
            {mode === "SPLIT" ? "Single payment" : "Split payment"}
          </button>
          <details>
            <summary className="linkish">More</summary>
            <div className="pos-stack">
              <div className="field">
                <label htmlFor="pos-sm">Salesperson</label>
                <select id="pos-sm" value={salesmanId} onChange={(e) => setSalesmanId(e.target.value)}>
                  <option value="">—</option>
                  {props.salesmen.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <label className="pos-check">
                <input type="checkbox" checked={inclusive} onChange={(e) => setInclusive(e.target.checked)} />
                Prices include tax
              </label>
              {props.discountCeiling != null && (
                <p className="hint">Line discounts up to {props.discountCeiling}%. More needs a manager.</p>
              )}
            </div>
          </details>
        </div>

        <button type="button" className="complete" disabled={busy || lines.length === 0} onClick={post}>
          {busy ? "Posting…" : `Complete sale · ${money(totals.total)} MMK`}
        </button>
      </aside>
    </div>
  );
}

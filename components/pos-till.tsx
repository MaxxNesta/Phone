"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Search, Smartphone, X } from "lucide-react";
import { posSearchAction, posUnitsAction, posPostSale, type PosSale } from "@/lib/pos-actions";
import type { SellableItem, ScannedUnit } from "@/lib/phone";
import { money } from "@/lib/format";

type Loc = { id: string; name: string; branch: string | null };
type Opt = { id: string; name: string; code?: string };
type Account = { id: string; code: string; name: string; is_bank_account: boolean };
type Tax = { id: string; code: string; name: string; rate: number };
type Mode = "CASH" | "QR" | "CARD" | "CREDIT" | "SPLIT";

type Line = {
  key: string; itemId: string; name: string; variant: string | null; tracksSerial: boolean;
  serial: string | null; qty: number; unitPrice: number; discountPct: number;
  taxCodeId: string; warrantyMonths: number | null; unitCost?: number;
};

const newKey = () => Math.random().toString(36).slice(2);
const maskImei = (s: string) => (s.length > 8 ? `${s.slice(0, 4)}•••••${s.slice(-3)}` : s);

export function PosTill(props: {
  locations: Loc[]; customers: Opt[]; salesmen: Opt[]; accounts: Account[]; taxCodes: Tax[];
  showCost: boolean; discountCeiling: number | null; defaultSalesman: string | null;
}) {
  const noTax = props.taxCodes.find((t) => t.code === "NONE")?.id ?? props.taxCodes[0]?.id ?? "";
  const cashAcct = props.accounts.find((a) => !a.is_bank_account) ?? props.accounts[0];
  const bankAccts = props.accounts.filter((a) => a.is_bank_account);

  const [locationId, setLocationId] = useState(props.locations[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<SellableItem[]>([]);
  const [brand, setBrand] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ item: SellableItem; units: ScannedUnit[] } | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
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

  const brands = useMemo(
    () => [...new Set(items.map((i) => i.brand).filter((b): b is string => Boolean(b)))].sort(), [items]);
  const shown = brand === null ? items
    : brand === "__acc" ? items.filter((i) => !i.tracks_serial)
    : items.filter((i) => i.brand === brand);

  // Indicative only: the server prices the sale and is what posts.
  const totals = useMemo(() => {
    let sub = 0, disc = 0, net = 0, tax = 0, cost = 0;
    for (const l of lines) {
      const gross = l.qty * l.unitPrice;
      const amount = gross * (1 - l.discountPct / 100);
      sub += gross; disc += gross - amount;
      const r = taxRate(l.taxCodeId) / 100;
      const lineNet = inclusive ? amount / (1 + r) : amount;
      net += lineNet; tax += inclusive ? amount - lineNet : amount * r;
      cost += (l.unitCost ?? 0) * l.qty;
    }
    return { sub, disc, net, tax, total: net + tax, cost };
  }, [lines, inclusive, props.taxCodes]);

  const flash = (kind: "error" | "ok", text: string, id?: string) => setMessage({ kind, text, id });

  const addUnit = (u: ScannedUnit, item?: SellableItem) => {
    if (lines.some((l) => l.serial === u.imei)) return flash("error", `${u.imei} is already on this sale.`);
    if (u.status !== "IN_STOCK") return flash("error", `${u.imei} is ${u.status.toLowerCase().replace(/_/g, " ")}.`);
    if (u.location_id !== locationId) return flash("error", `${u.imei} is at ${u.location_name}. Transfer it here first.`);
    setLines((ls) => [...ls, {
      key: newKey(), itemId: u.item_id, name: item?.model ?? u.item_name, variant: item?.variant ?? null,
      tracksSerial: true, serial: u.imei, qty: 1, unitPrice: item?.price ?? 0, discountPct: 0,
      taxCodeId: noTax, warrantyMonths: item?.warranty_months ?? null, unitCost: u.unit_cost,
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
      const same = ls.find((l) => l.itemId === item.id && !l.tracksSerial);
      if (same) return ls.map((l) => (l === same ? { ...l, qty: l.qty + 1 } : l));
      return [...ls, {
        key: newKey(), itemId: item.id, name: item.model, variant: item.variant, tracksSerial: false,
        serial: null, qty: 1, unitPrice: item.price ?? 0, discountPct: 0, taxCodeId: noTax,
        warrantyMonths: item.warranty_months,
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
    setBrand(null);
  });

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

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
        itemId: l.itemId, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct,
        taxCodeId: l.taxCodeId || null, serials: l.serial ? [l.serial] : [], warrantyMonths: l.warrantyMonths,
      })),
      payments: payments(),
    });
    if (!r.ok) return flash("error", r.error);
    flash("ok", `Sale ${r.docNo} posted`, r.id);
    setLines([]);
    setPartnerId("");
    setMode("CASH");
    setSplit([{ accountId: cashAcct?.id ?? "", amount: "" }]);
    setAttempt(newKey());
    setItems((await posSearchAction(locationId, "")).items);
    scan.current?.focus();
  });

  const customerName = props.customers.find((c) => c.id === partnerId)?.name ?? "Walk-in Customer";
  const splitPaid = split.reduce((s, p) => s + (Number(p.amount) || 0), 0);

  return (
    <div className="pos2">
      <div className="pos2-main">
        {message && (
          <div className={message.kind === "error" ? "alert" : "alert ok"} role="status">
            {message.text}
            {message.id && <> · <Link href={`/pos/receipt/${message.id}`} target="_blank">Print receipt</Link></>}
          </div>
        )}

        <form className="pos2-search" onSubmit={(e) => { e.preventDefault(); search(q); }}>
          <Search size={18} aria-hidden="true" />
          <input ref={scan} autoFocus value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
            placeholder="Search product, barcode or IMEI…" aria-label="Search product, barcode or IMEI" />
          {props.locations.length > 1 && (
            <select aria-label="Selling from" value={locationId}
              onChange={(e) => { setLocationId(e.target.value); setPicking(null); }}>
              {props.locations.map((l) => (
                <option key={l.id} value={l.id}>{l.branch ? `${l.branch} · ${l.name}` : l.name}</option>
              ))}
            </select>
          )}
        </form>

        <div className="chips" role="group" aria-label="Filter by brand">
          <button type="button" className="chip" aria-pressed={brand === null} onClick={() => setBrand(null)}>All</button>
          {brands.map((b) => (
            <button type="button" key={b} className="chip" aria-pressed={brand === b} onClick={() => setBrand(b)}>{b}</button>
          ))}
          <button type="button" className="chip" aria-pressed={brand === "__acc"} onClick={() => setBrand("__acc")}>Accessories</button>
        </div>

        {picking && (
          <div className="unitpick">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Choose the handset · {picking.item.model}{picking.item.variant ? ` ${picking.item.variant}` : ""}</strong>
              <button type="button" className="linkish" onClick={() => setPicking(null)}>Close</button>
            </div>
            {picking.units.length === 0 && <p className="page-sub">None on the shelf here.</p>}
            <ul>
              {picking.units.map((u) => (
                <li key={u.serial_id}>
                  <button type="button" onClick={() => addUnit(u, picking.item)}>
                    <span className="m">{u.imei}</span>
                    {props.showCost && <div className="saleline-sub">cost {money(u.unit_cost)}</div>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="pcards">
          {shown.map((i) => (
            <button type="button" key={i.id} className="pcard" onClick={() => addItem(i)} disabled={i.on_hand <= 0}>
              <span className="pcard-img">
                {i.photo ? <img src={i.photo} alt="" /> : <Smartphone size={34} aria-hidden="true" />}
              </span>
              <span className="pcard-name">{i.model}</span>
              <span className="pcard-sub">{i.variant ?? i.brand ?? i.code}</span>
              <span className="pcard-price">{i.price != null ? `${money(i.price)} MMK` : "No price set"}</span>
              <span className={`pcard-stock${i.on_hand <= 0 ? " none" : ""}`}>
                {i.on_hand} unit{i.on_hand === 1 ? "" : "s"}
              </span>
            </button>
          ))}
          {shown.length === 0 && !busy && <p className="page-sub">Nothing found here.</p>}
        </div>
      </div>

      <aside className="salepanel" aria-label="Current sale">
        <div>
          <h2>Current Sale</h2>
          <div className="saleline-sub">{customerName}</div>
        </div>
        <div className="addcust">
          <select aria-label="Customer" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
            <option value="">+ Select customer (walk-in)</option>
            {props.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div>
          {lines.length === 0 && <p className="page-sub">Scan an IMEI or tap a product.</p>}
          {lines.map((l) => {
            const line = l.qty * l.unitPrice * (1 - l.discountPct / 100);
            return (
              <div className="saleline" key={l.key}>
                <strong>{l.name}</strong>
                <span className="num">{money(line)}</span>
                <span className="saleline-sub">
                  {[l.variant, l.serial ? `IMEI ${maskImei(l.serial)}` : `Qty ${l.qty}`].filter(Boolean).join(" · ")}
                </span>
                <button type="button" className="linkish" aria-label={`Remove ${l.name}`}
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><X size={14} /></button>
                <div className="saleline-edit">
                  {!l.tracksSerial && (
                    <label>Qty <input type="number" min={1} className="sm" value={l.qty}
                      onChange={(e) => setLine(l.key, { qty: Math.max(1, Number(e.target.value) || 1) })} /></label>
                  )}
                  <label>Price <input type="number" min={0} value={l.unitPrice}
                    onChange={(e) => setLine(l.key, { unitPrice: Number(e.target.value) || 0 })} /></label>
                  <label>Disc% <input type="number" min={0} max={props.discountCeiling ?? 100} className="sm"
                    value={l.discountPct} onChange={(e) => setLine(l.key, { discountPct: Number(e.target.value) || 0 })} /></label>
                  <select aria-label="Tax" value={l.taxCodeId} onChange={(e) => setLine(l.key, { taxCodeId: e.target.value })}>
                    {props.taxCodes.map((t) => <option key={t.id} value={t.id}>{t.code}</option>)}
                  </select>
                  <label>Warranty <input type="number" min={0} className="sm" value={l.warrantyMonths ?? ""}
                    placeholder="mo" onChange={(e) => setLine(l.key, {
                      warrantyMonths: e.target.value === "" ? null : Number(e.target.value) })} /></label>
                  {props.showCost && l.unitCost != null && (
                    <span>margin {money(line - l.unitCost * l.qty)}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <dl className="pos-totals">
          <dt>Subtotal</dt><dd className="num">{money(totals.sub)}</dd>
          {totals.disc > 0 && <><dt>Discount</dt><dd className="num">-{money(totals.disc)}</dd></>}
          {totals.tax > 0 && <><dt>Tax{inclusive ? " (included)" : ""}</dt><dd className="num">{money(totals.tax)}</dd></>}
          <dt className="pos-grand">Total</dt><dd className="num pos-grand">{money(totals.total)}</dd>
          {props.showCost && lines.length > 0 && <><dt>Gross profit</dt><dd className="num">{money(totals.net - totals.cost)}</dd></>}
        </dl>

        <div>
          <strong>Payment</strong>
          <div className="paymodes" role="group" aria-label="Payment method" style={{ marginTop: "0.5rem" }}>
            {(["CASH", "QR", "CARD", "CREDIT"] as const).map((m) => (
              <button type="button" key={m} className="paymode" aria-pressed={mode === m}
                disabled={(m === "QR" || m === "CARD") && bankAccts.length === 0}
                onClick={() => setMode(m)}>
                {m === "QR" ? "QR" : m.charAt(0) + m.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          {(mode === "QR" || mode === "CARD") && bankAccts.length > 1 && (
            <select aria-label="Into which account" value={bankId} onChange={(e) => setBankId(e.target.value)} style={{ marginTop: "0.5rem", width: "100%" }}>
              {bankAccts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          {mode === "CREDIT" && (
            <p className="hint">{partnerId ? "The whole total goes on the customer's account." : "Credit needs a customer — choose one above."}</p>
          )}
          {mode === "SPLIT" && (
            <div className="pos-pay" style={{ marginTop: "0.5rem" }}>
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
          <button type="button" className="linkish" style={{ marginTop: "0.5rem" }}
            onClick={() => setMode(mode === "SPLIT" ? "CASH" : "SPLIT")}>
            {mode === "SPLIT" ? "Single payment" : "Split payment"}
          </button>
        </div>

        <details>
          <summary className="saleline-sub">More: salesperson, tax-inclusive prices</summary>
          <div className="pos-stack" style={{ marginTop: "0.5rem" }}>
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

        <button type="button" className="complete" disabled={busy || lines.length === 0} onClick={post}>
          {busy ? "Posting…" : `Complete Sale · ${money(totals.total)} MMK`}
        </button>
      </aside>
    </div>
  );
}

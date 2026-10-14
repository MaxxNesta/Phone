"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  ScanLine, Smartphone, X, Minus, Plus, Trash2, Gift, ChevronDown, ShoppingCart, SlidersHorizontal,
  Store, Banknote, QrCode, CreditCard, HandCoins, TriangleAlert,
} from "lucide-react";
import { posSearchAction, posUnitsAction, posPostSale, posReceiptAction, type PosSale } from "@/lib/pos-actions";
import type { ReceiptView } from "@/lib/receipt";
import { PosSaleDone } from "./pos-sale-done";
import { PosFilters } from "./pos-filters";
import type { SellableItem, ScannedUnit } from "@/lib/phone";
import { money } from "@/lib/format";
import { priceLines, type VolumeBand } from "@/lib/discount";
import {
  computeFacets, filterItems, reconcile, emptySelection, clearFilters, cardState, SHELF_LIMIT,
  type Selection,
} from "@/lib/pos-facets";

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
  /** For a quantity discount band scoped to a category. */
  itemGroupId: string | null;
  /** Given free: not charged, still leaves the shelf. The reason says why. */
  focReasonId: string | null;
};

const newKey = () => Math.random().toString(36).slice(2);
const maskImei = (s: string) => (s.length > 8 ? `${s.slice(0, 4)}•••••${s.slice(-3)}` : s);
/** Cards drawn at a time: a shelf of thousands is not thousands of nodes. */
const PAGE = 30;

export function PosTill(props: {
  locations: Loc[]; customers: Opt[]; salesmen: Opt[]; accounts: Account[]; taxCodes: Tax[];
  focReasons: Opt[];
  /** Discount bands in force today, the ones the server will apply. */
  volumeDiscounts: VolumeBand[];
  showCost: boolean; discountCeiling: number | null; defaultSalesman: string | null;
}) {
  const noTax = props.taxCodes.find((t) => t.code === "NONE")?.id ?? props.taxCodes[0]?.id ?? "";
  const cashAcct = props.accounts.find((a) => !a.is_bank_account) ?? props.accounts[0];
  const bankAccts = props.accounts.filter((a) => a.is_bank_account);
  const defaultFoc = props.focReasons.find((r) => /promo/i.test(r.name))?.id ?? props.focReasons[0]?.id ?? null;

  const [locationId, setLocationId] = useState(props.locations[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<SellableItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Browse filters: the category, and whatever its variants offer.
  const [sel, setSel] = useState<Selection>(emptySelection);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [shownCount, setShownCount] = useState(PAGE);
  const [picking, setPicking] = useState<{ item: SellableItem; units: ScannedUnit[] } | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [partnerId, setPartnerId] = useState("");
  const [salesmanId, setSalesmanId] = useState(props.defaultSalesman ?? "");
  const [inclusive, setInclusive] = useState(true);
  const [mode, setMode] = useState<Mode>("CASH");
  const [bankId, setBankId] = useState(bankAccts[0]?.id ?? "");
  const [received, setReceived] = useState("");
  const [split, setSplit] = useState([{ accountId: cashAcct?.id ?? "", amount: "" }]);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string; id?: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  // The sale just posted, with its receipt, while the popup is open.
  const [done, setDone] = useState<{ view: ReceiptView; logoUrl: string | null } | null>(null);
  const [attempt, setAttempt] = useState(newKey);
  const [busy, start] = useTransition();
  // True only while a sale is being posted (busy is also true while the shelf loads).
  const [saving, setSaving] = useState(false);
  const scan = useRef<HTMLInputElement>(null);
  // Set the instant Complete sale is pressed, before React has re-rendered
  // with the button disabled: a second click in that gap must not post again.
  const posting = useRef(false);
  const searched = useRef(false);

  const taxRate = (id: string) => props.taxCodes.find((t) => t.id === id)?.rate ?? 0;

  // The whole shelf at this location, once: filtering never asks the server again.
  const loadShelf = async () => {
    const r = await posSearchAction(locationId, "");
    setItems(r.items);
    setLoaded(true);
    searched.current = false;
  };
  useEffect(() => {
    setLoaded(false);
    start(async () => { await loadShelf(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  // A scanner types where the cursor is: if the cashier has clicked away from
  // the search box, the first character brings them back to it.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable]") || t.closest("[role=dialog]"))) return;
      scan.current?.focus();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);

  // ------------------------------------------------------------ browsing --
  const eff = useMemo(() => ({ ...sel, q }), [sel, q]);
  const facets = useMemo(() => computeFacets(items, eff), [items, eff]);
  const shown = useMemo(() => filterItems(items, eff), [items, eff]);
  const truncated = items.length >= SHELF_LIMIT;
  // The chosen category stays on the bar even when nothing in it matches now.
  const pills = sel.type && !facets.types.some((t) => t.type === sel.type)
    ? [...facets.types, { type: sel.type, count: 0 }] : facets.types;

  const pickType = (type: string) => {
    setSel((s) => reconcile(items, { ...s, type }));
    setShownCount(PAGE);
  };
  const setFilters = (s: Selection) => { setSel(s); setShownCount(PAGE); };

  // --------------------------------------------------------------- totals --
  // Priced with the same function and bands the server posts with, so the
  // amount taken at the counter is the amount the invoice asks for — a
  // volume discount the till did not know about would overcharge the cash.
  const totals = useMemo(() => {
    let sub = 0, disc = 0, net = 0, tax = 0, cost = 0, freeValue = 0, freeQty = 0, units = 0;
    const charged = lines.filter((l) => !l.focReasonId);
    const priced = priceLines(charged.map((l) => ({
      itemId: l.itemId, itemGroupId: l.itemGroupId, qty: l.qty, baseQty: l.qty,
      unitPrice: l.unitPrice, discountPct: l.discountPct, discountAmount: null,
    })), props.volumeDiscounts, 0);
    let volume = 0;
    const earned = new Set<string>();
    for (const l of lines) {
      units += l.qty;
      cost += (l.unitCost ?? 0) * l.qty;
      if (l.focReasonId) { freeValue += l.qty * l.unitPrice; freeQty += l.qty; }
    }
    charged.forEach((l, i) => {
      const p = priced.lines[i];
      sub += p.gross; disc += p.itemDiscountAmount;
      volume += p.volumeDiscountAmount + p.invoiceDiscountAmount;
      if (p.volumeDiscountName) earned.add(`${p.volumeDiscountName} ${p.volumeDiscountPct}%`);
      const r = taxRate(l.taxCodeId) / 100;
      const lineNet = inclusive ? p.net / (1 + r) : p.net;
      net += lineNet; tax += inclusive ? p.net - lineNet : p.net * r;
    });
    if (priced.invoiceBand) earned.add(`${priced.invoiceBand.name} ${Number(priced.invoiceBand.discount_pct)}%`);
    return { sub, disc, volume, earned: [...earned].join(", "), net, tax, total: net + tax,
             cost, freeValue, freeQty, units };
  }, [lines, inclusive, props.taxCodes, props.volumeDiscounts]);

  const flash = (kind: "error" | "ok", text: string, id?: string) => setMessage({ kind, text, id });

  // ---------------------------------------------------------------- cart --
  const addUnit = (u: ScannedUnit, item?: SellableItem) => {
    if (lines.some((l) => l.serial === u.imei)) return flash("error", `${u.imei} is already on this sale.`);
    if (u.status !== "IN_STOCK") return flash("error", `${u.imei} is ${u.status.toLowerCase().replace(/_/g, " ")}.`);
    if (u.location_id !== locationId) return flash("error", `${u.imei} is at ${u.location_name}. Transfer it here first.`);
    setLines((ls) => [...ls, {
      key: newKey(), itemId: u.item_id, name: item?.model ?? u.item_name, variant: item?.variant ?? null,
      photo: item?.photo ?? null, tracksSerial: true, serial: u.imei, qty: 1, onHand: 1,
      unitPrice: item?.price ?? 0, discountPct: 0, taxCodeId: noTax, itemGroupId: item?.item_group_id ?? null,
      warrantyMonths: item?.warranty_months ?? null, unitCost: u.unit_cost, focReasonId: null,
    }]);
    setPicking(null);
    setMessage(null);
    scan.current?.focus();
  };

  const addItem = async (item: SellableItem) => {
    if (item.tracks_serial) {
      const units = (await posUnitsAction(item.id, locationId)).filter((u) => !lines.some((l) => l.serial === u.imei));
      // One unit on the shelf is the unit: no list to choose from.
      if (units.length === 1) return addUnit(units[0], item);
      setPicking({ item, units });
      return;
    }
    setLines((ls) => {
      const same = ls.find((l) => l.itemId === item.id && !l.tracksSerial && !l.focReasonId);
      if (same) return ls.map((l) => (l === same ? { ...l, qty: Math.min(l.qty + 1, l.onHand) } : l));
      return [...ls, {
        key: newKey(), itemId: item.id, name: item.model, variant: item.variant, photo: item.photo,
        tracksSerial: false, serial: null, qty: 1, onHand: item.on_hand,
        unitPrice: item.price ?? 0, discountPct: 0, taxCodeId: noTax, itemGroupId: item.item_group_id,
        warrantyMonths: item.warranty_months, focReasonId: null,
      }];
    });
    setMessage(null);
  };

  // Enter: an exact IMEI or barcode goes straight onto the sale, whatever
  // filters are on. Anything else is just words, which already narrow the
  // shelf as they are typed — unless the shelf was too big to load whole.
  const search = (term: string) => start(async () => {
    const t = term.trim();
    if (!t) return;
    const r = await posSearchAction(locationId, t);
    if (r.units.length === 1) {
      const unit = r.units[0];
      addUnit(unit, r.items.find((i) => i.id === unit.item_id) ?? items.find((i) => i.id === unit.item_id));
      setQ("");
      return;
    }
    if (r.units.length === 0 && /^\d{14,16}$/.test(t)) {
      flash("error", `No unit found with IMEI ${t}.`);
      return;
    }
    // A barcode naming exactly one product adds it.
    const byBarcode = r.items.filter((i) => i.barcode && i.barcode === t);
    if (byBarcode.length === 1) { await addItem(byBarcode[0]); setQ(""); return; }
    if (truncated) { setItems(r.items); searched.current = true; }
  });

  const typed = (v: string) => {
    setQ(v);
    setShownCount(PAGE);
    // Words cleared after a server search of a big shelf: the whole shelf again.
    if (!v && searched.current) start(async () => { await loadShelf(); });
  };

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));
  const step = (l: Line, by: number) => {
    const next = l.qty + by;
    if (next <= 0) return removeLine(l.key);
    setLine(l.key, { qty: Math.min(next, Math.max(l.onHand, 1)) });
  };
  const clearCart = () => {
    if (!confirmClear) { setConfirmClear(true); window.setTimeout(() => setConfirmClear(false), 3500); return; }
    setLines([]); setEditing(null); setOpen(new Set()); setConfirmClear(false); setMessage(null);
    scan.current?.focus();
  };

  const chargedOf = (l: Line) => (l.focReasonId ? 0 : l.qty * l.unitPrice * (1 - l.discountPct / 100));
  const groups = useMemo(() => {
    const m = new Map<string, Line[]>();
    for (const l of lines) {
      const k = `${l.itemId}:${l.focReasonId ? "free" : "paid"}`;
      m.set(k, [...(m.get(k) ?? []), l]);
    }
    return [...m.entries()].map(([key, ls]) => ({ key, lines: ls }));
  }, [lines]);

  const payments = (): PosSale["payments"] => {
    const total = Math.round(totals.total * 100) / 100;
    switch (mode) {
      case "CASH": return [{ accountId: cashAcct?.id ?? "", amount: total }];
      case "QR": case "CARD": return [{ accountId: bankId, amount: total }];
      case "CREDIT": return [];
      case "SPLIT": return split.map((p) => ({ accountId: p.accountId, amount: Number(p.amount) || 0 }));
    }
  };

  const customerName = props.customers.find((c) => c.id === partnerId)?.name ?? "Walk-in customer";
  const splitPaid = split.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const receivedNum = Number(received) || 0;
  const change = mode === "CASH" && receivedNum > totals.total + 0.005 ? receivedNum - totals.total : 0;

  // What stops Complete sale, said in words — each is a check the server also
  // makes; the till says it first.
  const issues = useMemo(() => {
    const out: string[] = [];
    if (lines.length === 0) return out;
    const unpriced = lines.filter((l) => !l.focReasonId && !(l.unitPrice > 0));
    if (unpriced.length > 0) {
      out.push(`Set a price for ${[...new Set(unpriced.map((l) => l.name))].join(", ")}, or give it free.`);
    }
    if (mode === "CREDIT" && !partnerId) out.push("Credit needs a customer — choose one above.");
    if (mode === "SPLIT" && !partnerId && splitPaid < totals.total - 0.005) out.push("A walk-in customer pays in full.");
    if (mode === "CASH" && receivedNum > 0 && receivedNum < totals.total - 0.005) {
      out.push(`Cash received is ${money(totals.total - receivedNum)} short.`);
    }
    return out;
  }, [lines, mode, partnerId, splitPaid, receivedNum, totals.total]);

  const post = () => {
    if (posting.current || issues.length > 0 || lines.length === 0) return;
    posting.current = true;
    setSaving(true);
    start(async () => {
      try {
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
        // The popup is the confirmation. If the receipt cannot be read back the
        // sale still stands, so fall back to the line at the top rather than say nothing.
        const receipt = await posReceiptAction(r.id).catch(() => null);
        // The template may say not to open the sheet: the line at the top, with
        // its print link, is the confirmation then.
        if (receipt && receipt.view.config.general.showAfterSale) setDone(receipt);
        else flash("ok", `Sale ${r.docNo} posted`, r.id);
        setLines([]);
        setEditing(null);
        setOpen(new Set());
        setPartnerId("");
        setMode("CASH");
        setReceived("");
        setSplit([{ accountId: cashAcct?.id ?? "", amount: "" }]);
        setAttempt(newKey());
        await loadShelf();
        scan.current?.focus();
      } finally {
        posting.current = false;
        setSaving(false);
      }
    });
  };

  const closeDone = () => { setDone(null); scan.current?.focus(); };
  const here = props.locations.find((l) => l.id === locationId) ?? props.locations[0];

  // ------------------------------------------------------------ rendering --
  const renderLine = (l: Line, nested = false) => {
    const charged = chargedOf(l);
    const isOpen = editing === l.key;
    const noPrice = !l.focReasonId && !(l.unitPrice > 0);
    return (
      <div className={`pos3-line${l.focReasonId ? " free" : ""}${nested ? " nested" : ""}`} key={l.key}>
        {!nested && (
          <span className="pos3-line-img">
            {l.photo ? <img src={l.photo} alt="" /> : <Smartphone size={18} aria-hidden="true" />}
          </span>
        )}
        <div className="pos3-line-main">
          <div className="pos3-line-top">
            <div>
              {!nested && <div className="pos3-line-name">{l.name}</div>}
              <div className="pos3-line-sub">
                {nested ? (l.serial ? <>IMEI <span className="m">{l.serial}</span></> : "") :
                  [l.variant, l.serial ? `IMEI ${maskImei(l.serial)}` : null].filter(Boolean).join(" · ")}
              </div>
            </div>
            <button type="button" className="pos3-bin" aria-label={`Remove ${l.name}${l.serial ? ` ${l.serial}` : ""}`}
              onClick={() => removeLine(l.key)}><Trash2 size={15} /></button>
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
              ) : noPrice ? (
                <strong className="pos3-nopr">No price</strong>
              ) : (
                <>{l.discountPct > 0 && <s>{money(l.qty * l.unitPrice)}</s>} <strong>{money(charged)}</strong></>
              )}
            </span>
          </div>
          <div className="pos3-line-tools">
            <button type="button" className={`pos3-tool${l.focReasonId ? " on" : ""}`}
              disabled={props.focReasons.length === 0} aria-pressed={!!l.focReasonId}
              onClick={() => setLine(l.key, { focReasonId: l.focReasonId ? null : defaultFoc })}>
              <Gift size={13} aria-hidden="true" /> {l.focReasonId ? "Free" : "Make free"}
            </button>
            <button type="button" className="pos3-tool" aria-expanded={isOpen}
              onClick={() => setEditing(isOpen ? null : l.key)}>
              {noPrice ? "Set price" : "Edit"} <ChevronDown size={13} aria-hidden="true" />
            </button>
          </div>
          {l.focReasonId && (
            <select className="pos3-reason" aria-label="Why it is free" value={l.focReasonId}
              onChange={(e) => setLine(l.key, { focReasonId: e.target.value })}>
              {props.focReasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          {isOpen && (
            <div className="pos3-edit">
              {l.serial && <span className="pos3-edit-imei">IMEI <span className="m">{l.serial}</span></span>}
              <label>Price<input type="number" min={0} value={l.unitPrice} autoFocus={noPrice}
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
                <span className="subline pos3-edit-wide">Margin {money(charged - l.unitCost * l.qty)}</span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const roundUps = useMemo(() => {
    const t = Math.ceil(totals.total);
    if (t <= 0) return [] as number[];
    const ups = [10_000, 50_000, 100_000].map((s) => Math.ceil(t / s) * s);
    return [...new Set([t, ...ups])].slice(0, 4);
  }, [totals.total]);

  return (
    <div className="pos3-page">
      {done && <PosSaleDone view={done.view} logoUrl={done.logoUrl} onClose={closeDone} />}

      <div className="pos3-top">
        <div className="page-head hero">
          <h1>POS / Counter Sale</h1>
          <p className="page-sub">Fast checkout · exact IMEI tracking · receipt-ready</p>
        </div>
        {/* Where the sale is made: chosen when there are several, shown when
            a cashier has only their own branch, so the till always says where. */}
        <label className="pos3-branch">
          <Store size={20} aria-hidden="true" />
          <span className="pos3-branch-text">
            <b>{here?.branch ?? here?.name}</b>
            <small>{here?.branch ? here.name : "Selling from"}</small>
          </span>
          {props.locations.length > 1 && (
            <>
              <ChevronDown size={16} aria-hidden="true" />
              <select aria-label="Selling from" value={locationId}
                onChange={(e) => { setLocationId(e.target.value); setPicking(null); }}>
                {props.locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.branch ? `${l.branch} · ${l.name}` : l.name}</option>
                ))}
              </select>
            </>
          )}
        </label>
      </div>

      <div className="pos3">
        <section className="pos3-shelf" aria-label="Products">
          {message && (
            <div className={message.kind === "error" ? "alert" : "alert ok"} role={message.kind === "error" ? "alert" : "status"}>
              {message.text}
              {message.id && <> · <Link href={`/pos/receipt/${message.id}`} target="_blank">Print receipt</Link></>}
            </div>
          )}

          <form className="pos3-search" onSubmit={(e) => { e.preventDefault(); search(q); }} role="search">
            <ScanLine size={22} aria-hidden="true" />
            <input ref={scan} autoFocus value={q} onChange={(e) => typed(e.target.value)} autoComplete="off"
              inputMode="search" enterKeyHint="search"
              placeholder="Scan IMEI or barcode, or search product (e.g. iPhone 16, 256GB)…"
              aria-label="Search product, SKU, barcode or IMEI" />
            {q && (
              <button type="button" className="pos3-x" aria-label="Clear search" onClick={() => { typed(""); scan.current?.focus(); }}>
                <X size={16} />
              </button>
            )}
          </form>

          <div className="pos3-bar">
            <div className="pos3-pills" role="group" aria-label="Category">
              <button type="button" className="pos3-pill" aria-pressed={!sel.type} onClick={() => pickType("")}>All types</button>
              {pills.map((t) => (
                <button type="button" key={t.type} className="pos3-pill" aria-pressed={sel.type === t.type}
                  onClick={() => pickType(t.type)}>{t.type}</button>
              ))}
            </div>
            <div className="pos3-bar-right">
              <button type="button" className="pos3-filter-btn" aria-expanded={filtersOpen} aria-controls="pos3-filters"
                onClick={() => setFiltersOpen((o) => !o)}>
                <SlidersHorizontal size={16} aria-hidden="true" /> Filters
                {facets.active > 0 && <span className="pf-count">{facets.active}</span>}
              </button>
              <label className="pos3-instock">
                <input type="checkbox" checked={sel.inStockOnly} onChange={(e) => setFilters({ ...sel, inStockOnly: e.target.checked })} />
                In stock only
              </label>
            </div>
          </div>

          {picking && (
            <div className="pos3-units" role="group" aria-label="Choose the exact unit">
              <div className="pos3-units-head">
                <strong>Which {picking.item.model}{picking.item.variant ? ` · ${picking.item.variant}` : ""}?</strong>
                <button type="button" className="dt-step" aria-label="Close" onClick={() => setPicking(null)}><X size={14} /></button>
              </div>
              {picking.units.length === 0 && <p className="page-sub">None left on the shelf here.</p>}
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

          <div className={`pos3-work${filtersOpen ? " with-filters" : ""}`}>
            {filtersOpen && (
              <div id="pos3-filters" className="pos3-filter-col">
                <PosFilters facets={facets} sel={sel} total={shown.length} onChange={setFilters} onType={pickType} />
              </div>
            )}

            <div className="pos3-results">
              <p className="pos3-count" aria-live="polite">
                {loaded ? `${shown.length} product${shown.length === 1 ? "" : "s"}` : "Loading…"}
                {truncated && " · showing the first " + SHELF_LIMIT.toLocaleString() + " — search to narrow"}
              </p>
              <div className="pos3-grid">
                {shown.slice(0, shownCount).map((i) => {
                  const inCart = lines.filter((l) => l.itemId === i.id).reduce((s, l) => s + l.qty, 0);
                  const st = cardState(i);
                  return (
                    <article key={i.id} className={`pos3-card ${st}`}>
                      <span className="pos3-img">
                        {i.photo ? <img src={i.photo} alt="" loading="lazy" decoding="async" /> : <Smartphone size={28} aria-hidden="true" />}
                        {inCart > 0 && <span className="pos3-badge" aria-label={`${inCart} in cart`}>{inCart}</span>}
                      </span>
                      <div className="pos3-info">
                        <h3 className="pos3-name">{i.model}</h3>
                        <p className="pos3-sub">{i.variant ?? i.brand ?? i.code}</p>
                        {i.price != null && i.price > 0
                          ? <p className="pos3-price">{money(i.price)} <small>MMK</small></p>
                          : <p className="pos3-price none"><TriangleAlert size={13} aria-hidden="true" /> No price set</p>}
                        <span className={`pos3-stock ${st}`}>{st === "out" ? "Out of stock" : `${i.on_hand} left`}</span>
                      </div>
                      <button type="button" className="pos3-add" onClick={() => addItem(i)} disabled={st === "out"}
                        aria-label={`Add ${i.model}${i.variant ? ` ${i.variant}` : ""}`}>
                        <ShoppingCart size={15} aria-hidden="true" /> {st === "out" ? "Unavailable" : i.tracks_serial ? "Select unit" : "Add"}
                      </button>
                    </article>
                  );
                })}
              </div>
              {loaded && shown.length === 0 && (
                <div className="pos3-nothing">
                  <p>{items.length === 0 ? "Nothing is stocked here yet." : "No products match."}</p>
                  {items.length > 0 && (
                    <button type="button" className="pos3-link" onClick={() => { setQ(""); setSel(clearFilters({ ...emptySelection(), inStockOnly: false })); }}>
                      Clear search and filters
                    </button>
                  )}
                </div>
              )}
              {shown.length > shownCount && (
                <button type="button" className="pos3-showmore" onClick={() => setShownCount((n) => n + PAGE)}>
                  Show more ({shown.length - shownCount} more)
                </button>
              )}
            </div>
          </div>
        </section>

        <aside className="pos3-cart" id="pos-cart" aria-label="Current sale">
          <div className="pos3-cart-head">
            <h2><ShoppingCart size={18} aria-hidden="true" /> Cart</h2>
            <span className="subline">{totals.units} item{totals.units === 1 ? "" : "s"}</span>
            {lines.length > 0 && (
              <button type="button" className={`pos3-clear${confirmClear ? " sure" : ""}`} onClick={clearCart}>
                {confirmClear ? "Clear all?" : "Clear"}
              </button>
            )}
          </div>
          <select aria-label="Customer" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className="pos3-customer">
            <option value="">Walk-in customer</option>
            {props.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <div className="pos3-lines">
            {lines.length === 0 && (
              <div className="pos3-empty">
                <ShoppingCart size={28} aria-hidden="true" />
                <span>Scan an IMEI or add a product.</span>
              </div>
            )}
            {groups.map((g) => {
              if (g.lines.length === 1) return renderLine(g.lines[0]);
              const first = g.lines[0];
              const isOpen = open.has(g.key);
              const total = g.lines.reduce((s, l) => s + chargedOf(l), 0);
              const qty = g.lines.reduce((s, l) => s + l.qty, 0);
              const missing = g.lines.some((l) => !l.focReasonId && !(l.unitPrice > 0));
              return (
                <div className={`pos3-group${first.focReasonId ? " free" : ""}`} key={g.key}>
                  <button type="button" className="pos3-group-head" aria-expanded={isOpen}
                    onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}>
                    <span className="pos3-line-img">
                      {first.photo ? <img src={first.photo} alt="" /> : <Smartphone size={18} aria-hidden="true" />}
                    </span>
                    <span className="pos3-group-text">
                      <span className="pos3-line-name">{first.name} <span className="pos3-x2">× {qty}</span></span>
                      <span className="pos3-line-sub">
                        {[first.variant, first.focReasonId ? "Complimentary" : null].filter(Boolean).join(" · ")}
                        {" · "}{isOpen ? "Hide" : "Show"} IMEIs
                      </span>
                    </span>
                    <span className="pos3-group-total">
                      {first.focReasonId ? <strong className="pos3-free">FREE</strong>
                        : missing ? <strong className="pos3-nopr">No price</strong> : <strong>{money(total)}</strong>}
                      <ChevronDown size={15} aria-hidden="true" className={isOpen ? "up" : ""} />
                    </span>
                  </button>
                  {isOpen && <div className="pos3-group-body">{g.lines.map((l) => renderLine(l, true))}</div>}
                </div>
              );
            })}
          </div>

          <dl className="pos3-slip">
            <dt>Subtotal ({totals.units} item{totals.units === 1 ? "" : "s"})</dt><dd>{money(totals.sub)} <small>MMK</small></dd>
            {totals.disc > 0 && <><dt>Discount</dt><dd className="neg">−{money(totals.disc)}</dd></>}
            {totals.volume > 0 && (
              <><dt title={totals.earned}>Volume discount <small>{totals.earned}</small></dt>
                <dd className="neg">−{money(totals.volume)}</dd></>
            )}
            {totals.freeQty > 0 && (
              <><dt>Free items ({totals.freeQty})</dt><dd className="subline">{money(totals.freeValue)} not charged</dd></>
            )}
            {totals.tax > 0 && <><dt>Tax{inclusive ? " (incl.)" : ""}</dt><dd>{money(totals.tax)}</dd></>}
            <dt className="grand">Total</dt><dd className="grand">{money(totals.total)} <small>MMK</small></dd>
            {props.showCost && lines.length > 0 && <><dt>Gross profit</dt><dd>{money(totals.net - totals.cost)}</dd></>}
          </dl>

          <div className="paymodes" role="group" aria-label="Payment method">
            {([["CASH", "Cash", Banknote], ["QR", "QR", QrCode], ["CARD", "Card", CreditCard], ["CREDIT", "Credit", HandCoins]] as const).map(([m, label, Icon]) => (
              <button type="button" key={m} className="paymode" aria-pressed={mode === m}
                disabled={(m === "QR" || m === "CARD") && bankAccts.length === 0}
                onClick={() => setMode(m)}>
                <Icon size={16} aria-hidden="true" /> {label}
              </button>
            ))}
          </div>
          {mode === "CASH" && (
            <div className="pos3-cash">
              <label htmlFor="pos-received">Cash received</label>
              <div className="pos3-money">
                <input id="pos-received" type="number" inputMode="decimal" min={0} value={received}
                  placeholder={totals.total > 0 ? String(Math.ceil(totals.total)) : "0"}
                  onChange={(e) => setReceived(e.target.value)} />
                <span>MMK</span>
              </div>
              {roundUps.length > 0 && (
                <div className="pos3-chips" role="group" aria-label="Quick amounts">
                  {roundUps.map((n, i) => (
                    <button type="button" key={n} onClick={() => setReceived(String(n))}>{i === 0 ? "Exact" : money(n)}</button>
                  ))}
                </div>
              )}
              {change > 0 && (
                <div className="pos3-change" role="status"><span>Change to return</span><strong>{money(change)} MMK</strong></div>
              )}
            </div>
          )}
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
              <summary className="linkish">More options</summary>
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

          {issues.length > 0 && (
            <ul className="pos3-issues" role="status">
              {issues.map((t) => <li key={t}><TriangleAlert size={14} aria-hidden="true" /> {t}</li>)}
            </ul>
          )}
          <button type="button" className="complete" disabled={saving || lines.length === 0 || issues.length > 0} onClick={post}>
            {saving ? "Posting…" : `Complete sale · ${money(totals.total)} MMK`}
          </button>
        </aside>
      </div>

      {lines.length > 0 && (
        <a className="pos3-mobilebar" href="#pos-cart"
          onClick={(e) => { e.preventDefault(); document.getElementById("pos-cart")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
          <ShoppingCart size={18} aria-hidden="true" />
          <span>View cart · {totals.units} item{totals.units === 1 ? "" : "s"}</span>
          <strong>{money(totals.total)} MMK</strong>
        </a>
      )}
    </div>
  );
}

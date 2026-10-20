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
import { PosUnitPicker, PosAddedConfirm } from "./pos-unit-picker";
import type { SellableItem, ScannedUnit } from "@/lib/phone";
import { money } from "@/lib/format";
import { priceLines, type VolumeBand } from "@/lib/discount";
import { postedAmount, tender, fmtCents, exactText, quickAmounts } from "@/lib/pos-cash";
import {
  computeFacets, filterItems, reconcile, emptySelection, clearFilters, cardState, variantLine, SHELF_LIMIT,
  type Selection,
} from "@/lib/pos-facets";
import { useTranslations } from "next-intl";

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
  const tr = useTranslations("pos");
  const [loaded, setLoaded] = useState(false);
  // Browse filters: the category, and whatever its variants offer.
  const [sel, setSel] = useState<Selection>(emptySelection);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [shownCount, setShownCount] = useState(PAGE);
  const [picking, setPicking] = useState<{ item: SellableItem; units: ScannedUnit[] } | null>(null);
  // Units just put on the sale from the picker: the confirmation shows them.
  const [added, setAdded] = useState<{ item: SellableItem; imeis: string[] } | null>(null);
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
  const unitLine = (u: ScannedUnit, item?: SellableItem): Line => ({
    key: newKey(), itemId: u.item_id, name: item?.model ?? u.item_name, variant: (item && variantLine(item)) || null,
    photo: item?.photo ?? null, tracksSerial: true, serial: u.imei, qty: 1, onHand: 1,
    unitPrice: item?.price ?? 0, discountPct: 0, taxCodeId: noTax, itemGroupId: item?.item_group_id ?? null,
    warrantyMonths: item?.warranty_months ?? null, unitCost: u.unit_cost, focReasonId: null,
  });
  /** Why a unit cannot go on this sale, or null: the checks every way of adding a unit shares. */
  const unitProblem = (u: ScannedUnit, taken: Set<string>): string | null => {
    if (taken.has(u.imei)) return tr("unitOnSale", { imei: u.imei });
    if (u.status !== "IN_STOCK") return tr("unitStatus", { imei: u.imei, status: u.status.toLowerCase().replace(/_/g, " ") });
    if (u.location_id !== locationId) return tr("unitElsewhere", { imei: u.imei, location: u.location_name });
    return null;
  };

  // One scanned unit goes straight on.
  const addUnit = (u: ScannedUnit, item?: SellableItem) => {
    const why = unitProblem(u, new Set(lines.map((l) => l.serial ?? "")));
    if (why) return flash("error", why);
    setLines((ls) => [...ls, unitLine(u, item)]);
    setPicking(null);
    setMessage(null);
    scan.current?.focus();
  };

  // Several chosen in the picker: each is checked as a scanned one would be.
  const addUnits = (picked: ScannedUnit[], item: SellableItem) => {
    const taken = new Set(lines.map((l) => l.serial ?? ""));
    const ok: ScannedUnit[] = [], bad: string[] = [];
    for (const u of picked) {
      const why = unitProblem(u, taken);
      if (why) bad.push(why); else { ok.push(u); taken.add(u.imei); }
    }
    if (ok.length > 0) setLines((ls) => [...ls, ...ok.map((u) => unitLine(u, item))]);
    setPicking(null);
    if (bad.length > 0) flash("error", bad.length > 1 ? tr("andMore", { first: bad[0], n: bad.length - 1 }) : bad[0]);
    else setMessage(null);
    if (ok.length > 0) setAdded({ item, imeis: ok.map((u) => u.imei) });
    else scan.current?.focus();
  };

  const addItem = async (item: SellableItem) => {
    if (item.tracks_serial) {
      const units = (await posUnitsAction(item.id, locationId))
        .filter((u) => u.status === "IN_STOCK" && !lines.some((l) => l.serial === u.imei));
      setPicking({ item, units });
      return;
    }
    setLines((ls) => {
      const same = ls.find((l) => l.itemId === item.id && !l.tracksSerial && !l.focReasonId);
      if (same) return ls.map((l) => (l === same ? { ...l, qty: Math.min(l.qty + 1, l.onHand) } : l));
      return [...ls, {
        key: newKey(), itemId: item.id, name: item.model, variant: variantLine(item) || null, photo: item.photo,
        tracksSerial: false, serial: null, qty: 1, onHand: item.on_hand,
        unitPrice: item.price ?? 0, discountPct: 0, taxCodeId: noTax, itemGroupId: item.item_group_id,
        warrantyMonths: item.warranty_months, focReasonId: null,
      }];
    });
    setMessage(null);
  };

  // Enter: an exact IMEI, serial, barcode or SKU goes straight onto the sale, whatever
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
      flash("error", tr("noUnit", { imei: t }));
      return;
    }
    // A barcode or SKU code naming exactly one product adds it.
    const lower = t.toLowerCase();
    const byBarcode = r.items.filter((i) => i.barcode === t || i.code.toLowerCase() === lower);
    if (byBarcode.length === 1) { await addItem(byBarcode[0]); setQ(""); return; }
    if (truncated) { setItems(r.items); searched.current = true; }
  });

  const typed = (v: string) => {
    setQ(v);
    setShownCount(PAGE);
    // Words cleared after a server search of a big shelf: the whole shelf again.
    if (!v && searched.current) start(async () => { await loadShelf(); });
  };

  const another = (itemId: string) => { const it = items.find((i) => i.id === itemId); if (it) void addItem(it); };

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
    // The sale's own total, whatever cash was handed over: change is not booked.
    const total = postedAmount(totals.total);
    switch (mode) {
      case "CASH": return [{ accountId: cashAcct?.id ?? "", amount: total }];
      case "QR": case "CARD": return [{ accountId: bankId, amount: total }];
      case "CREDIT": return [];
      case "SPLIT": return split.map((p) => ({ accountId: p.accountId, amount: Number(p.amount) || 0 }));
    }
  };

  const customerName = props.customers.find((c) => c.id === partnerId)?.name ?? tr("walkIn");
  const splitPaid = split.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const tend = useMemo(() => tender(totals.total, received), [totals.total, received]);
  const change = mode === "CASH" ? tend.changeCents : 0;

  // What stops Complete sale, said in words — each is a check the server also
  // makes; the till says it first.
  const issues = useMemo(() => {
    const out: string[] = [];
    if (lines.length === 0) return out;
    const unpriced = lines.filter((l) => !l.focReasonId && !(l.unitPrice > 0));
    if (unpriced.length > 0) {
      out.push(tr("needPrice", { names: [...new Set(unpriced.map((l) => l.name))].join(", ") }));
    }
    if (mode === "CREDIT" && !partnerId) out.push(tr("creditNeedsCustomer"));
    if (mode === "SPLIT" && !partnerId && splitPaid < totals.total - 0.005) out.push(tr("walkInPaysFull"));
    if (mode === "CASH" && tend.invalid) out.push(tr("cashInvalid"));
    else if (mode === "CASH" && tend.shortCents > 0) out.push(tr("cashShort", { amount: fmtCents(tend.shortCents) }));
    return out;
  }, [lines, mode, partnerId, splitPaid, tend, totals.total, tr]);

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
        else flash("ok", tr("salePosted", { no: r.docNo }), r.id);
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
  const renderLine = (l: Line) => {
    const charged = chargedOf(l);
    const isOpen = editing === l.key;
    const noPrice = !l.focReasonId && !(l.unitPrice > 0);
    return (
      <div className={`pos3-line${l.focReasonId ? " free" : ""}`} key={l.key}>
        <span className="pos3-line-img">
          {l.photo ? <img src={l.photo} alt="" /> : <Smartphone size={18} aria-hidden="true" />}
        </span>
        <div className="pos3-line-main">
          <div className="pos3-line-top">
            <div>
              <div className="pos3-line-name">{l.name}</div>
              <div className="pos3-line-sub">
                {[l.variant, l.serial ? `IMEI ${maskImei(l.serial)}` : null].filter(Boolean).join(" · ")}
              </div>
            </div>
            <button type="button" className="pos3-bin" aria-label={tr("remove", { name: `${l.name}${l.serial ? ` ${l.serial}` : ""}` })}
              onClick={() => removeLine(l.key)}><Trash2 size={15} /></button>
          </div>
          <div className="pos3-line-row">
            {l.tracksSerial ? (
              <span className="pos3-qty-one">{tr("oneUnit")}</span>
            ) : (
              <span className="pos3-stepper" role="group" aria-label={tr("qtyOf", { name: l.name })}>
                <button type="button" aria-label={tr("oneLess")} onClick={() => step(l, -1)}><Minus size={13} /></button>
                <span aria-live="polite">{l.qty}</span>
                <button type="button" aria-label={tr("oneMore")} onClick={() => step(l, 1)}
                  disabled={l.qty >= l.onHand}><Plus size={13} /></button>
              </span>
            )}
            <span className="pos3-line-price">
              {l.focReasonId ? (
                <><s>{money(l.qty * l.unitPrice)}</s> <strong className="pos3-free">{tr("free")}</strong></>
              ) : noPrice ? (
                <strong className="pos3-nopr">{tr("noPrice")}</strong>
              ) : (
                <>{l.discountPct > 0 && <s>{money(l.qty * l.unitPrice)}</s>} <strong>{money(charged)}</strong></>
              )}
            </span>
          </div>
          <div className="pos3-line-tools">
            <button type="button" className={`pos3-tool${l.focReasonId ? " on" : ""}`}
              disabled={props.focReasons.length === 0} aria-pressed={!!l.focReasonId}
              onClick={() => setLine(l.key, { focReasonId: l.focReasonId ? null : defaultFoc })}>
              <Gift size={13} aria-hidden="true" /> {l.focReasonId ? tr("freeShort") : tr("makeFree")}
            </button>
            <button type="button" className="pos3-tool" aria-expanded={isOpen}
              onClick={() => setEditing(isOpen ? null : l.key)}>
              {noPrice ? tr("setPrice") : tr("edit")} <ChevronDown size={13} aria-hidden="true" />
            </button>
            {l.tracksSerial && (
              <button type="button" className="pos3-tool" onClick={() => another(l.itemId)}>
                <Plus size={13} aria-hidden="true" /> {tr("addAnother")}
              </button>
            )}
          </div>
          {l.focReasonId && (
            <select className="pos3-reason" aria-label={tr("whyFree")} value={l.focReasonId}
              onChange={(e) => setLine(l.key, { focReasonId: e.target.value })}>
              {props.focReasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          {isOpen && (
            <div className="pos3-edit">
              {l.serial && <span className="pos3-edit-imei">IMEI <span className="m">{l.serial}</span></span>}
              <label>{tr("price")}<input type="number" min={0} value={l.unitPrice} autoFocus={noPrice}
                onChange={(e) => setLine(l.key, { unitPrice: Number(e.target.value) || 0 })} /></label>
              {!l.focReasonId && (
                <label>{tr("discountPct")}<input type="number" min={0} max={props.discountCeiling ?? 100} value={l.discountPct}
                  onChange={(e) => setLine(l.key, { discountPct: Number(e.target.value) || 0 })} /></label>
              )}
              <label>{tr("tax")}<select value={l.taxCodeId} onChange={(e) => setLine(l.key, { taxCodeId: e.target.value })}>
                {props.taxCodes.map((t) => <option key={t.id} value={t.id}>{t.code}</option>)}
              </select></label>
              <label>{tr("warrantyMo")}<input type="number" min={0} value={l.warrantyMonths ?? ""}
                onChange={(e) => setLine(l.key, { warrantyMonths: e.target.value === "" ? null : Number(e.target.value) })} /></label>
              {props.showCost && l.unitCost != null && (
                <span className="subline pos3-edit-wide">{tr("margin", { amount: money(charged - l.unitCost * l.qty) })}</span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  /** One IMEI inside a grouped entry: its own price, free flag and removal. */
  const renderUnitRow = (l: Line, n: number, base: Line) => {
    const charged = chargedOf(l);
    const isOpen = editing === l.key;
    const noPrice = !l.focReasonId && !(l.unitPrice > 0);
    // The price is said only where it differs from the entry's own, so the IMEI keeps its room.
    const oddPrice = !!l.focReasonId || noPrice || l.discountPct > 0 || l.unitPrice !== base.unitPrice;
    return (
      <div className={`pos3-urow${l.focReasonId ? " free" : ""}`} key={l.key}>
        <div className="pos3-urow-main">
          <span className="pos3-urow-n">{n}</span>
          <span className="m pos3-urow-imei">{l.serial}</span>
          {oddPrice && (
            <span className="pos3-urow-price">
              {l.focReasonId ? <strong className="pos3-free">{tr("free")}</strong>
                : noPrice ? <strong className="pos3-nopr">{tr("noPrice")}</strong>
                : <>{l.discountPct > 0 && <s>{money(l.unitPrice)}</s>} {money(charged)}</>}
            </span>
          )}
          <button type="button" className={`pos3-icon${l.focReasonId ? " on" : ""}`} aria-pressed={!!l.focReasonId}
            aria-label={l.focReasonId ? tr("makeChargeable", { imei: l.serial ?? "" }) : tr("giveFree", { imei: l.serial ?? "" })} title={l.focReasonId ? tr("freeTapToCharge") : tr("makeFree")}
            disabled={props.focReasons.length === 0}
            onClick={() => setLine(l.key, { focReasonId: l.focReasonId ? null : defaultFoc })}><Gift size={14} /></button>
          <button type="button" className="pos3-icon" aria-expanded={isOpen} aria-label={tr("editPriceOf", { imei: l.serial ?? "" })} title={tr("edit")}
            onClick={() => setEditing(isOpen ? null : l.key)}><ChevronDown size={14} className={isOpen ? "up" : ""} /></button>
          <button type="button" className="pos3-icon bad" aria-label={tr("remove", { name: l.serial ?? "" })} title={tr("removeImei")}
            onClick={() => removeLine(l.key)}><X size={14} /></button>
        </div>
        {l.focReasonId && (
          <select className="pos3-reason" aria-label={tr("whyFree")} value={l.focReasonId}
            onChange={(e) => setLine(l.key, { focReasonId: e.target.value })}>
            {props.focReasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        {isOpen && (
          <div className="pos3-edit">
            <label>{tr("price")}<input type="number" min={0} value={l.unitPrice} autoFocus={noPrice}
              onChange={(e) => setLine(l.key, { unitPrice: Number(e.target.value) || 0 })} /></label>
            {!l.focReasonId && (
              <label>{tr("discountPct")}<input type="number" min={0} max={props.discountCeiling ?? 100} value={l.discountPct}
                onChange={(e) => setLine(l.key, { discountPct: Number(e.target.value) || 0 })} /></label>
            )}
            <label>{tr("tax")}<select value={l.taxCodeId} onChange={(e) => setLine(l.key, { taxCodeId: e.target.value })}>
              {props.taxCodes.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}
            </select></label>
            <label>{tr("warrantyMo")}<input type="number" min={0} value={l.warrantyMonths ?? ""}
              onChange={(e) => setLine(l.key, { warrantyMonths: e.target.value === "" ? null : Number(e.target.value) })} /></label>
            {props.showCost && l.unitCost != null && (
              <span className="subline pos3-edit-wide">{tr("margin", { amount: money(charged - l.unitCost) })}</span>
            )}
          </div>
        )}
      </div>
    );
  };

  const quick = useMemo(() => quickAmounts(tend.dueCents), [tend.dueCents]);

  return (
    <div className="pos3-page">
      {done && <PosSaleDone view={done.view} logoUrl={done.logoUrl} onClose={closeDone} />}
      {picking && (
        <PosUnitPicker item={picking.item} units={picking.units}
          onAdd={(picked) => addUnits(picked, picking.item)}
          onClose={() => { setPicking(null); scan.current?.focus(); }} />
      )}
      {added && (
        <PosAddedConfirm item={added.item} imeis={added.imeis} cartUnits={totals.units}
          onContinue={() => { setAdded(null); scan.current?.focus(); }}
          onViewCart={() => { setAdded(null); document.getElementById("pos-cart")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} />
      )}

      <div className="pos3-top">
        <div className="page-head hero">
          <h1>{tr("title")}</h1>
        </div>
      </div>

      <div className="pos3">
        <section className="pos3-shelf" aria-label={tr("products")}>
          {message && (
            <div className={message.kind === "error" ? "alert" : "alert ok"} role={message.kind === "error" ? "alert" : "status"}>
              {message.text}
              {message.id && <> · <Link href={`/pos/receipt/${message.id}`} target="_blank">{tr("printReceipt")}</Link></>}
            </div>
          )}

          <div className="pos3-searchrow">
            <form className="pos3-search" onSubmit={(e) => { e.preventDefault(); search(q); }} role="search">
              <ScanLine size={22} aria-hidden="true" />
              <input ref={scan} autoFocus value={q} onChange={(e) => typed(e.target.value)} autoComplete="off"
                inputMode="search" enterKeyHint="search"
                placeholder={tr("searchPlaceholder")}
                aria-label={tr("searchLabel")} />
              {q && (
                <button type="button" className="pos3-x" aria-label={tr("clearSearch")} onClick={() => { typed(""); scan.current?.focus(); }}>
                  <X size={16} />
                </button>
              )}
            </form>
          {/* Where the sale is made: chosen when there are several, shown when
              a cashier has only their own branch, so the till always says where. */}
          <label className="pos3-branch">
            <Store size={20} aria-hidden="true" />
            <span className="pos3-branch-text">
              <b>{here?.branch ?? here?.name}</b>
              <small>{here?.branch ? here.name : tr("sellingFrom")}</small>
            </span>
            {props.locations.length > 1 && (
              <>
                <ChevronDown size={16} aria-hidden="true" />
                <select aria-label={tr("sellingFrom")} value={locationId}
                  onChange={(e) => { setLocationId(e.target.value); setPicking(null); }}>
                  {props.locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.branch ? `${l.branch} · ${l.name}` : l.name}</option>
                  ))}
                </select>
              </>
            )}
          </label>
          </div>

          <div className="pos3-bar">
            <div className="pos3-pills" role="group" aria-label={tr("category")}>
              <button type="button" className="pos3-pill" aria-pressed={!sel.type} onClick={() => pickType("")}>{tr("allTypes")}</button>
              {pills.map((t) => (
                <button type="button" key={t.type} className="pos3-pill" aria-pressed={sel.type === t.type}
                  onClick={() => pickType(t.type)}>{t.type}</button>
              ))}
            </div>
            <div className="pos3-bar-right">
              <button type="button" className="pos3-filter-btn" aria-expanded={filtersOpen} aria-controls="pos3-filters"
                onClick={() => setFiltersOpen((o) => !o)}>
                <SlidersHorizontal size={16} aria-hidden="true" /> {tr("filters")}
                {facets.active > 0 && <span className="pf-count">{facets.active}</span>}
              </button>
              <label className="pos3-instock">
                <input type="checkbox" checked={sel.inStockOnly} onChange={(e) => setFilters({ ...sel, inStockOnly: e.target.checked })} />
                {tr("inStockOnly")}
              </label>
            </div>
          </div>

          <div className={`pos3-work${filtersOpen ? " with-filters" : ""}`}>
            {filtersOpen && (
              <div id="pos3-filters" className="pos3-filter-col">
                <PosFilters facets={facets} sel={sel} total={shown.length} onChange={setFilters} onType={pickType} />
              </div>
            )}

            <div className="pos3-results">
              <p className="pos3-count" aria-live="polite">
                {loaded ? tr("productCount", { n: shown.length }) : tr("loading")}
                {truncated && tr("truncated", { n: SHELF_LIMIT.toLocaleString() })}
              </p>
              <div className="pos3-grid">
                {shown.slice(0, shownCount).map((i) => {
                  const inCart = lines.filter((l) => l.itemId === i.id).reduce((s, l) => s + l.qty, 0);
                  const st = cardState(i);
                  return (
                    <article key={i.id} className={`pos3-card ${st}`}>
                      <span className="pos3-img">
                        {i.photo ? <img src={i.photo} alt="" loading="lazy" decoding="async" /> : <Smartphone size={28} aria-hidden="true" />}
                        {inCart > 0 && <span className="pos3-badge" aria-label={tr("inCart", { n: inCart })}>{inCart}</span>}
                      </span>
                      <div className="pos3-info">
                        <h3 className="pos3-name">{i.model}</h3>
                        {variantLine(i) && <p className="pos3-sub">{variantLine(i)}</p>}
                        <div className="pos3-meta">
                          {i.price != null && i.price > 0
                            ? <p className="pos3-price">{money(i.price)} <small>MMK</small></p>
                            : <p className="pos3-price none"><TriangleAlert size={13} aria-hidden="true" /> {tr("noPriceSet")}</p>}
                          <span className={`pos3-stock ${st}`}>{st === "out" ? tr("outOfStock") : tr("left", { n: i.on_hand })}</span>
                        </div>
                      </div>
                      <button type="button" className="pos3-add" onClick={() => addItem(i)} disabled={st === "out"}
                        aria-label={tr(i.tracks_serial ? "selectUnitOf" : "addName", { name: `${i.model}${variantLine(i) ? ` ${variantLine(i)}` : ""}` })}>
                        <ShoppingCart size={15} aria-hidden="true" /> {st === "out" ? tr("unavailable") : i.tracks_serial ? tr("selectUnit") : tr("add")}
                      </button>
                    </article>
                  );
                })}
              </div>
              {loaded && shown.length === 0 && (
                <div className="pos3-nothing">
                  <p>{items.length === 0 ? tr("nothingStocked") : tr("noMatch")}</p>
                  {items.length > 0 && (
                    <button type="button" className="pos3-link" onClick={() => { setQ(""); setSel(clearFilters({ ...emptySelection(), inStockOnly: false })); }}>
                      {tr("clearAll")}
                    </button>
                  )}
                </div>
              )}
              {shown.length > shownCount && (
                <button type="button" className="pos3-showmore" onClick={() => setShownCount((n) => n + PAGE)}>
                  {tr("showMore", { n: shown.length - shownCount })}
                </button>
              )}
            </div>
          </div>
        </section>

        <aside className="pos3-cart" id="pos-cart" aria-label={tr("currentSale")}>
          <div className="pos3-cart-head">
            <h2><ShoppingCart size={18} aria-hidden="true" /> {tr("cart")}</h2>
            <span className="subline">{tr("items", { n: totals.units })}</span>
            {lines.length > 0 && (
              <button type="button" className={`pos3-clear${confirmClear ? " sure" : ""}`} onClick={clearCart}>
                {confirmClear ? tr("clearAllQ") : tr("clear")}
              </button>
            )}
          </div>
          <select aria-label={tr("customer")} value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className="pos3-customer">
            <option value="">{tr("walkIn")}</option>
            {props.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <div className="pos3-lines">
            {lines.length === 0 && (
              <div className="pos3-empty">
                <ShoppingCart size={28} aria-hidden="true" />
                <span>{tr("emptyCart")}</span>
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
                      <span className="pos3-line-name">{first.name}</span>
                      {first.variant && <span className="pos3-line-sub">{first.variant}</span>}
                      <span className="pos3-line-sub">
                        {tr("units", { n: qty })}{first.focReasonId ? tr("complimentary") : ""} · {isOpen ? tr("hideImeis") : tr("showImeis")}
                      </span>
                    </span>
                    <span className="pos3-group-total">
                      {first.focReasonId ? <strong className="pos3-free">{tr("free")}</strong>
                        : missing ? <strong className="pos3-nopr">{tr("noPrice")}</strong> : <strong>{money(total)}</strong>}
                      <ChevronDown size={15} aria-hidden="true" className={isOpen ? "up" : ""} />
                    </span>
                  </button>
                  {isOpen && (
                    <div className="pos3-group-body">
                      <div className="pos3-group-sum"><span>{tr("unitsImeis", { n: qty })}</span><strong>{first.focReasonId ? tr("free") : money(total)}</strong></div>
                      {g.lines.map((l, n) => renderUnitRow(l, n + 1, first))}
                      <button type="button" className="pos3-another" onClick={() => another(first.itemId)}>
                        <Plus size={14} aria-hidden="true" /> {tr("addAnotherImei")}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <dl className="pos3-slip">
            <dt>{tr("subtotal", { n: totals.units })}</dt><dd>{money(totals.sub)} <small>MMK</small></dd>
            {totals.disc > 0 && <><dt>{tr("discount")}</dt><dd className="neg">−{money(totals.disc)}</dd></>}
            {totals.volume > 0 && (
              <><dt title={totals.earned}>{tr("volumeDiscount")} <small>{totals.earned}</small></dt>
                <dd className="neg">−{money(totals.volume)}</dd></>
            )}
            {totals.freeQty > 0 && (
              <><dt>{tr("freeItems", { n: totals.freeQty })}</dt><dd className="subline">{tr("notCharged", { amount: money(totals.freeValue) })}</dd></>
            )}
            {totals.tax > 0 && <><dt>{inclusive ? tr("taxIncl") : tr("tax")}</dt><dd>{money(totals.tax)}</dd></>}
            <dt className="grand">{tr("total")}</dt><dd className="grand">{money(totals.total)} <small>MMK</small></dd>
            {props.showCost && lines.length > 0 && <><dt>{tr("grossProfit")}</dt><dd>{money(totals.net - totals.cost)}</dd></>}
          </dl>

          <div className="paymodes" role="group" aria-label={tr("paymentMethod")}>
            {([["CASH", "Cash", Banknote], ["QR", "QR", QrCode], ["CARD", "Card", CreditCard], ["CREDIT", "Credit", HandCoins]] as const).map(([m, label, Icon]) => (
              <button type="button" key={m} className="paymode" aria-pressed={mode === m}
                disabled={(m === "QR" || m === "CARD") && bankAccts.length === 0}
                onClick={() => setMode(m)}>
                <Icon size={16} aria-hidden="true" /> {tr(`mode.${m}`)}
              </button>
            ))}
          </div>
          {mode === "CASH" && (
            <div className="pos3-cash">
              <label htmlFor="pos-received">{tr("cashReceived")}</label>
              <div className="pos3-money">
                <input id="pos-received" type="number" inputMode="decimal" min={0} value={received}
                  placeholder={tend.dueCents > 0 ? exactText(tend.dueCents) : "0"}
                  onChange={(e) => setReceived(e.target.value)} />
                <span>MMK</span>
              </div>
              {quick.length > 0 && (
                <div className="pos3-chips" role="group" aria-label={tr("quickAmounts")}>
                  {quick.map((c, i) => (
                    <button type="button" key={c} onClick={() => setReceived(exactText(c))}>{i === 0 ? tr("exact") : fmtCents(c)}</button>
                  ))}
                </div>
              )}
              {change > 0 && (
                <div className="pos3-change" role="status"><span>{tr("changeToReturn")}</span><strong>{fmtCents(change)} MMK</strong></div>
              )}
            </div>
          )}
          {(mode === "QR" || mode === "CARD") && bankAccts.length > 1 && (
            <select aria-label={tr("intoAccount")} value={bankId} onChange={(e) => setBankId(e.target.value)}>
              {bankAccts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          {mode === "CREDIT" && (
            <p className="hint">{partnerId ? tr("onAccount", { name: customerName }) : tr("creditNeedsCustomer")}</p>
          )}
          {mode === "SPLIT" && (
            <div className="pos-pay">
              {split.map((p, i) => (
                <div className="pos-pay-row" key={i}>
                  <select aria-label={tr("account")} value={p.accountId}
                    onChange={(e) => setSplit((ps) => ps.map((x, j) => (j === i ? { ...x, accountId: e.target.value } : x)))}>
                    {props.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <input type="number" min={0} aria-label={tr("amount")} value={p.amount} className="pos-num"
                    onChange={(e) => setSplit((ps) => ps.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                </div>
              ))}
              <button type="button" className="linkish"
                onClick={() => setSplit((ps) => [...ps, { accountId: bankAccts[0]?.id ?? cashAcct?.id ?? "", amount: "" }])}>
                {tr("addTender")}
              </button>
              <p className="hint">
                {splitPaid >= totals.total - 0.005 ? tr("paidInFull") : partnerId
                  ? tr("goesOnAccount", { amount: money(totals.total - splitPaid) }) : tr("walkInPaysFull")}
              </p>
            </div>
          )}
          <div className="pos3-more">
            <button type="button" className="linkish" onClick={() => setMode(mode === "SPLIT" ? "CASH" : "SPLIT")}>
              {mode === "SPLIT" ? tr("singlePayment") : tr("splitPayment")}
            </button>
            <details>
              <summary className="linkish">{tr("moreOptions")}</summary>
              <div className="pos-stack">
                <div className="field">
                  <label htmlFor="pos-sm">{tr("salesperson")}</label>
                  <select id="pos-sm" value={salesmanId} onChange={(e) => setSalesmanId(e.target.value)}>
                    <option value="">—</option>
                    {props.salesmen.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <label className="pos-check">
                  <input type="checkbox" checked={inclusive} onChange={(e) => setInclusive(e.target.checked)} />
                  {tr("pricesIncludeTax")}
                </label>
                {props.discountCeiling != null && (
                  <p className="hint">{tr("discountCeiling", { pct: props.discountCeiling })}</p>
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
            {saving ? tr("posting") : tr("complete", { amount: money(totals.total) })}
          </button>
        </aside>
      </div>

      {lines.length > 0 && (
        <a className="pos3-mobilebar" href="#pos-cart"
          onClick={(e) => { e.preventDefault(); document.getElementById("pos-cart")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
          <ShoppingCart size={18} aria-hidden="true" />
          <span>{tr("viewCart", { n: totals.units })}</span>
          <strong>{money(totals.total)} MMK</strong>
        </a>
      )}
    </div>
  );
}

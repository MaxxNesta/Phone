"use client";
import { WarehouseSelect } from "@/components/warehouse-select";

import Link from "next/link";
import { Fragment, useActionState, useEffect, useRef, useState } from "react";
import { OffOrderConfirm } from "./off-order-confirm";
import type { ActionResult, PickerItem } from "@/lib/actions";
import { serialsOnFile } from "@/lib/actions";
import { ItemPicker } from "./item-picker";
import { PartnerPicker } from "./partner-picker";
import { MaybeSamePurchase } from "./same-purchase";
import { ImeiPanel, rowsProblem, type UnitRow, type UnitMode, type OnFile } from "./imei-panel";
import { AddItemsBar, type Pick } from "./add-items-bar";
import { ArrowLeft, ClipboardList, Building2, Package, Smartphone, Plus, Trash2, ChevronDown } from "lucide-react";
import { CurrencyRate, useFxSwitch, convertPrice, type FxOption } from "./currency-rate";
import type { GrirCollisionLine } from "@/lib/queries";

type Item = PickerItem;
type Node = { id: string; code: string; segment: string; name: string; parent_id: string | null };
type Partner = {
  id: string; code: string; name: string; currency?: string | null;
  company_name?: string | null; address?: string | null; phone?: string | null;
  township?: string | null; region?: string | null; payment_terms_days?: number | null;
};
/** A purchase order being received: its supplier, and what is still owed. */
export type OrderToReceive = {
  id: string; docNo: string; partnerId: string; locationId: string | null;
  /** What the order was placed in; the receipt prices in the same. */
  currency?: string; rate?: number;
  lines: { lineId: string; itemId: string; qty: number; unitCost: number }[];
};
type Location = { id: string; code: string; name: string };
type Line = {
  key: number; itemId: string; qty: string; unitCost: string;
  /** Which unit the quantity is in. Empty means the item's own unit. */
  uomId?: string;
  /** The lot these goods arrived under, for an item that tracks batches. */
  batchNo?: string;
  expiryDate?: string;
  /**
   * The invoice line this one fulfils, when the receipt is matched to a bill.
   * Recorded rather than re-derived: without it, which line a shipment came
   * off is a guess made later from item and order, and a line the invoice
   * never billed is indistinguishable from one it did.
   */
  sourceLineId?: string | null;
  /** The order line behind the bill line, where the bill came from an order. */
  orderLineId?: string | null;
  /** The handsets in the box, for an item tracked by IMEI. */
  serials?: UnitRow[];
  /** What the purchase order still owes on this line, when receiving one. */
  ordered?: number;
};
type MatchLine = {
  lineId: string; itemId: string; itemCode: string; itemName: string;
  qty: number; unitPrice: number;
  /** The order line this bill line was raised from, where there was one. */
  orderLineId?: string | null;
};
type OpenDoc = {
  id: string; doc_no: string; doc_date: string; partner_id: string;
  /** The warehouse the bill names, so goods answering it arrive there. */
  location_id?: string | null;
  lines: MatchLine[];
};

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * Stock arriving with no purchase order behind it — goods that showed up,
 * or a PO placed outside this system. Posts real inventory now, at whatever
 * cost is entered; the supplier's bill is a separate document, whenever it
 * arrives.
 */
/** Not an invoice id, so it cannot collide with one. */
const NONE = "__none__";

const shortDate = (v: unknown) =>
  v ? new Date(String(v)).toLocaleDateString("en-GB",
    { weekday: "short", day: "numeric", month: "short" }) : "";

export function ReceiptForm({
  action,
  suppliers,
  items: initialItems,
  locations,
  today,
  categories,
  uoms,
  purchaseInvoices,
  openOrders,
  collisions = {},
  initialInvoiceId,
  fx,
  saveDraft,
  draft,
  order,
}: {
  /** Receiving a purchase order: its lines arrive filled in, against it. */
  order?: OrderToReceive | null;
  /** Keeps a half-scanned receipt; nothing moves until it posts. */
  saveDraft?: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  /** A receipt draft being resumed. */
  draft?: { id: string; state: string } | null;
  /** Currencies and their latest rates, for goods bought abroad. */
  fx?: { base: string; options: FxOption[] };
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  suppliers: Partner[];
  items: Item[];
  locations: Location[];
  today: string;
  categories: Node[];
  uoms: { id: string; code: string; name: string }[];
  /** Open (unmatched) purchase invoices this receipt can match against — the bill arrived first. */
  purchaseInvoices?: OpenDoc[];
  /**
   * Open purchase orders per supplier id: goods this supplier already owes.
   * A receipt raised here names no order, so the order stays at nothing
   * received however much arrives — and then reads as overdue with the goods
   * on the shelf. The form cannot fix that afterwards; it can only ask now.
   */
  /** Goods waiting on a bill and a bill waiting on goods, keyed by supplier.
   *  See getGrirCollisions. */
  collisions?: Record<string, GrirCollisionLine[]>;
  openOrders?: Record<string, {
    orderId: string; orderNo: string;
    lines: { itemId: string; itemCode: string; qty: number }[];
  }[]>;
  /** Arrived via "Create goods receipt" on a specific invoice's own page — match it immediately. */
  initialInvoiceId?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never,
    null
  );

  /** See the hidden field below. */
  const [attemptKey] = useState(() => crypto.randomUUID());

  const [items, setItems] = useState<Item[]>(initialItems);
  const addItem = (i: Item) => setItems((xs) => [...xs, i]);

  // A resumed draft: the editor as it was left. A matched bill is not put
  // back — it may have been received since — so it is chosen again.
  const [saved] = useState(() => {
    try { return draft?.state ? JSON.parse(draft.state) : null; } catch { return null; }
  });
  const [lines, setLines] = useState<Line[]>(saved?.lines?.length ? saved.lines
    : order ? order.lines.map((l, i) => ({
        key: i + 1, itemId: l.itemId, qty: String(l.qty), unitCost: l.unitCost ? String(l.unitCost) : "",
        sourceLineId: l.lineId, ordered: l.qty }))
    : [{ key: 1, itemId: "", qty: "", unitCost: "", sourceLineId: null }]);
  const [partnerId, setPartnerId] = useState<string>(saved?.partnerId ?? order?.partnerId ?? "");
  /** The line whose IMEIs are open below the table. */
  const [imeiKey, setImeiKey] = useState<number | null>(null);
  /** A line whose phone is being changed. */
  const [changing, setChanging] = useState<number | null>(null);
  const base = fx?.base ?? "MMK";
  const orderFx = order?.currency && order.currency !== base ? order : null;
  const [currency, setCurrency] = useState<string>(saved?.currency ?? orderFx?.currency ?? base);
  const [rate, setRate] = useState<string>(saved?.rate ?? (orderFx ? String(orderFx.rate) : ""));
  const foreign = currency !== base;
  const fxSwitch = useFxSwitch(base, currency, rate, (c, r) => { setCurrency(c); setRate(r); },
    (f) => setLines((ls) => ls.map((l) => ({ ...l, unitCost: convertPrice(l.unitCost, f) }))));
  const [docDate, setDocDate] = useState<string>(saved?.docDate ?? today);
  const [draftId, setDraftId] = useState(draft?.id ?? "");
  const [draftResult, draftAction, savingDraft] = useActionState<ActionResult | null, FormData>(
    (saveDraft ?? (async () => ({ ok: true } as ActionResult))) as never, null);
  useEffect(() => {
    if (draftResult && "ok" in draftResult && draftResult.draftId) setDraftId(draftResult.draftId);
  }, [draftResult]);
  const [receivedTime, setReceivedTime] = useState("");
  const [matchedPiId, setMatchedPiId] = useState("");
  const [locationId, setLocationId] = useState<string>(
    saved?.locationId ?? order?.locationId ?? locations[0]?.id ?? "");
  // Chose "not matched" deliberately, as opposed to not having answered yet.
  // Only distinguishable while more than one invoice is waiting; with one it
  // is picked for you and this is how you say no to it.
  const [unmatched, setUnmatched] = useState(false);
  const [autoMatched, setAutoMatched] = useState(false);

  // Set client-side, after mount, so the server-rendered markup and the
  // first client render match — "now" would differ between the two.
  useEffect(() => {
    setReceivedTime(new Date().toTimeString().slice(0, 5));
  }, []);

  const byId = (id: string) => items.find((i) => i.id === id);
  const openInvoices = (purchaseInvoices ?? []).filter((d) => d.partner_id === partnerId);
  const waitingOrders = partnerId ? (openOrders?.[partnerId] ?? []) : [];

  /**
   * Halves of the same purchase, left over from a bill that came before the
   * goods. Shown whatever is matched: matching this receipt to that bill is
   * one of the ways the double happens, so suppressing it then would silence
   * the warning in the case it was written for.
   */
  const sameTwice = partnerId ? (collisions?.[partnerId] ?? []) : [];
  const matchedPi = openInvoices.find((d) => d.id === matchedPiId) ?? null;

  function fillFrom(pi: OpenDoc) {
    setLines(
      pi.lines.map((l, idx) => ({
        key: idx + 1,
        itemId: l.itemId,
        qty: String(l.qty),
        unitCost: String(l.unitPrice),
        sourceLineId: l.lineId,
      }))
    );
  }

  function matchInvoice(id: string, auto = false) {
    setMatchedPiId(id);
    setUnmatched(false);
    setAutoMatched(auto);
    const pi = openInvoices.find((d) => d.id === id);
    if (!pi) return;
    fillFrom(pi);
    // The bill names a warehouse; goods answering it arrive there. Asking
    // again is asking a question already answered on the screen.
    if (pi.location_id) setLocationId(pi.location_id);
  }

  /**
   * Stop matching — either the supplier changed, or these goods really are
   * arriving without an invoice. Lines that came from an invoice go with it:
   * leaving another supplier's items sitting in the table is how a receipt
   * gets posted for goods nobody sent.
   */
  function clearMatch(hadMatch: boolean) {
    setMatchedPiId("");
    setAutoMatched(false);
    if (hadMatch) setLines([{ key: 1, itemId: "", qty: "", unitCost: "", sourceLineId: null }]);
  }

  // Arrived from a specific invoice's own page — its supplier isn't chosen
  // yet at this point, so this searches the full list rather than
  // openInvoices (which only exists once a supplier is picked).
  useEffect(() => {
    if (!initialInvoiceId) return;
    const pi = (purchaseInvoices ?? []).find((d) => d.id === initialInvoiceId);
    if (!pi) return;
    setPartnerId(pi.partner_id);
    setMatchedPiId(pi.id);
    fillFrom(pi);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialInvoiceId]);

  /**
   * One invoice waiting on goods from this supplier is not a question.
   *
   * The form used to open on "Not matched", printed directly above a list
   * containing the very invoice these goods were for, and wait to be told
   * what it already knew. Two invoices is a real question and is still
   * asked; one is answered.
   */
  useEffect(() => {
    if (initialInvoiceId || order) return;
    if (!partnerId) return;
    if (matchedPiId && openInvoices.some((d) => d.id === matchedPiId)) return;
    const hadMatch = matchedPiId !== "";
    if (openInvoices.length === 1) matchInvoice(openInvoices[0].id, true);
    else { clearMatch(hadMatch); setUnmatched(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId, purchaseInvoices]);

  function setLine(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function pickItem(key: number, itemId: string) {
    const item = byId(itemId);
    // A line the bill covers takes the bill's price; anything else falls back
    // to the item's last cost, and answers no invoice line.
    const billedLine = matchedPi?.lines.find((pl) => pl.itemId === itemId);
    const cost = billedLine ? billedLine.unitPrice : item ? Number(item.next_cost) : 0;
    setLine(key, {
      itemId,
      unitCost: cost > 0 ? String(cost) : "",
      sourceLineId: billedLine?.lineId ?? null,
    });
  }

  const addLine = () =>
    setLines((ls) => [...ls,
      { key: Math.max(0, ...ls.map((l) => l.key)) + 1, itemId: "", qty: "", unitCost: "", sourceLineId: null }]);

  /**
   * From the search or the catalogue. Against an order, an item comes back as
   * its order line — still owed, at the order's cost, linked so the receipt
   * answers it. Otherwise it is priced as picking it on a line would be.
   */
  function addPicks(picks: Pick[]) {
    setLines((ls) => {
      let next = [...ls];
      for (const p of picks) {
        const at = next.find((l) => l.itemId === p.itemId);
        if (at) { next = next.map((l) => l === at ? { ...l, qty: String((Number(l.qty) || 0) + p.qty) } : l); continue; }
        const ol = order?.lines.find((x) => x.itemId === p.itemId);
        const billed = matchedPi?.lines.find((pl) => pl.itemId === p.itemId);
        const item = byId(p.itemId);
        const cost = ol ? ol.unitCost : billed ? billed.unitPrice : item ? Number(item.next_cost) : 0;
        const fill: Partial<Line> = {
          itemId: p.itemId, qty: String(p.qty), unitCost: cost > 0 ? String(cost) : "",
          sourceLineId: ol?.lineId ?? billed?.lineId ?? null, ...(ol ? { ordered: ol.qty } : {}),
        };
        const blank = next.find((l) => !l.itemId);
        next = blank ? next.map((l) => l === blank ? { ...l, ...fill } as Line : l)
          : [...next, { key: Math.max(0, ...next.map((l) => l.key)) + 1, ...fill } as Line];
      }
      return next;
    });
  }
  // Against an order, the search and catalogue offer the order's lines not
  // already on this receipt — a line removed can be brought back, at what is owed.
  const offered = order
    ? items.filter((i) => order.lines.some((l) => l.itemId === i.id) && !lines.some((l) => l.itemId === i.id))
    : items;

  const removeLine = (key: number) =>
    setLines((ls) => (ls.length === 1 ? ls : ls.filter((l) => l.key !== key)));

  // Per entered unit: five cartons at 12,000 is sixty thousand, whatever a
  // carton holds. The pieces are the engine's business, not this total's.
  const amount = (l: Line) => (Number(l.qty) || 0) * (Number(l.unitCost) || 0);
  const total = lines.reduce((s, l) => s + amount(l), 0);

  // A line with goods on it and nothing in the cost column. It posts — a
  // supplier's free sample really does arrive at nothing — but it puts stock
  // on the shelf that the balance sheet says is worth nothing, and the FIFO
  // layer it creates will charge a later sale nothing for it. Worth saying
  // out loud rather than discovering in a margin report.
  const freeLines = lines.filter(
    (l) => l.itemId && Number(l.qty) > 0 && !(Number(l.unitCost) > 0));

  // A matched receipt can carry a line the invoice never billed — someone
  // adds an item that turned up in the same delivery. It posts, and it should:
  // the goods arrived. But its value is not settling anything, and rolled into
  // one total it reads as though it were. 7,040 received against a bill for
  // 70,000 was 7,000 of the billed item and 40 of an item nobody had billed.
  const unbilled = matchedPi
    ? lines.filter((l) => l.itemId && !matchedPi.lines.some((pl) => pl.itemId === l.itemId))
    : [];
  const unbilledValue = unbilled.reduce((s, l) => s + amount(l), 0);

  const qtyMismatches = matchedPi
    ? lines.filter((l) => {
        const billedLine = matchedPi.lines.find((pl) => pl.itemId === l.itemId);
        return billedLine && Number(l.qty) !== billedLine.qty;
      })
    : [];

  const payload = JSON.stringify(
    lines
      .filter((l) => l.itemId && Number(l.qty) > 0)
      .map((l) => ({
        itemId: l.itemId, qty: Number(l.qty), unitCost: Number(l.unitCost) || 0,
        uomId: l.uomId || null,
        sourceLineId: l.sourceLineId ?? null,
        batchNo: l.batchNo?.trim() || null,
        expiryDate: l.expiryDate || null,
        serials: (l.serials ?? []).map((x) => x.serial.trim()).filter(Boolean),
        unitDetails: (l.serials ?? []).filter((x) => x.serial.trim() && (x.imei2?.trim() || x.deviceSerial?.trim()))
          .map((x) => ({ serial: x.serial.trim(), imei2: x.imei2?.trim() || null, deviceSerial: x.deviceSerial?.trim() || null })),
      }))
  );

  // A phone line whose IMEI count is not its quantity cannot post; saying so
  // here saves a round trip to be told.
  const entered = (l: Line) => (l.serials ?? []).filter((x) => x.serial.trim()).length;
  // IMEI for phones and cellular devices; a serial number for Macs, AirPods
  // and Wi-Fi iPads.
  const modeOf = (l: Line): UnitMode => (byId(l.itemId)?.identity === "SERIAL" ? "SERIAL" : "IMEI");
  // Every IMEI and serial on the receipt, checked against the books as it is
  // scanned: a phone already received is flagged on its row, not at Post.
  const [onFile, setOnFile] = useState<OnFile>({});
  const serialKey = [...new Set(lines.flatMap((l) => (l.serials ?? [])
    .flatMap((u) => [u.serial, u.imei2 ?? "", u.deviceSerial ?? ""]))
    .map((x) => x.trim()).filter((x) => x.length >= 5))].sort().join(",");
  useEffect(() => {
    if (!serialKey) { setOnFile({}); return; }
    const t = setTimeout(() => { serialsOnFile(serialKey.split(",")).then(setOnFile).catch(() => {}); }, 300);
    return () => clearTimeout(t);
  }, [serialKey]);
  const serialShort = lines.filter((l) => byId(l.itemId)?.tracks_serial && Number(l.qty) > 0
    && (entered(l) !== Number(l.qty) || rowsProblem(l.serials ?? [], modeOf(l), onFile)));
  const tracked = lines.filter((l) => byId(l.itemId)?.tracks_serial && Number(l.qty) > 0);
  const imeiLine = tracked.find((l) => l.key === imeiKey) ?? tracked[0] ?? null;
  const supplier = suppliers.find((s) => s.id === partnerId) ?? null;
  const units = lines.reduce((s, l) => s + (l.itemId ? Number(l.qty) || 0 : 0), 0);
  const baseTotal = foreign && !matchedPi && Number(rate) > 0 ? total * Number(rate) : total;
  const lineCols = 8 + (order ? 1 : 0) + (matchedPi ? 1 : 0);

  // Received against an order but not on it: posts, but the order counts
  // only what it ordered, so it is asked about once before posting.
  const offOrder = order
    ? lines.filter((l) => l.itemId && Number(l.qty) > 0 && !order.lines.some((ol) => ol.itemId === l.itemId))
    : [];
  const [askOffOrder, setAskOffOrder] = useState(false);
  const offOrderOk = useRef(false);
  const postRef = useRef<HTMLButtonElement>(null);

  return (
    <form action={formAction} className="form wide gr">
      {/* One submission, one posting. Generated when this form mounts, so a
          double-click or a resent request carries the same key and is handed
          the document the first one posted; a new form is a new key. */}
      <input type="hidden" name="idempotency_key" value={attemptKey} />
      <input type="hidden" name="lines" value={payload} />
      <input type="hidden" name="source_document_id" value={matchedPiId || order?.id || ""} />
      {saveDraft && (
        <>
          <input type="hidden" name="draft_id" value={draftId} />
          {order && <input type="hidden" name="draft_order_id" value={order.id} />}
          <input type="hidden" name="draft_state"
            value={JSON.stringify({ lines: lines.map((l) => ({ ...l, sourceLineId: order ? l.sourceLineId : null })),
              partnerId, currency, rate, docDate, locationId })} />
        </>
      )}

      {/* The document's own header: what it is, where it stands, and the two
          things to do with it — kept in view rather than at the foot. */}
      <div className="gr-head">
        <Link href="/purchases/receive" className="gr-back" aria-label="Back to goods receipts">
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
        <div className="gr-title">
          <h1>Goods Receipt <span className="pill draft">{draftId ? "Draft" : "New"}</span></h1>
          {order && (
            <p className="page-sub">
              Receiving against <Link href={`/documents/${order.id}`}>{order.docNo}</Link>
            </p>
          )}
        </div>
        <div className="gr-actions">
          {saveDraft && (
            <button type="submit" formAction={draftAction} formNoValidate className="ghost"
              disabled={savingDraft || pending}>
              {savingDraft ? "Saving…" : draftId ? "Update draft" : "Save draft"}
            </button>
          )}
          <button type="submit" ref={postRef} disabled={pending || total === 0 || serialShort.length > 0}
            onClick={(e) => {
              if (offOrder.length > 0 && !offOrderOk.current) { e.preventDefault(); setAskOffOrder(true); }
            }}>
            {pending ? "Posting…" : "Post GR"}
          </button>
          {order && (
            <OffOrderConfirm open={askOffOrder} orderNo={order.docNo}
              lines={offOrder.map((l) => ({ name: byId(l.itemId)?.name ?? "Item", qty: Number(l.qty) }))}
              onCancel={() => setAskOffOrder(false)}
              onConfirm={() => { setAskOffOrder(false); offOrderOk.current = true; postRef.current?.click(); offOrderOk.current = false; }} />
          )}
        </div>
      </div>

      {state && "error" in state && <div className="alert">{state.error}</div>}
      {draftResult && "error" in draftResult && <div className="alert">{draftResult.error}</div>}
      {draftResult && "ok" in draftResult && !savingDraft && (
        <div className="hint" role="status">Draft saved — nothing is in stock until it posts.</div>
      )}
      {serialShort.length > 0 && (
        <div className="hint low" role="status">
          Every unit needs a valid IMEI or serial number before posting:{" "}
          {serialShort.map((l) => `${byId(l.itemId)?.name ?? ""} ${entered(l)}/${l.qty}`).join(", ")}
        </div>
      )}

      <div className="gr-top">
        <div className="card compact">
          <div className="card-head"><h2><ClipboardList size={18} aria-hidden="true" /> GR information</h2></div>
          <div className="card-body">
            <div className="row">
              <div className="field">
                <label htmlFor="partner_id">Supplier</label>
                {order ? (
                  <>
                    <input type="hidden" name="partner_id" value={partnerId} />
                    <input type="text" value={supplier?.name ?? ""} readOnly aria-label="Supplier" />
                  </>
                ) : (
                  <PartnerPicker
                    partners={suppliers as never}
                    value={partnerId}
                    placeholder="Type a supplier…"
                    onPick={(id) => {
                      // Their invoice, and the lines it filled in, belong to the
                      // old supplier. Both go.
                      clearMatch(matchedPiId !== "");
                      setUnmatched(false);
                      setPartnerId(id);
                      // Their currency, at the latest rate on file.
                      const cur = suppliers.find((s) => s.id === id)?.currency || base;
                      fxSwitch.change(cur, cur === base ? "" : String(fx?.options.find((o) => o.code === cur)?.rate ?? ""));
                    }}
                  />
                )}
              </div>
              <div className="field">
                <label htmlFor="location_id">Warehouse</label>
                <WarehouseSelect locations={locations} id="location_id" name="location_id" value={locationId}
                        onChange={(e) => setLocationId(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="doc_date">GR date</label>
                <input id="doc_date" name="doc_date" type="date" value={docDate}
                  onChange={(e) => setDocDate(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="received_time">Time</label>
                <input id="received_time" name="received_time" type="time" value={receivedTime}
                  onChange={(e) => setReceivedTime(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="reference">Reference</label>
                <input id="reference" name="reference" type="text"
                  defaultValue={order ? `Against ${order.docNo}` : ""} placeholder="Delivery note no." />
              </div>
              {fx && !matchedPi && (
                <CurrencyRate options={fx.options} base={base} currency={currency} rate={rate}
                  date={docDate} pricesIn={fxSwitch.pricesIn}
                  onChange={fxSwitch.change} />
              )}
            </div>
            <div className="field" style={{ marginTop: 20 }}>
              <label htmlFor="memo">Remarks</label>
              <input id="memo" name="memo" type="text" placeholder="Optional — English or Myanmar" />
            </div>
          </div>
        </div>

        <div className="card gr-supplier">
          <div className="card-head"><h2><Building2 size={18} aria-hidden="true" /> Supplier info</h2></div>
          <div className="card-body">
            {supplier ? (
              <>
                <div className="gr-supplier-name">{supplier.name}</div>
                {supplier.company_name && <div className="subline">{supplier.company_name}</div>}
                <dl className="facts">
                  {(supplier.address || supplier.township || supplier.region) && (
                    <><dt>Address</dt><dd>{[supplier.address, supplier.township, supplier.region].filter(Boolean).join(", ")}</dd></>
                  )}
                  {supplier.phone && <><dt>Phone</dt><dd>{supplier.phone}</dd></>}
                  <dt>Currency</dt><dd>{supplier.currency || base}</dd>
                  {supplier.payment_terms_days != null && <><dt>Terms</dt><dd>{supplier.payment_terms_days} days</dd></>}
                </dl>
                <Link href={`/partners/${supplier.id}`} className="btn ghost" style={{ width: "100%", justifyContent: "center" }}>
                  View supplier
                </Link>
              </>
            ) : (
              <p className="subline">Choose a supplier to see their details.</p>
            )}
          </div>
        </div>
      </div>

      <MaybeSamePurchase lines={sameTwice} />

      {!order && partnerId && openInvoices.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>Supplier invoice</h2></div>
          <div className="card-body">
            <div className="field">
              <label htmlFor="source_document_id">Match an invoice waiting on these goods</label>
            <select id="source_document_id"
              value={matchedPiId || (unmatched ? NONE : "")}
              onChange={(e) => {
                if (e.target.value === NONE) {
                  clearMatch(matchedPiId !== "");
                  setUnmatched(true);
                } else if (e.target.value) {
                  matchInvoice(e.target.value);
                } else {
                  clearMatch(matchedPiId !== "");
                }
              }}
              disabled={!partnerId}>
              {/* An unanswered option only where there is a question. With no
                  supplier, or none of theirs waiting, it says which of those
                  it is; with several waiting it asks. With one waiting there
                  is nothing to ask, so the invoice itself is what shows, and
                  arriving without one moves to the bottom where a deliberate
                  answer belongs. */}
              {!partnerId && <option value="">Choose a supplier first</option>}
              {partnerId && openInvoices.length === 0 && (
                <option value="">No invoice is waiting for goods from this supplier</option>
              )}
              {partnerId && openInvoices.length > 1 && !matchedPiId && !unmatched && (
                <option value="">Which invoice are these goods for?</option>
              )}
              {openInvoices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.doc_no} · {shortDate(d.doc_date)} · {d.lines.length} line{d.lines.length === 1 ? "" : "s"}
                </option>
              ))}
              {partnerId && openInvoices.length > 0 && (
                <option value={NONE}>Not matched — these goods arrive without an invoice</option>
              )}
            </select>
            <span className="hint">
              {matchedPi
                ? autoMatched
                  ? `${matchedPi.doc_no} is the only invoice waiting on goods from this `
                    + "supplier, so it is matched and its lines are filled in. Check what "
                    + "actually arrived, or choose \u201cnot matched\u201d if these goods are "
                    + "for something else."
                  : "Lines are filled from that invoice — check what actually arrived before posting."
                : openInvoices.length > 0
                  ? `${openInvoices.length} invoice${openInvoices.length === 1 ? " is" : "s are"} `
                    + "waiting on goods from this supplier — billed already, and sitting in "
                    + "GR/IR clearing. Pick the one these goods are for, or leave it unmatched "
                    + "if they are for something else."
                  : partnerId
                    ? "Nothing this supplier has billed is still waiting on goods, so these "
                      + "arrive on their own and the invoice can follow."
                    : "If the supplier billed before the goods came, matching clears GR/IR "
                      + "against that invoice instead of opening a new one."}
            </span>
          </div>
        </div>
      </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2><Package size={18} aria-hidden="true" /> Items</h2>
          <span className="actions">
            {matchedPi && <span className="page-sub">filled from {matchedPi.doc_no}</span>}
            {!order && waitingOrders.length > 0 && (
              <details className="gr-frompo">
                <summary className="btn ghost">Add from PO <ChevronDown size={14} aria-hidden="true" /></summary>
                <div className="gr-frompo-menu">
                  {waitingOrders.map((o) => (
                    <Link key={o.orderId} href={`/purchases/receive/new?order=${o.orderId}`}>
                      <strong>{o.orderNo}</strong>
                      <span className="subline">{o.lines.map((l) => `${l.itemCode} ${fmt(l.qty)}`).join(", ")}</span>
                    </Link>
                  ))}
                </div>
              </details>
            )}
            <button type="button" onClick={addLine}><Plus size={15} aria-hidden="true" /> Add item</button>
          </span>
        </div>
        {!order && waitingOrders.length > 0 && (
          <p className="hint" style={{ padding: "10px 16px 0", margin: 0 }}>
            This supplier has {waitingOrders.length === 1 ? "an open purchase order" : `${waitingOrders.length} open purchase orders`}.
            Receiving without one leaves it open — use Add from PO if these goods answer it.
          </p>
        )}
        <AddItemsBar items={offered} categories={categories} onAdd={addPicks}
          available={order ? (id) => order.lines.filter((l) => l.itemId === id).reduce((t, l) => t + l.qty, 0) : undefined}
          availLabel={order ? "Outstanding" : undefined}
          empty={order ? "Every line of this order is already on the receipt." : undefined}
          title={order ? `Outstanding items from ${order.docNo}` : "Add products to goods receipt"}
          sub={order ? "Select the purchase order lines to add to this goods receipt" : "Search the full product catalogue"} />

        <div className="tablewrap">
          <table className="linetable grlines">
            <thead>
              <tr>
                <th className="r">#</th>
                <th>Item</th>
                {order && <th className="r">Ordered</th>}
                {matchedPi && <th className="r">Billed</th>}
                <th className="r">Receive qty</th>
                <th>Unit</th>
                <th className="r">Unit cost{foreign && !matchedPi ? ` (${currency})` : ""}</th>
                <th>IMEI / serial</th>
                <th className="r">Subtotal</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => {
                const item = byId(l.itemId);
                const billedLine = matchedPi?.lines.find(
                  (pl) => pl.lineId === l.sourceLineId || pl.itemId === l.itemId);
                const qtyMismatch = matchedPi && billedLine && Number(l.qty) !== billedLine.qty;
                const picking = !l.itemId || changing === l.key;
                const n = entered(l);
                const q = Number(l.qty) || 0;
                return (
                  <Fragment key={l.key}>
                    <tr className={imeiLine?.key === l.key ? "gr-current" : undefined}>
                      <td className="r subline">{idx + 1}</td>
                      <td style={{ minWidth: 240 }}>
                        {item && !picking ? (
                          <span className="prod">
                            <span className="thumb"><Smartphone size={18} aria-hidden="true" /></span>
                            <span>
                              <span className="prod-name codetip" data-code={item.code}>{item.name}</span>
                              {!l.sourceLineId && (
                                <span className="prod-sub" style={{ display: "block" }}>
                                  <button type="button" className="linkish" onClick={() => setChanging(l.key)}>Change</button>
                                </span>
                              )}
                            </span>
                          </span>
                        ) : (
                          <span className="subline">Choose below</span>
                        )}
                      </td>
                      {order && <td className="r">{l.ordered != null ? fmt(l.ordered) : "—"}</td>}
                      {matchedPi && (
                        <td className="r" style={{ color: qtyMismatch || (l.itemId && !billedLine) ? "var(--warn)" : undefined }}>
                          {billedLine ? fmt(billedLine.qty)
                            : l.itemId ? <span className="subline" style={{ color: "inherit" }}>not on this bill</span>
                              : "—"}
                        </td>
                      )}
                      <td className="narrow qtycell">
                        <input type="number" min="0" step="any" value={l.qty}
                          onChange={(e) => setLine(l.key, { qty: e.target.value })}
                          aria-label="Receive quantity"
                          style={qtyMismatch ? { borderColor: "var(--warn)" } : undefined} />
                      </td>
                      {/* Which unit this quantity is in. Only where the item
                          has packs — one option is a question already answered. */}
                      <td className="narrow unitcell">
                        {(item?.packs ?? []).length > 0 ? (
                          <select value={l.uomId ?? ""} onChange={(e) => setLine(l.key, { uomId: e.target.value })}
                            aria-label={`Unit for ${item?.code ?? "line"}`}>
                            <option value="">{item?.uom_code}</option>
                            {(item?.packs ?? []).map((p) => (
                              <option key={p.uomId} value={p.uomId}>{p.code} ({Number(p.factor)})</option>
                            ))}
                          </select>
                        ) : (
                          <span className="subline">{item?.uom_code ?? "—"}</span>
                        )}
                      </td>
                      <td className="narrow pricecell">
                        {/* The bill is the cost of these goods, so it is not
                            typed over here. Quantity stays the receiver's to
                            state: what arrived is what arrived. */}
                        <input type="number" min="0" step="any" value={l.unitCost}
                          onChange={(e) => setLine(l.key, { unitCost: e.target.value })}
                          aria-label="Unit cost"
                          readOnly={!!billedLine}
                          title={billedLine ? `Billed at ${fmt(billedLine.unitPrice)} on ${matchedPi?.doc_no}` : undefined}
                          style={billedLine ? { background: "var(--ground)", cursor: "not-allowed" } : undefined} />
                      </td>
                      <td>
                        {item?.tracks_serial ? (
                          <span className="gr-imei">
                            <span className={`pill ${q > 0 && n === q && !rowsProblem(l.serials ?? [], modeOf(l), onFile) ? "ok" : "warn"}`}>
                              {n} / {q} entered
                            </span>
                            <button type="button" className="dt-tool" onClick={() => setImeiKey(l.key)}
                              disabled={q === 0}>{modeOf(l) === "SERIAL" ? "View serials" : "View IMEIs"}</button>
                          </span>
                        ) : item?.variant ? (
                          <Link href={`/items/${item.id}`} target="_blank" className="subline">Not tracked — turn on</Link>
                        ) : (
                          <span className="subline">—</span>
                        )}
                      </td>
                      <td className="r">
                        {fmt(amount(l))}
                        {foreign && !matchedPi && Number(rate) > 0 && fxSwitch.pricesIn === currency && amount(l) > 0 && (
                          <span className="subline" style={{ display: "block" }}>≈ {fmt(amount(l) * Number(rate))} {base}</span>
                        )}
                      </td>
                      <td className="tight">
                        <button type="button" className="danger tiny" onClick={() => removeLine(l.key)}
                          aria-label="Remove line" disabled={lines.length === 1}>
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                    {picking && (
                      <tr className="gr-pickrow">
                        <td colSpan={lineCols}>
                          <div className="gr-pick">
                            <ItemPicker
                              mode="purchase"
                              items={items}
                              categories={categories}
                              uoms={uoms}
                              value={l.itemId}
                              onPick={(id) => { pickItem(l.key, id); setChanging(null); }}
                              onCreated={addItem}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {/* The lot, for items that keep one. On its own row beneath the
                  line rather than as two more columns: only some items need
                  it, and widening every receipt for the few that do would
                  squeeze the quantities and costs on all the rest. */}
              {lines.filter((l) => byId(l.itemId)?.tracks_batch).map((l) => {
                const item = byId(l.itemId)!;
                return (
                  <tr key={`batch-${l.key}`} className="batchrow">
                    <td colSpan={lineCols}>
                      <span className="batchrow-label">
                        {item.code} — which lot?
                      </span>
                      <input
                        type="text"
                        value={l.batchNo ?? ""}
                        onChange={(e) => setLine(l.key, { batchNo: e.target.value })}
                        placeholder="Batch number"
                        aria-label={`Batch number for ${item.code}`}
                      />
                      {item.tracks_expiry && (
                        <input
                          type="date"
                          value={l.expiryDate ?? ""}
                          onChange={(e) => setLine(l.key, { expiryDate: e.target.value })}
                          aria-label={`Expiry date for ${item.code}`}
                        />
                      )}
                      {/* Said, not refused. Goods do arrive already
                          expired — a supplier ships short-dated stock and it
                          has to be recorded before it can be returned — so
                          the form notices out loud and lets the posting
                          through. Compared against the document date rather
                          than today, or every back-dated receipt would trip
                          it. */}
                      {l.expiryDate && docDate && l.expiryDate <= docDate ? (
                        <span className="hint" style={{ color: "var(--warn)" }}>
                          Already expired on the receipt date — it will post,
                          and land in Expired on the stock page.
                        </span>
                      ) : (
                        <span className="hint">
                          {item.tracks_expiry
                            ? "Both required — sold before any batch that lasts longer."
                            : "Required — recorded so a recall can name these units."}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {matchedPi && (
        <div className="hint" style={{ marginBottom: "0.75rem" }}>
          Unit cost comes from {matchedPi.doc_no} and is not editable here — the
          bill is what these goods cost, and a figure typed over it would land
          in the profit and loss as a gain or loss on buying stock. If the bill
          itself is wrong,{" "}
          <Link href={`/documents/${matchedPi.id}`} style={{ color: "var(--link)" }}>
            correct {matchedPi.doc_no}
          </Link>
          {" "}and receive against the corrected one. Freight and duties belong
          in the stock value too, but they are costs of their own with
          documents behind them — not a number typed into this column.
        </div>
      )}

      {qtyMismatches.length > 0 && (
        <div className="alert" style={{ borderColor: "var(--warn)", color: "var(--warn)", background: "color-mix(in srgb, var(--warn) 8%, transparent)" }}>
          Received quantity doesn&rsquo;t match what {matchedPi?.doc_no} billed for{" "}
          {qtyMismatches.map((l) => byId(l.itemId)?.code ?? matchedPi?.lines.find((pl) => pl.itemId === l.itemId)?.itemCode).join(", ")}.
          Not blocked — a short shipment can be legitimate — but check before posting.
        </div>
      )}

      {freeLines.length > 0 && (
        <div className="alert" style={{ marginBottom: "0.75rem" }}>
          <strong>
            {freeLines.length === 1 ? "One line has" : `${freeLines.length} lines have`} a
            quantity but no unit cost.
          </strong>{" "}
          {freeLines.map((l) => byId(l.itemId)?.code).filter(Boolean).join(", ")} would
          arrive worth nothing, and a later sale would draw them at nothing.
          {matchedPi
            ? " The matched invoice carries the prices — reselect it to fill them in."
            : openInvoices.length > 0
              ? " If the supplier already billed for these, matching that invoice fills in what they cost."
              : " Enter what they cost, or post it deliberately if they really were free."}
        </div>
      )}


      <div className="gr-bottom">
        <div className="card">
          {imeiLine ? (
            <ImeiPanel
              mode={modeOf(imeiLine)}
              title={byId(imeiLine.itemId)?.name ?? ""}
              qty={Number(imeiLine.qty) || 0}
              rows={imeiLine.serials ?? []}
              onChange={(rows) => setLine(imeiLine.key, { serials: rows })}
              onFile={onFile}
            />
          ) : (
            <div className="card-body subline">
              IMEI or serial entry opens here for any item tracked unit by unit — one row per unit received.
            </div>
          )}
        </div>

        <div className="gr-side">
          <div className="card">
            <div className="card-head"><h2>Summary{foreign && !matchedPi ? ` (${currency})` : ` (${base})`}</h2></div>
            <div className="card-body">
              <dl className="gr-sum">
                <dt>Lines</dt><dd>{lines.filter((l) => l.itemId).length}</dd>
                <dt>Units</dt><dd>{fmt(units)}</dd>
                {matchedPi && unbilledValue > 0 && (
                  <><dt>Not on {matchedPi.doc_no}</dt><dd>{fmt(unbilledValue)}</dd></>
                )}
              </dl>
              <div className="gr-total">
                <span>Total</span>
                <span>
                  {fmt(total)}
                  {foreign && !matchedPi && Number(rate) > 0 && (
                    <span className="subline" style={{ display: "block", textAlign: "right" }}>
                      ≈ {fmt(baseTotal)} {base} at {Number(rate).toLocaleString("en-US")}
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>

          <details className="card gr-preview">
            <summary className="card-head">
              <h2>Posting preview</h2>
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <div className="card-body">
              <table>
                <thead><tr><th>Account</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
                <tbody>
                  <tr><td>Inventory</td><td className="r">{fmt(baseTotal)}</td><td /></tr>
                  <tr><td>GR/IR clearing{matchedPi ? ` (clears ${matchedPi.doc_no})` : ""}</td><td /><td className="r">{fmt(baseTotal)}</td></tr>
                </tbody>
              </table>
              <p className="subline" style={{ marginTop: 8 }}>
                Stock arrives at this cost. The supplier&rsquo;s invoice posts separately and clears GR/IR.
              </p>
            </div>
          </details>
        </div>
      </div>
    </form>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Users } from "lucide-react";
import { type VariantPart } from "@/components/variant-tags";
import { stockUnits, stockMoves, stockCost, type StockUnit, type StockMove, type StockCost } from "@/lib/stock-detail";

/**
 * One sellable item's stock position — a variant, or an item that has none —
 * with its detail folded underneath in four tabs.
 *
 * The line carries what is read at a glance: on hand, spoken for, available,
 * what it cost and what it is worth. Variant details and the warehouse
 * breakdown are already on the page; the units by IMEI and the recent
 * movements are asked for when their tab is opened, one item at a time.
 */

export type StockWarehouseRow = {
  locationId: string; code: string; name: string;
  onHand: number;
  /** Held here but owned by a consignor. Never part of onHand. */
  consigned: number;
  reserved: number;
};

export type StockRowItem = {
  id: string; code: string; name: string; nameMy: string | null;
  /** The product it is a configuration of; its own name for a plain item. */
  model: string;
  itemGroupId: string; category: string; uomCode: string;
  barcode: string | null; brandName: string | null;
  onHand: number; consignedQty: number; reservedQty: number; available: number;
  incomingQty: number; projected: number; valueOnHand: number;
  lastCost: string | null; lastCostDocNo: string | null; lastCostDocId: string | null; lastCostDate: string | null;
  /** Empty when this item carries no consigned stock. */
  consignors: string[];
  warehouses: StockWarehouseRow[];
  batches: { locationCode: string; batchNo: string | null; expiryDate: string | null; daysLeft: number | null; qty: number }[];
  tracksBatch: boolean; tracksExpiry: boolean;
  /** IMEI or serial: its units have names. */
  tracksSerial: boolean;
  /** Which storage, colour and region. Null for an item with no variants. */
  variant: VariantPart[] | null;
  photoSrc: string | null;
  status: "IN" | "LOW" | "OUT";
};

const money = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const qty = (v: number) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
const DASH = "—";
const EXPIRING_DAYS = 90;
const DOC: Record<string, string> = {
  GOODS_RECEIPT: "Goods receipt", SALES_INVOICE: "Sale", DELIVERY: "Delivery", STOCK_TRANSFER: "Transfer",
  STOCK_ADJUSTMENT: "Adjustment", SALES_RETURN: "Customer return", PURCHASE_RETURN: "Return to supplier",
  OPENING_BALANCE: "Opening balance",
};

export function StockStatus({ s }: { s: StockRowItem["status"] }) {
  return <span className={`inv-status ${s === "IN" ? "ok" : s === "LOW" ? "low" : "out"}`}>
    {s === "IN" ? "In stock" : s === "LOW" ? "Low stock" : "Out of stock"}
  </span>;
}

export function StockRow({ item, columnCount, showConsigned }:
  { item: StockRowItem; columnCount: number; showConsigned: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"details" | "warehouses" | "units" | "moves">("details");
  const parts = item.variant ?? [];
  const avg = item.onHand > 0 ? item.valueOnHand / item.onHand : null;

  return (
    <>
      <tr className={`stockrow${open ? " is-open" : ""}`} data-open={open || undefined}>
        <td className="expandcell">
          <button type="button" className="rowexpand" aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} details of ${item.name}`} onClick={() => setOpen(!open)}>
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </td>
        <td className="code" title={item.code}>{item.code}</td>
        <td className="wrap">
          <button type="button" className="stk-prod" onClick={() => setOpen(!open)}>
            {item.photoSrc && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="stk-thumb" src={item.photoSrc} alt="" />
            )}
            <span>
              <strong className="clamp2">{item.model}</strong>
              <span className="stk-sub">
                {parts.length ? parts.map((p) => p.o).join(" · ") : item.category}
                {item.consignors.length > 0 && <> · <Users size={11} aria-hidden="true" /> consigned</>}
              </span>
            </span>
          </button>
        </td>
        <td className="r stk-onhand">{qty(item.onHand)}</td>
        {showConsigned && (
          <td className="r">{item.consignedQty > 0
            ? <Link href="/inventory/consignment" style={{ color: "var(--link)" }}>{qty(item.consignedQty)}</Link> : DASH}</td>
        )}
        <td className="r" style={{ color: item.reservedQty > 0 ? "var(--warn)" : undefined }}>
          {item.reservedQty > 0 ? qty(item.reservedQty) : DASH}
        </td>
        <td className="r" style={{ fontWeight: 600 }}>{qty(item.available)}</td>
        <td className="r">{avg === null ? DASH : money(avg)}</td>
        <td className="r">{money(item.valueOnHand)}</td>
        <td><StockStatus s={item.status} /></td>
      </tr>

      {open && (
        <tr className="stockdetail-row">
          <td colSpan={columnCount}>
            <nav className="stk-tabs" role="tablist">
              {([["details", "Variant details"], ["warehouses", "Warehouse breakdown"],
                 ...(item.tracksSerial ? [["units", `${item.uomCode === "PCS" ? "IMEI" : "IMEI / serial"} list (${qty(item.onHand)})`]] : []),
                 ["moves", "Recent transactions"]] as [typeof tab, string][]).map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k}
                  className={tab === k ? "stk-tab on" : "stk-tab"} onClick={() => setTab(k)}>{label}</button>
              ))}
            </nav>
            {tab === "details" && <Details item={item} parts={parts} avg={avg} />}
            {tab === "warehouses" && <>
              <Warehouses item={item} wide />
              {item.incomingQty > 0 && (
                <p className="hint">{qty(item.incomingQty)} on order · {qty(item.projected)} projected once it arrives.</p>
              )}
            </>}
            {tab === "units" && <Units itemId={item.id} />}
            {tab === "moves" && <Moves itemId={item.id} />}
          </td>
        </tr>
      )}
    </>
  );
}

function Details({ item, parts, avg }: { item: StockRowItem; parts: VariantPart[]; avg: number | null }) {
  const expired = item.batches.filter((b) => b.daysLeft !== null && b.daysLeft < 0).length;
  const soon = item.batches.filter((b) => b.daysLeft !== null && b.daysLeft >= 0 && b.daysLeft <= EXPIRING_DAYS).length;
  return (
    <div className="stk-detail">
      <section>
        <h3>{parts.length ? "Variant information" : "Item information"}</h3>
        <dl className="stk-kv">
          <div><dt>Product</dt><dd>{item.model}</dd></div>
          {parts.map((p) => <div key={p.a}><dt>{p.a}</dt><dd>{p.o}</dd></div>)}
          <div><dt>SKU</dt><dd className="code">{item.code}</dd></div>
          <div><dt>Barcode</dt><dd className="code">{item.barcode ?? DASH}</dd></div>
          <div><dt>Category</dt><dd>{item.category}</dd></div>
          {item.brandName && <div><dt>Brand</dt><dd>{item.brandName}</dd></div>}
          {item.consignors.length > 0 && <div><dt>Consignor</dt><dd>{item.consignors.join(", ")}</dd></div>}
        </dl>
      </section>
      <section>
        <h3>Cost information (MMK)</h3>
        <CostInfo item={item} avg={avg} />
        {item.consignors.length > 0 && <p className="hint">Consigned units are not the shop&apos;s stock and carry no value here.</p>}
      </section>
      {item.tracksBatch && (
        <section className="wide">
          <h3>Batches on hand
            {soon > 0 && <span className="pill warn" style={{ marginLeft: 8 }}>{soon} expiring</span>}
            {expired > 0 && <span className="pill overdue" style={{ marginLeft: 6 }}>{expired} expired</span>}
          </h3>
          {item.batches.length === 0 ? <p className="hint">Nothing batched yet.</p> : (
            <table className="stk-table">
              <thead><tr><th>Batch</th><th>Warehouse</th>{item.tracksExpiry && <th>Expires</th>}<th className="r">On hand</th></tr></thead>
              <tbody>
                {item.batches.map((b, i) => (
                  <tr key={`${b.batchNo}-${b.locationCode}-${i}`}>
                    <td className="code">{b.batchNo ?? DASH}</td><td className="code">{b.locationCode}</td>
                    {item.tracksExpiry && <td className="code">{b.expiryDate ?? DASH}</td>}
                    <td className="r">{qty(b.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}

/**
 * Average cost and stock value from the page, then the latest receipt's unit
 * built up: supplier price in its currency, the rate, kyat, each landed cost
 * per unit, and the total a unit of that receipt cost.
 */
function CostInfo({ item, avg }: { item: StockRowItem; avg: number | null }) {
  const s = useOnce<StockCost | null>(() => stockCost(item.id));
  const c = s.data;
  const foreign = !!c && c.currency !== "MMK";
  return (
    <dl className="stk-kv">
      <div><dt>Average cost</dt><dd className="r">{avg === null ? DASH : money(avg)}</dd></div>
      {s.error && <div className="hint" style={{ color: "var(--bad)" }}>{s.error}</div>}
      {!s.data && !s.error && s.data !== null && <div className="hint">Loading…</div>}
      {c && (
        <>
          <div><dt>Latest receipt</dt><dd className="r">
            <Link href={`/documents/${c.receiptId}`}>{c.receiptNo ?? DASH}</Link>
            <span className="subline"> · {c.receiptDate}</span></dd></div>
          {foreign && <>
            <div><dt>Last purchase price</dt><dd className="r">{c.currency} {c.fcUnitPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}</dd></div>
            <div><dt>Exchange rate</dt><dd className="r">{c.rate.toLocaleString("en-US", { maximumFractionDigits: 4 })}</dd></div>
          </>}
          <div><dt>{foreign ? "Purchase cost (MMK)" : "Last purchase price"}</dt><dd className="r">{money(c.unitCost)}</dd></div>
          {c.landed.map((l) => (
            <div key={l.type}><dt>{l.type}</dt><dd className="r">{money(l.perUnit)}</dd></div>
          ))}
          <div className="total"><dt>Total unit cost</dt><dd className="r">{money(c.totalUnitCost)}</dd></div>
        </>
      )}
      <div className={c ? undefined : "total"}><dt>Stock value</dt><dd className="r">{money(item.valueOnHand)}</dd></div>
    </dl>
  );
}

function Warehouses({ item, wide = false }: { item: StockRowItem; wide?: boolean }) {
  const anyConsigned = item.warehouses.some((w) => w.consigned > 0);
  if (item.warehouses.length === 0) return <p className="hint">Not held in any warehouse.</p>;
  return (
    <table className={`stk-table${wide ? " wide" : ""}`}>
      <thead>
        <tr><th>Warehouse</th><th className="r">On hand</th>{anyConsigned && <th className="r">Consigned</th>}
          <th className="r">Reserved</th><th className="r">Available</th></tr>
      </thead>
      <tbody>
        {item.warehouses.map((w) => (
          <tr key={w.locationId}>
            <td>{w.name || w.code}</td><td className="r">{qty(w.onHand)}</td>
            {anyConsigned && <td className="r">{w.consigned > 0 ? qty(w.consigned) : DASH}</td>}
            <td className="r">{w.reserved > 0 ? qty(w.reserved) : DASH}</td>
            <td className="r">{qty(w.onHand - w.reserved)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr><td>Total</td><td className="r">{qty(item.onHand)}</td>{anyConsigned && <td className="r">{qty(item.consignedQty)}</td>}
          <td className="r">{item.reservedQty > 0 ? qty(item.reservedQty) : DASH}</td><td className="r">{qty(item.available)}</td></tr>
      </tfoot>
    </table>
  );
}

/** One tab's rows, fetched the first time it is shown. */
function useOnce<T>(load: () => Promise<T>) {
  const [s, set] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    let live = true;
    load().then((data) => live && set({ data })).catch((e) => live && set({ error: String(e?.message ?? e) }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return s;
}

function Units({ itemId }: { itemId: string }) {
  const s = useOnce<StockUnit[]>(() => stockUnits(itemId));
  if (s.error) return <p className="hint" style={{ color: "var(--bad)" }}>{s.error}</p>;
  if (!s.data) return <p className="hint">Loading…</p>;
  if (s.data.length === 0) return <p className="hint">No units on hand.</p>;
  const cost = s.data.some((u) => u.unitCost !== null);
  return (
    <table className="stk-table wide">
      <thead><tr><th>IMEI / serial</th><th>Warehouse</th><th>Status</th><th>Received</th>{cost && <th className="r">Unit cost</th>}</tr></thead>
      <tbody>
        {s.data.map((u) => (
          <tr key={u.id}>
            <td className="code"><Link href={`/inventory/phones/${u.id}`}>{u.imei}</Link>{u.imei2 && <span className="subline"> · {u.imei2}</span>}</td>
            <td>{u.location ?? DASH}</td>
            <td>{u.status === "IN_STOCK" ? <span className="inv-status ok">On shelf</span>
              : <span className="inv-status low">{u.status.replace(/_/g, " ").toLowerCase()}</span>}</td>
            <td>{u.receivedId ? <Link href={`/documents/${u.receivedId}`}>{u.receivedOn}</Link> : (u.receivedOn ?? DASH)}
              {u.receivedDate && <span className="subline"> · {u.receivedDate}</span>}</td>
            {cost && <td className="r">{u.unitCost === null ? DASH : money(u.unitCost)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Moves({ itemId }: { itemId: string }) {
  const s = useOnce<StockMove[]>(() => stockMoves(itemId));
  if (s.error) return <p className="hint" style={{ color: "var(--bad)" }}>{s.error}</p>;
  if (!s.data) return <p className="hint">Loading…</p>;
  if (s.data.length === 0) return <p className="hint">Nothing has moved yet.</p>;
  return (
    <table className="stk-table wide">
      <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Warehouse</th><th className="r">Qty</th></tr></thead>
      <tbody>
        {s.data.map((m) => (
          <tr key={m.id}>
            <td>{m.date}</td><td>{m.docType ? DOC[m.docType] ?? m.docType.replace(/_/g, " ").toLowerCase() : DASH}</td>
            <td>{m.documentId ? <Link href={`/documents/${m.documentId}`}>{m.docNo ?? DASH}</Link> : DASH}</td>
            <td>{m.location}</td>
            <td className={`r ${m.qty > 0 ? "ok-qty" : "bad"}`}>{m.qty > 0 ? `+${qty(m.qty)}` : qty(m.qty)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

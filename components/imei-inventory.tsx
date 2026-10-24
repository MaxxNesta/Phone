"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ChevronLeft, ChevronRight, X, Copy, Check, FileText, Package, Truck, Tag, Lock, Unlock, ArrowRightLeft,
  RotateCcw, ShoppingBag, Wrench, ExternalLink, Pencil, Layers, Undo2, Info,
} from "lucide-react";
import { imeiDrawer, type ImeiDrawerData } from "@/lib/imei-drawer";

export type ImeiRow = {
  serial_id: string; imei: string; item_name: string; item_code: string; photo: string | null;
  location_name: string | null; unit_cost?: number | null; price: number | null; status: string; was_returned: boolean;
};
type Tab = "overview" | "cost" | "prices" | "activity";

const money = (v: number | null | undefined) => v == null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const STATUS_TONE: Record<string, string> = { IN_STOCK: "ok", SOLD: "posted" };

export function StatusPill({ s, label }: { s: string; label: string }) {
  return <span className={`imei-pill ${STATUS_TONE[s] ?? "warn"}`}>{label}</span>;
}

/**
 * The page's list and its one drawer. A row opens the drawer on Overview; its
 * cost or price cell opens it on that tab. The open unit and tab ride in the
 * URL (?unit=&tab=) so a drawer can be linked and survives a reload.
 */
export function ImeiTable({ rows, showCost, showLocation, emptyLabel }: {
  rows: ImeiRow[]; showCost: boolean; showLocation: boolean; emptyLabel: string;
}) {
  const t = useTranslations("inventory");
  const label = (s: string) => (t.has(`status.${s}`) ? t(`status.${s}`) : s);
  const [open, setOpen] = useState<{ id: string; tab: Tab } | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get("unit");
    if (id) setOpen({ id, tab: (q.get("tab") as Tab) || "overview" });
  }, []);
  const sync = useCallback((v: { id: string; tab: Tab } | null) => {
    setOpen(v);
    const q = new URLSearchParams(window.location.search);
    if (v) { q.set("unit", v.id); q.set("tab", v.tab); } else { q.delete("unit"); q.delete("tab"); }
    const s = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${s ? `?${s}` : ""}`);
  }, []);
  const show = (id: string, tab: Tab) => (e: React.MouseEvent) => { e.stopPropagation(); sync({ id, tab }); };
  const at = open ? rows.findIndex((r) => r.serial_id === open.id) : -1;

  return (
    <>
      <div className="imei-tablewrap">
        <table className="imei-table">
          <thead>
            <tr>
              <th>Product / Variant</th>
              <th>IMEI / Serial</th>
              {showLocation && <th>Location</th>}
              {showCost && <th className="num">Unit Cost (MMK)</th>}
              <th className="num">Selling Price (MMK)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.serial_id} className={open?.id === r.serial_id ? "on" : undefined}
                onClick={() => sync({ id: r.serial_id, tab: "overview" })}>
                <td>
                  <span className="imei-prod">
                    {r.photo
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={r.photo} alt="" className="imei-thumb" />
                      : <span className="imei-thumb blank" aria-hidden="true" />}
                    <span>
                      <button type="button" className="imei-name" onClick={show(r.serial_id, "overview")}>{r.item_name}</button>
                      <span className="imei-code">{r.item_code}</span>
                    </span>
                  </span>
                </td>
                <td className="m">{r.imei}</td>
                {showLocation && <td>{r.location_name ?? "—"}</td>}
                {showCost && (
                  <td className="num"><button type="button" className="imei-cell" onClick={show(r.serial_id, "cost")}
                    aria-label={`Cost details of ${r.imei}`}>{money(r.unit_cost)}</button></td>
                )}
                <td className="num"><button type="button" className="imei-cell" onClick={show(r.serial_id, "prices")}
                  aria-label={`Selling prices of ${r.imei}`}>{money(r.price)}</button></td>
                <td>
                  <StatusPill s={r.status} label={label(r.status)} />
                  {r.was_returned && <span className="imei-pill warn">{t("ph.returned")}</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4 + (showCost ? 1 : 0) + (showLocation ? 1 : 0)} className="imei-empty">{emptyLabel}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {open && (
        <ImeiDrawer key={open.id} id={open.id} tab={open.tab}
          onTab={(tab) => sync({ id: open.id, tab })}
          onClose={() => sync(null)}
          prev={at > 0 ? () => sync({ id: rows[at - 1].serial_id, tab: open.tab }) : undefined}
          next={at >= 0 && at < rows.length - 1 ? () => sync({ id: rows[at + 1].serial_id, tab: open.tab }) : undefined} />
      )}
    </>
  );
}

function ImeiDrawer({ id, tab, onTab, onClose, prev, next }: {
  id: string; tab: Tab; onTab: (t: Tab) => void; onClose: () => void; prev?: () => void; next?: () => void;
}) {
  const t = useTranslations("inventory");
  const label = (s: string) => (t.has(`status.${s}`) ? t(`status.${s}`) : s);
  const [data, setData] = useState<ImeiDrawerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    let live = true;
    imeiDrawer(id).then((d) => live && setData(d)).catch((e) => live && setError(String(e?.message ?? e)));
    return () => { live = false; };
  }, [id]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowUp" && prev && e.altKey) prev();
      if (e.key === "ArrowDown" && next && e.altKey) next();
    };
    window.addEventListener("keydown", key);
    panel.current?.focus();
    return () => window.removeEventListener("keydown", key);
  }, [onClose, prev, next]);

  const u = data?.unit;
  const cost = data?.unitCost ?? null;
  const price = data?.price ?? null;
  const profit = cost != null && price != null ? price - cost : null;
  const tabs: [Tab, string][] = [["overview", "Overview"], ...(data?.cost ? [["cost", "Cost Details"] as [Tab, string]] : []),
    ["prices", "Selling Prices"], ["activity", "Activity"]];
  const current = tab === "cost" && data && !data.cost ? "overview" : tab;

  return (
    <aside ref={panel} className="imei-drawer" role="dialog" aria-modal="false" aria-labelledby="imei-drawer-title" tabIndex={-1}>
      <header className="imei-dhead">
        <span className="imei-nav">
          <button type="button" onClick={prev} disabled={!prev} aria-label="Previous unit"><ChevronLeft size={16} /></button>
          <button type="button" onClick={next} disabled={!next} aria-label="Next unit"><ChevronRight size={16} /></button>
        </span>
        <h2 id="imei-drawer-title">IMEI Details</h2>
        <button type="button" className="imei-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </header>

      <div className="imei-dbody">
        {error ? <p className="imei-error">{error}</p> : !data || !u ? <DrawerSkeleton /> : (
          <>
            <section className="imei-unit">
              {u.photo
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={u.photo} alt="" className="imei-photo" />
                : <span className="imei-photo blank" aria-hidden="true"><Package size={28} /></span>}
              <div className="imei-unit-text">
                <h3>{u.itemName}</h3>
                <p>{u.parts.map((p) => p.o).join(" · ") || u.model}</p>
                <p className="imei-code">{u.itemCode}</p>
              </div>
              <StatusPill s={u.status} label={label(u.status)} />
            </section>

            <dl className="imei-ids">
              <div><dt>IMEI</dt><dd className="m">{u.imei}
                <button type="button" className="imei-copy" aria-label="Copy IMEI"
                  onClick={() => { navigator.clipboard?.writeText(u.imei); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button></dd></div>
              <div><dt>Serial</dt><dd className="m">{u.deviceSerial ?? u.imei2 ?? "—"}</dd></div>
              <div><dt>Location</dt><dd>{u.location ?? "—"}</dd></div>
              <div><dt>Ownership</dt><dd>Company-owned</dd></div>
            </dl>

            <div className="imei-money">
              {cost != null && (
                <button type="button" className="imei-mcard" onClick={() => onTab("cost")}>
                  <span>Unit Cost</span><strong>{money(cost)} MMK</strong>
                  <small>{data.cost?.landed.length ? "Incl. landed cost" : "FIFO layer cost"}</small>
                </button>
              )}
              <button type="button" className="imei-mcard" onClick={() => onTab("prices")}>
                <span>Selling Price</span><strong>{money(price)}{price != null ? " MMK" : ""}</strong>
                <small>{data.priceLevel ? `${data.priceLevel} level` : "No price set"}</small>
              </button>
              {profit != null && (
                <div className="imei-mcard wide">
                  <span className="imei-split">
                    <span><span>Potential Gross Profit</span><strong className={profit < 0 ? "neg" : undefined}>{money(profit)} MMK</strong></span>
                    <span><span>Gross Margin</span><strong className={profit < 0 ? "neg" : undefined}>{price ? pct(profit / price) : "—"}</strong></span>
                  </span>
                </div>
              )}
            </div>

            <nav className="imei-tabs" role="tablist" aria-label="Unit details">
              {tabs.map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={current === k} onClick={() => onTab(k)}>{l}</button>
              ))}
            </nav>

            {current === "overview" && <Overview d={data} label={label} onTab={onTab} />}
            {current === "cost" && data.cost && <CostTab d={data} />}
            {current === "prices" && <PricesTab d={data} />}
            {current === "activity" && <ActivityTab d={data} t={t} />}
          </>
        )}
      </div>
    </aside>
  );
}

function DrawerSkeleton() {
  return (
    <div className="imei-skel" aria-busy="true" aria-label="Loading">
      <span style={{ height: 72 }} /><span style={{ height: 44 }} /><span style={{ height: 96 }} /><span style={{ height: 220 }} />
    </div>
  );
}

const Doc = ({ id, no }: { id: string | null; no: string | null }) =>
  id ? <Link href={`/documents/${id}`}>{no ?? "—"}</Link> : <>{no ?? "—"}</>;

function Overview({ d, label, onTab }: { d: ImeiDrawerData; label: (s: string) => string; onTab: (t: Tab) => void }) {
  const u = d.unit;
  const today = new Date().toISOString().slice(0, 10);
  const warranty = u.warrantyExpiry ?? u.supplierWarrantyExpiry;
  return (
    <>
      <h4 className="imei-h">Product &amp; Status</h4>
      <dl className="imei-kv">
        <div><dt>Product / Variant</dt><dd>{u.itemName}</dd></div>
        <div><dt>SKU / Item Code</dt><dd className="m">{u.itemCode}</dd></div>
        <div><dt>Brand / Model</dt><dd>{[u.brand, u.model].filter(Boolean).join(" / ")}</dd></div>
        {u.parts.length > 0 && <div><dt>Variant Attributes</dt><dd className="imei-chips">{u.parts.map((p) => <span key={p.a} title={p.a}>{p.o}</span>)}</dd></div>}
        <div><dt>Status</dt><dd><StatusPill s={u.status} label={label(u.status)} />{u.wasReturned && <span className="imei-pill warn">Returned before</span>}</dd></div>
        <div><dt>Location</dt><dd>{u.location ?? "—"}</dd></div>
        {u.supplier && <div><dt>Supplier</dt><dd>{u.supplier}</dd></div>}
        {u.customer && <div><dt>Customer</dt><dd>{u.customer} · <Doc id={u.outDocId} no={u.outDocNo} /></dd></div>}
        <div><dt>Warranty</dt><dd>{warranty
          ? <>{warranty >= today ? "Active" : "Expired"} · {u.warrantyExpiry ? "Customer, until" : "Supplier, until"} {warranty}</>
          : "—"}</dd></div>
        {u.notes && <div><dt>Notes</dt><dd>{u.notes}</dd></div>}
      </dl>

      <h4 className="imei-h">Quick actions</h4>
      <div className="imei-actions">
        <Link href={`/inventory/phones/${u.id}`} className="imei-act"><ExternalLink size={14} /> Full record</Link>
        <button type="button" className="imei-act" onClick={() => onTab("prices")}><Tag size={14} /> View pricing</button>
        <button type="button" className="imei-act" onClick={() => onTab("activity")}><Layers size={14} /> View movements</button>
        {d.canHold && (u.status === "IN_STOCK" || u.holdKind) && (
          <Link href={`/inventory/phones/${u.id}#hold`} className="imei-act"><Lock size={14} /> {u.holdKind ? "Release" : "Reserve"}</Link>
        )}
      </div>
    </>
  );
}

function CostTab({ d }: { d: ImeiDrawerData }) {
  const c = d.cost!;
  const foreign = c.currency !== "MMK";
  return (
    <>
      <h4 className="imei-h">Purchase Information</h4>
      <dl className="imei-kv">
        <div><dt>Original purchase price</dt><dd>{c.fcPrice == null ? "—" : `${c.fcPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${c.currency}`}</dd></div>
        {foreign && <div><dt>Exchange rate (at purchase)</dt><dd>{c.rate.toLocaleString("en-US", { maximumFractionDigits: 4 })} MMK / {c.currency}</dd></div>}
        <div><dt>Converted purchase cost</dt><dd>{money(c.purchase)} MMK</dd></div>
        <div><dt>Purchase date</dt><dd>{c.receipt?.date ?? "—"}</dd></div>
        <div><dt>Supplier</dt><dd>{c.receipt?.supplier ?? "—"}</dd></div>
      </dl>

      <h4 className="imei-h">Cost Breakdown <span className="imei-muted">(per unit)</span></h4>
      <table className="imei-mini">
        <thead><tr><th>Component</th><th className="num">Amount (MMK)</th></tr></thead>
        <tbody>
          <tr><td>Purchase cost</td><td className="num">{money(c.purchase)}</td></tr>
          {c.landed.map((l, i) => <tr key={i}><td>{l.type}</td><td className="num">{money(l.amount)}</td></tr>)}
          {c.landed.length === 0 && <tr><td>Landed costs</td><td className="num">0</td></tr>}
          {Math.abs(c.other) >= 1 && <tr><td>Other adjustments <span className="imei-muted">(bill corrections)</span></td><td className="num">{money(c.other)}</td></tr>}
        </tbody>
        <tfoot><tr><td>Total unit cost</td><td className="num">{money(c.total)}</td></tr></tfoot>
      </table>

      <h4 className="imei-h">Cost Sources</h4>
      <ul className="imei-sources">
        {c.receipt && (
          <li><FileText size={16} /><span><Doc id={c.receipt.id} no={c.receipt.no} /><small>{c.receipt.date} · {c.receipt.type === "GOODS_RECEIPT" ? "Goods receipt" : c.receipt.type.replace(/_/g, " ").toLowerCase()} · purchase cost</small></span><b>{money(c.purchase)}</b></li>
        )}
        {c.invoices.map((i) => (
          <li key={i.id}><FileText size={16} /><span><Doc id={i.id} no={i.no} /><small>{i.date} · Purchase invoice</small></span><b>{money(i.amount)}</b></li>
        ))}
        {c.landed.map((l, i) => (
          <li key={`lc${i}`}><Truck size={16} /><span><Doc id={l.docId} no={l.docNo} /><small>{l.date} · {l.type} · {l.method === "EQUAL" ? "equal" : l.method === "VALUE" ? "by value" : "manual"} allocation</small></span><b>{money(l.amount)}</b></li>
        ))}
      </ul>
    </>
  );
}

function PricesTab({ d }: { d: ImeiDrawerData }) {
  const cost = d.unitCost;
  const price = d.price;
  const editHref = d.unit.parentId ? `/items/${d.unit.parentId}/variants?only=${d.unit.itemId}` : `/items/${d.unit.itemId}`;
  return (
    <>
      <div className="imei-h row">
        <h4>Variant Price Levels</h4>
        {d.canEditPrices && <Link href={editHref} className="imei-act"><Pencil size={13} /> Edit</Link>}
      </div>
      <p className="imei-muted small">Set on the variant; every unit of it sells at these unless overridden.</p>
      <table className="imei-mini">
        <thead><tr><th>Price level</th><th className="num">Price (MMK)</th></tr></thead>
        <tbody>
          {d.prices.map((p) => (
            <tr key={p.id} className={p.name === d.priceLevel ? "sel" : undefined}>
              <td>{p.name}{p.name === d.priceLevel && <span className="imei-muted"> · default</span>}</td>
              <td className="num">{money(p.price)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4 className="imei-h">Price Information</h4>
      <dl className="imei-kv">
        <div><dt>Price source</dt><dd>Variant price level</dd></div>
        <div><dt>IMEI-specific override</dt><dd>None</dd></div>
        {cost != null && <div><dt>Unit cost</dt><dd>{money(cost)} MMK</dd></div>}
        {cost != null && price != null && <>
          <div><dt>Estimated gross profit</dt><dd>{money(price - cost)} MMK</dd></div>
          <div><dt>Estimated gross margin</dt><dd>{price ? pct((price - cost) / price) : "—"}</dd></div>
        </>}
      </dl>
      {!d.canEditPrices && <p className="imei-muted small"><Info size={12} /> Prices are changed by someone who manages products.</p>}
    </>
  );
}

const EVENT_ICON: Record<string, typeof Package> = {
  RECEIVED: Package, SOLD: ShoppingBag, CUSTOMER_RETURN: Undo2, SUPPLIER_RETURN: RotateCcw, TRANSFER: ArrowRightLeft,
  RESTORED: RotateCcw, WRITTEN_OFF: X, HOLD: Lock, RELEASE: Unlock, LANDED_COST: Truck, COST_LAYER_SPLIT: Layers,
  PRICE: Tag, REPAIR: Wrench,
};

function ActivityTab({ d, t }: { d: ImeiDrawerData; t: ReturnType<typeof useTranslations> }) {
  if (d.activity.length === 0) return <p className="imei-muted">Nothing has happened to this unit yet.</p>;
  return (
    <>
      <h4 className="imei-h">Recent Activity</h4>
      <ol className="imei-tl">
        {d.activity.map((e, i) => {
          const Icon = EVENT_ICON[e.kind] ?? FileText;
          const title: string = "title" in e && e.title ? String(e.title) : t.has(`dev.ev.${e.kind}`) ? t(`dev.ev.${e.kind}`) : e.kind;
          return (
            <li key={i} className={e.voided ? "voided" : undefined}>
              <span className="imei-tl-ico"><Icon size={14} /></span>
              <div>
                <p className="imei-tl-what">{title}{e.voided && " (voided)"}{e.docId && <> · <Doc id={e.docId} no={e.docNo} /></>}</p>
                {e.detail && <p className="imei-muted small">{e.detail}</p>}
              </div>
              <time>{e.at.length > 10 ? new Date(e.at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : e.at}</time>
            </li>
          );
        })}
      </ol>
    </>
  );
}

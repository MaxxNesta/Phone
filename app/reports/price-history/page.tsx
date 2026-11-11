import Link from "next/link";
import { Download, Info, RotateCcw } from "lucide-react";
import { sql } from "@/lib/db";
import { requirePermission, can } from "@/lib/auth";
import { getPriceHistory, getOrderInvoiceVariance, type PriceSide } from "@/lib/queries";
import { OrderVariance } from "./variance";
import { money, shortDate } from "@/lib/format";
import { paginate } from "@/lib/paging";
import { Pager } from "@/components/pager";
import { AutoApply } from "@/components/auto-apply";
import { PriceTimeline } from "@/components/price-timeline";
import { productTrends, timeline, bucketOf, trendKey, priceChanges, type ProductTrend } from "@/lib/price-trends";

const pct = (c: number) => `${(Math.abs(c) * 100).toFixed(Math.abs(c) < 0.001 ? 2 : 1)}%`;
/** Flat only when the price did not move by a whole kyat. */
const flat = (t: ProductTrend) => Math.abs(t.last - t.first) < 0.5;

/** Up, down or flat, said in words and an arrow as well as colour. */
function Change({ t }: { t: ProductTrend }) {
  const c = t.spark.length > 1 ? t.change : null;
  if (c === null) return <span className="page-sub">—</span>;
  if (flat(t)) return <span className="ph-flat">No change</span>;
  return c > 0
    ? <span className="ph-up"><span aria-hidden="true">▲</span> {pct(c)}<span className="sr-only"> up</span></span>
    : <span className="ph-down"><span aria-hidden="true">▼</span> {pct(c)}<span className="sr-only"> down</span></span>;
}

/** A day-by-day line small enough for a table cell; one day is a dot. */
function Spark({ v }: { v: number[] }) {
  const w = 96, h = 24, lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((y, i) => `${v.length === 1 ? w / 2 : (i / (v.length - 1)) * w},${h - 3 - ((y - lo) / span) * (h - 6)}`);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="ph-spark">
      {v.length > 1 ? <polyline points={pts.join(" ")} fill="none" stroke="var(--chart-1)" strokeWidth={1.5} strokeLinejoin="round" />
        : <circle cx={w / 2} cy={h / 2} r={2} fill="var(--chart-1)" />}
    </svg>
  );
}

export const metadata = { title: "Price history" };

type Search = Record<string, string | undefined>;

const firstOfLastMonth = () => {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * What each unit was actually bought and sold for, line by line, in the
 * currency of the document and in kyat at that document's own rate — so a
 * yuan price from March and a kyat price from October can be read side by side.
 */
export default async function PriceHistory({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("reports.view");
  const sp = await searchParams;
  const co = user.companyId;
  // What was paid for stock is cost: shown only to those who may see cost.
  const seeCost = can(user, "cost.view");
  const side: PriceSide = sp.side === "sale" || !seeCost ? "sale" : sp.side === "receipt" ? "receipt" : "purchase";
  // Order against invoice: purchase prices, so cost-only too.
  const variance = seeCost && sp.side === "variance";
  const tab = variance ? "variance" : side;
  const buying = side !== "sale";
  const range = { from: sp.from || firstOfLastMonth(), to: sp.to || new Date().toISOString().slice(0, 10) };

  const filters = {
    q: sp.q || undefined, partnerId: sp.partner || undefined, currency: sp.currency || undefined,
    locationId: sp.location || undefined, from: range.from, to: range.to,
  };
  const [rows, vrows, partners, currencies, locations] = await Promise.all([
    variance ? Promise.resolve([]) : getPriceHistory(co, side, filters),
    variance ? getOrderInvoiceVariance(co, filters) : Promise.resolve([]),
    buying
      ? sql`select id, name from business_partner where company_id = ${co} and is_supplier and is_active order by name`
      : sql`select id, name from business_partner where company_id = ${co} and is_customer and is_active order by name`,
    sql`select code from currency order by code`,
    sql`select id, name from location where company_id = ${co} and is_stock_location and is_active order by code`,
  ]);
  // What the report is about: the days a price moved, not every line posted.
  const changes = priceChanges(rows);
  const showAll = sp.view === "all";
  const pg = paginate(rows, sp.page, 25);
  const pgc = paginate(changes, sp.page, 25);

  // The dashboard reads the same lines as the table below it.
  const trends = productTrends(rows);
  const moving = trends.filter((t) => t.spark.length > 1 && t.change !== null);
  const up = moving.filter((t) => !flat(t) && t.change! > 0).length;
  const down = moving.filter((t) => !flat(t) && t.change! < 0).length;
  const movers = [...moving].sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!) || b.lines - a.lines).slice(0, 10);
  const byLines = [...trends].sort((a, b) => b.lines - a.lines || a.item.localeCompare(b.item));
  const focus: ProductTrend | undefined = trends.find((t) => t.key === sp.item) ?? byLines[0];
  // Grouping follows the product's own span, not the filter's: two days of
  // sales inside a year-long filter are two days, not one month.
  const focusLines = focus ? rows.filter((r) => trendKey(r) === focus.key) : [];
  const dates = focusLines.map((r) => r.date).sort();
  const size = bucketOf(dates[0] ?? range.from, dates[dates.length - 1] ?? range.to);
  const tl = focus ? timeline(focusLines, size) : null;
  const keep = (over: Search) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, page: undefined, ...over })) if (v) q.set(k, v);
    return `?${q}`;
  };
  const exportHref = `/reports/price-history/export${keep({ side: tab })}`;
  const partnerLabel = buying ? "Supplier" : "Customer";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Price history</h1>
          <p className="page-sub">Actual prices from posted documents</p>
        </div>
        <a href={exportHref} className="btn ghost" style={{ marginLeft: "auto" }}>
          <Download size={15} aria-hidden="true" /> Export
        </a>
      </div>

      <div className="scopetabs" style={{ margin: "0 0 12px" }} role="tablist" aria-label="Side">
        {seeCost && <Link scroll={false} className="scopetab" data-active={!variance && side === "purchase"} href={keep({ side: "purchase", partner: undefined })}>Purchases</Link>}
        {seeCost && <Link scroll={false} className="scopetab" data-active={!variance && side === "receipt"} href={keep({ side: "receipt", partner: undefined })}>Goods receipts</Link>}
        <Link scroll={false} className="scopetab" data-active={!variance && side === "sale"} href={keep({ side: "sale", partner: undefined })}>Sales</Link>
        {seeCost && <Link scroll={false} className="scopetab" data-active={variance} href={keep({ side: "variance", partner: undefined, item: undefined })}>Order vs invoice</Link>}
      </div>

      <form className="card filters ph-filters" method="get">
        <input type="hidden" name="side" value={tab} />
        {variance && sp.only && <input type="hidden" name="only" value={sp.only} />}
        <div className="field ph-q">
          <label htmlFor="ph-q">Product</label>
          <input id="ph-q" name="q" data-live defaultValue={sp.q ?? ""} placeholder="Search product name, SKU, item code or barcode…" />
        </div>
        <div className="field">
          <label htmlFor="ph-partner">{partnerLabel}</label>
          <select id="ph-partner" name="partner" defaultValue={sp.partner ?? ""}>
            <option value="">All {buying ? "suppliers" : "customers"}</option>
            {(partners as unknown as { id: string; name: string }[]).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ph-from">From</label>
          <input id="ph-from" name="from" type="date" defaultValue={range.from} />
        </div>
        <div className="field">
          <label htmlFor="ph-to">To</label>
          <input id="ph-to" name="to" type="date" defaultValue={range.to} />
        </div>
        <div className="field">
          <label htmlFor="ph-cur">Currency</label>
          <select id="ph-cur" name="currency" defaultValue={sp.currency ?? ""}>
            <option value="">All currencies</option>
            {(currencies as unknown as { code: string }[]).map((c) => <option key={c.code}>{c.code}</option>)}
          </select>
        </div>
        {locations.length > 1 && (
          <div className="field">
            <label htmlFor="ph-loc">Warehouse</label>
            <select id="ph-loc" name="location" defaultValue={sp.location ?? ""}>
              <option value="">All warehouses</option>
              {(locations as unknown as { id: string; name: string }[]).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        )}
        <div className="actions">
          <AutoApply />
          <button type="submit" className="btn ghost" data-apply>Filter</button>
          <Link href={`?side=${tab}`} className="btn ghost"><RotateCcw size={14} aria-hidden="true" /> Reset</Link>
        </div>
      </form>

      <p className="ph-note">
        <Info size={15} aria-hidden="true" />
        {variance
          ? <>Supplier bills against the purchase order behind them. A bill raised straight from an order is held to the order&rsquo;s price, so a difference comes from goods received first and billed later at another price.</>
          : <>Net unit price after line discounts, before tax. Converted at each document&rsquo;s own saved exchange rate — a later rate change does not alter history.</>}
      </p>

      {variance && <OrderVariance rows={vrows} all={sp.only === "all"} keep={keep} />}

      {!variance && trends.length > 0 && (
        <>
          <div className="kpis ph-kpis">
            <div className="kpi"><div className="kpi-label">Price changes</div><div className="kpi-value">{changes.length.toLocaleString("en-US")}</div><div className="kpi-note">from {rows.length.toLocaleString("en-US")} posted lines</div></div>
            <div className="kpi"><div className="kpi-label">Products</div><div className="kpi-value">{trends.length.toLocaleString("en-US")}</div></div>
            <div className="kpi"><div className="kpi-label">Price went up</div><div className="kpi-value">{up}</div><div className="kpi-note">products, first day to last</div></div>
            <div className="kpi"><div className="kpi-label">Price went down</div><div className="kpi-value">{down}</div><div className="kpi-note">products, first day to last</div></div>
          </div>

          {focus && tl && (
            <section className="card ph-timeline">
              <div className="card-head ph-tl-head">
                <div>
                  <h2>{focus.item} <span className="ph-sku">{focus.code} · per {focus.uom}</span></h2>
                  <p className="page-sub">
                    {money(focus.first)} → {money(focus.last)} MMK · <Change t={focus} /> · low {money(focus.low)} · high {money(focus.high)} · {focus.lines} line{focus.lines === 1 ? "" : "s"}
                  </p>
                </div>
                <form method="get" className="ph-pick">
                  {Object.entries({ ...sp, item: undefined, page: undefined }).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
                  <label htmlFor="ph-item" className="sr-only">Product</label>
                  <select id="ph-item" name="item" defaultValue={focus.key}>
                    {byLines.map((t) => <option key={t.key} value={t.key}>{t.item} · {t.uom} ({t.lines})</option>)}
                  </select>
                  <AutoApply />
                  <button type="submit" className="btn ghost" data-apply>Show</button>
                </form>
              </div>
              <div className="card-body">
                <PriceTimeline points={tl.points} buckets={tl.buckets}
                  label={`${focus.item}: unit price from ${money(focus.first)} to ${money(focus.last)} MMK, ${focus.lines} lines`} />
                <p className="ph-legend"><span className="ph-dot" aria-hidden="true" /> each {side === "sale" ? "sale" : "purchase"} <span className="ph-bar" aria-hidden="true" /> price ({size === "day" ? "daily" : size === "week" ? "weekly" : "monthly"} average), held until it changes</p>
              </div>
            </section>
          )}

          {movers.length > 0 && (
            <section className="card">
              <div className="card-head"><h2>Biggest price changes</h2><span className="page-sub">First day against last day in the period</span></div>
              <div className="tablewrap">
                <table className="ph-table">
                  <thead><tr><th>Product / SKU</th><th>Unit</th><th className="r">Lines</th><th className="r">First (MMK)</th><th className="r">Last (MMK)</th><th className="r">Change</th><th className="r">Low – high</th><th>Trend</th></tr></thead>
                  <tbody>
                    {movers.map((t) => (
                      <tr key={t.key} data-active={t.key === focus?.key || undefined}>
                        <td className="wrapcell"><Link scroll={false} href={keep({ item: t.key })} className="ph-prod">{t.item}</Link><div className="ph-sku">{t.code}</div></td>
                        <td>{t.uom}</td>
                        <td className="r">{t.lines}</td>
                        <td className="r">{money(t.first)}</td>
                        <td className="r ph-base">{money(t.last)}</td>
                        <td className="r"><Change t={t} /></td>
                        <td className="r">{money(t.low)} – {money(t.high)}</td>
                        <td><Spark v={t.spark} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {!variance && (
      <div className="card">
        <div className="card-head">
          <h2>{showAll ? "All lines" : "Price changes"}</h2>
          <div className="scopetabs" role="tablist" aria-label="Show">
            <Link scroll={false} className="scopetab" data-active={!showAll} href={keep({ view: undefined })}>Price changes <span className="scopetab-n">{changes.length}</span></Link>
            <Link scroll={false} className="scopetab" data-active={showAll} href={keep({ view: "all" })}>All lines <span className="scopetab-n">{rows.length}</span></Link>
          </div>
        </div>
        {!showAll ? (
          <>
            <div className="tablewrap">
              <table className="ph-table">
                <thead>
                  <tr>
                    <th>Date</th><th>Product / SKU</th><th className="r">Previous price</th><th className="r">New price</th>
                    <th className="r">Change</th><th>{side === "sale" ? "Sales invoices" : side === "receipt" ? "Goods receipts" : "Purchase invoices"}</th>
                  </tr>
                </thead>
                <tbody>
                  {pgc.rows.map((c) => (
                    <tr key={`${c.key}-${c.date}`}>
                      <td>{shortDate(c.date)}</td>
                      <td className="wrapcell"><Link scroll={false} href={keep({ item: c.key, view: undefined })} className="ph-prod">{c.item}</Link><div className="ph-sku">{c.code} · per {c.uom}</div></td>
                      <td className="r">{money(c.prev)}<div className="ph-sku">{shortDate(c.prevDate)}</div></td>
                      <td className="r ph-base">{money(c.next)}</td>
                      <td className="r">
                        <span className={c.change > 0 ? "ph-up" : "ph-down"}><span aria-hidden="true">{c.change > 0 ? "▲" : "▼"}</span> {money(Math.abs(c.change))}<span className="sr-only">{c.change > 0 ? " up" : " down"}</span></span>
                        {c.pct !== null && <div className="ph-sku">{(Math.abs(c.pct) * 100).toFixed(Math.abs(c.pct) < 0.001 ? 2 : 1)}%</div>}
                      </td>
                      <td>{c.docs.slice(0, 3).map((d, i) => <span key={d.id}>{i > 0 && ", "}<Link href={`/documents/${d.id}`}>{d.no}</Link></span>)}{c.docs.length > 3 && <span className="ph-sku"> +{c.docs.length - 3}</span>}</td>
                    </tr>
                  ))}
                  {changes.length === 0 && <tr><td colSpan={6} className="page-sub" style={{ textAlign: "center", padding: 24 }}>No price moved in these filters{rows.length > 0 ? ". Every product kept its price; All lines shows what was posted." : "."}</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="ph-foot">
              <span className="page-sub">{changes.length.toLocaleString("en-US")} price change{changes.length === 1 ? "" : "s"} · a day whose price (quantity-weighted) differs from that product&rsquo;s previous day in the period</span>
              <Pager p={pgc} params={sp} />
            </div>
          </>
        ) : (
        <>
        <div className="tablewrap">
          <table className="ph-table">
            <thead>
              <tr>
                <th>Date</th><th>Product / SKU</th><th>{partnerLabel}</th>
                <th>{side === "sale" ? "Sales invoice" : side === "receipt" ? "Goods receipt" : "Purchase invoice"}</th>
                <th className="r">Qty / Unit</th><th className="r">Actual unit price</th>
                <th className="r">FX rate to MMK</th><th className="r">Unit price (MMK)</th>
              </tr>
            </thead>
            <tbody>
              {pg.rows.map((r, i) => (
                <tr key={`${r.doc_id}-${i}`}>
                  <td>{shortDate(r.date)}</td>
                  <td className="wrapcell"><div className="ph-prod">{r.item}</div><div className="ph-sku">{r.code}</div></td>
                  <td>{r.partner}</td>
                  <td><Link href={`/documents/${r.doc_id}`}>{r.doc_no}</Link></td>
                  <td className="r">{r.qty.toLocaleString("en-US")} {r.uom}</td>
                  <td className="r"><span className="ph-cur">{r.currency}</span> {r.currency === "MMK" ? money(r.unit_fc) : r.unit_fc.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="r">{r.rate.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                  <td className="r ph-base">{money(r.unit_base)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="page-sub" style={{ textAlign: "center", padding: 24 }}>No {side === "sale" ? "sales" : "purchases"} match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="ph-foot">
          <span className="page-sub">Showing {rows.length.toLocaleString("en-US")} line{rows.length === 1 ? "" : "s"}{rows.length >= 5000 ? " — the latest 5,000; narrow the dates for more" : ""}</span>
          <Pager p={pg} params={sp} />
        </div>
        </>
        )}
      </div>
      )}
    </>
  );
}

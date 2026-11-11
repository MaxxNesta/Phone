import Link from "next/link";
import { ArrowLeft, Download, Info, RotateCcw } from "lucide-react";
import { sql } from "@/lib/db";
import { requirePermission, can } from "@/lib/auth";
import { getPriceHistory, getOrderInvoiceVariance, type PriceSide, type PriceRow } from "@/lib/queries";
import { OrderVariance } from "./variance";
import { money, shortDate } from "@/lib/format";
import { paginate } from "@/lib/paging";
import { Pager } from "@/components/pager";
import { AutoApply } from "@/components/auto-apply";
import { PriceTimeline } from "@/components/price-timeline";
import { PricePicker } from "@/components/price-picker";
import { GroupBars, type GroupBar } from "@/components/price-group-bars";
import {
  productTrends, timeline, bucketOf, trendKey, priceChanges, breakdown,
  type ProductTrend, type PriceChange, type Slice,
} from "@/lib/price-trends";

const pct = (c: number) => `${(Math.abs(c) * 100).toFixed(Math.abs(c) < 0.001 ? 2 : 1)}%`;
/** Flat only when the price did not move by a whole kyat. */
const flat = (t: ProductTrend) => Math.abs(t.last - t.first) < 0.5;
const moved = (t: ProductTrend) => t.spark.length > 1 && t.change !== null && !flat(t);

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

/** Columns of the product table that sort, and how. */
const SORTS: Record<string, (t: ProductTrend) => number | string> = {
  product: (t) => t.item.toLowerCase(), orders: (t) => t.orders, qty: (t) => t.qty, avg: (t) => t.avg,
  low: (t) => t.low, high: (t) => t.high, range: (t) => t.high - t.low, change: (t) => (moved(t) ? Math.abs(t.change!) : -1),
};

/**
 * What each unit was actually bought and sold for. Two views of one set of
 * lines: an overview of every product — how often, how much, and how far its
 * price moved — and, once a product is picked, that product alone: its price
 * over time and how it differed by customer group, price level, branch,
 * customer or supplier, and discount.
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
    categoryId: sp.category || undefined, brandId: sp.brand || undefined, branchId: sp.branch || undefined,
  };
  const [rows, vrows, partners, currencies, locations, categories, brands, branches] = await Promise.all([
    variance ? Promise.resolve([] as PriceRow[]) : getPriceHistory(co, side, filters),
    variance ? getOrderInvoiceVariance(co, filters) : Promise.resolve([]),
    buying
      ? sql`select id, name from business_partner where company_id = ${co} and is_supplier and is_active order by name`
      : sql`select id, name from business_partner where company_id = ${co} and is_customer and is_active order by name`,
    sql`select code from currency order by code`,
    sql`select id, name from location where company_id = ${co} and is_stock_location and is_active order by code`,
    sql`select id, name from item_group where company_id = ${co} and is_active order by name`,
    sql`select id, name from brand where company_id = ${co} and is_active order by name`,
    sql`select id, name from location where company_id = ${co} and parent_id is null and is_active order by code`,
  ]);

  const trends = productTrends(rows);
  const byLines = [...trends].sort((a, b) => b.lines - a.lines || a.item.localeCompare(b.item));
  // A product view opens when one is picked, or when the Product search names
  // one: an exact SKU, or a search that leaves a single product.
  const needle = (sp.q ?? "").trim().toLowerCase();
  const searched = needle ? (byLines.find((t) => t.code.toLowerCase() === needle) ?? (trends.length === 1 ? trends[0] : undefined)) : undefined;
  const focus: ProductTrend | undefined = trends.find((t) => t.key === sp.item) ?? searched;

  const keep = (over: Search) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, page: undefined, ...over })) if (v) q.set(k, v);
    return `?${q}`;
  };
  const exportHref = `/reports/price-history/export${keep({ side: tab })}`;
  const partnerLabel = buying ? "Supplier" : "Customer";
  const pick = (k: string) => keep({ item: k, view: undefined, sort: undefined, products: undefined });
  const pickerOptions = byLines.map((t) => ({ key: t.key, item: t.item, code: t.code, uom: t.uom, lines: t.lines, change: moved(t) ? t.change : null }));
  const sel = (id: string, name: string, label: string, all: string, opts: { id: string; name: string }[]) => opts.length > 1 && (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} name={name} defaultValue={sp[name] ?? ""}>
        <option value="">{all}</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );

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
        {sel("ph-partner", "partner", partnerLabel, `All ${buying ? "suppliers" : "customers"}`, partners as unknown as { id: string; name: string }[])}
        <div className="field">
          <label htmlFor="ph-from">From</label>
          <input id="ph-from" name="from" type="date" defaultValue={range.from} />
        </div>
        <div className="field">
          <label htmlFor="ph-to">To</label>
          <input id="ph-to" name="to" type="date" defaultValue={range.to} />
        </div>
        {!variance && sel("ph-cat", "category", "Category", "All categories", categories as unknown as { id: string; name: string }[])}
        {!variance && sel("ph-brand", "brand", "Brand", "All brands", brands as unknown as { id: string; name: string }[])}
        {!variance && sel("ph-branch", "branch", "Branch", "All branches", branches as unknown as { id: string; name: string }[])}
        <div className="field">
          <label htmlFor="ph-cur">Currency</label>
          <select id="ph-cur" name="currency" defaultValue={sp.currency ?? ""}>
            <option value="">All currencies</option>
            {(currencies as unknown as { code: string }[]).map((c) => <option key={c.code}>{c.code}</option>)}
          </select>
        </div>
        {sel("ph-loc", "location", "Warehouse", "All warehouses", locations as unknown as { id: string; name: string }[])}
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

      {variance ? <OrderVariance rows={vrows} all={sp.only === "all"} keep={keep} />
        : focus ? <ProductView focus={focus} rows={rows.filter((r) => trendKey(r) === focus.key)} side={side} sp={sp} keep={keep}
            pickerOptions={pickerOptions} partnerLabel={partnerLabel} range={range} />
        : <Overview rows={rows} trends={trends} side={side} sp={sp} keep={keep} pick={pick} partnerLabel={partnerLabel} />}
    </>
  );
}

/** Every product: tiles, the product table, then price changes and lines. */
function Overview({ rows, trends, side, sp, keep, pick, partnerLabel }: {
  rows: PriceRow[]; trends: ProductTrend[]; side: PriceSide; sp: Search;
  keep: (o: Search) => string; pick: (k: string) => string; partnerLabel: string;
}) {
  const changes = priceChanges(rows);
  const up = trends.filter((t) => moved(t) && t.change! > 0).length;
  const down = trends.filter((t) => moved(t) && t.change! < 0).length;
  const allProducts = sp.products === "all";
  const desc = (sp.sort ?? "-change").startsWith("-");
  const key = (sp.sort ?? "-change").replace(/^-/, "");
  const by = SORTS[key] ?? SORTS.change;
  const list = (allProducts ? trends : trends.filter(moved)).sort((a, b) => {
    const x = by(a), y = by(b);
    return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1) || b.lines - a.lines;
  });
  const pgp = paginate(list, sp.ppage, 15);
  const head = (k: string, label: string, r = true) => {
    const on = key === k;
    return (
      <th className={r ? "r" : undefined} aria-sort={on ? (desc ? "descending" : "ascending") : undefined}>
        <Link scroll={false} className="ph-sort" href={keep({ sort: on && desc ? k : `-${k}`, ppage: undefined })}>
          {label}{on && <span aria-hidden="true"> {desc ? "↓" : "↑"}</span>}
        </Link>
      </th>
    );
  };
  if (trends.length === 0) return <ChangesAndLines rows={rows} changes={changes} side={side} sp={sp} keep={keep} pick={pick} partnerLabel={partnerLabel} />;
  return (
    <>
      <div className="kpis ph-kpis">
        <div className="kpi"><div className="kpi-label">Price changes</div><div className="kpi-value">{changes.length.toLocaleString("en-US")}</div><div className="kpi-note">from {rows.length.toLocaleString("en-US")} posted lines</div></div>
        <div className="kpi"><div className="kpi-label">Products changed</div><div className="kpi-value">{trends.filter(moved).length}</div><div className="kpi-note">of {trends.length} {side === "sale" ? "sold" : "bought"}</div></div>
        <div className="kpi"><div className="kpi-label">Price went up</div><div className="kpi-value">{up}</div><div className="kpi-note">products, first day to last</div></div>
        <div className="kpi"><div className="kpi-label">Price went down</div><div className="kpi-value">{down}</div><div className="kpi-note">products, first day to last</div></div>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Products<span className="page-sub"> · pick one to see its prices in detail</span></h2>
          <div className="scopetabs" role="tablist" aria-label="Products">
            <Link scroll={false} className="scopetab" data-active={!allProducts} href={keep({ products: undefined, ppage: undefined })}>Price changed <span className="scopetab-n">{trends.filter(moved).length}</span></Link>
            <Link scroll={false} className="scopetab" data-active={allProducts} href={keep({ products: "all", ppage: undefined })}>All products <span className="scopetab-n">{trends.length}</span></Link>
          </div>
        </div>
        <div className="tablewrap">
          <table className="ph-table">
            <thead>
              <tr>
                {head("product", "Product / SKU", false)}<th>Unit</th>
                {head("orders", side === "sale" ? "Invoices" : "Bills")}{head("qty", "Qty")}{head("avg", "Average")}
                {head("low", "Lowest")}{head("high", "Highest")}{head("range", "Range")}{head("change", "Change")}<th>Trend</th>
              </tr>
            </thead>
            <tbody>
              {pgp.rows.map((t) => (
                <tr key={t.key} className="ph-pick-row">
                  <td className="wrapcell"><Link scroll={false} href={pick(t.key)} className="ph-prod">{t.item}</Link><div className="ph-sku">{t.code}</div></td>
                  <td>{t.uom}</td>
                  <td className="r">{t.orders}</td>
                  <td className="r">{t.qty.toLocaleString("en-US")}</td>
                  <td className="r ph-base">{money(t.avg)}</td>
                  <td className="r">{money(t.low)}</td>
                  <td className="r">{money(t.high)}</td>
                  <td className="r">{t.high - t.low >= 0.5 ? <>{money(t.high - t.low)}<div className="ph-sku">{t.low > 0 ? pct((t.high - t.low) / t.low) : ""}</div></> : "—"}</td>
                  <td className="r"><Change t={t} /></td>
                  <td><Spark v={t.spark} /></td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={10} className="page-sub" style={{ textAlign: "center", padding: 24 }}>No product&rsquo;s price moved in these filters. All products shows every one.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="ph-foot">
          <span className="page-sub">Average is quantity-weighted. Range is highest less lowest. Change is the first day&rsquo;s price against the last.</span>
          <Pager p={pgp} params={sp} name="ppage" />
        </div>
      </section>

      <ChangesAndLines rows={rows} changes={changes} side={side} sp={sp} keep={keep} pick={pick} partnerLabel={partnerLabel} />
    </>
  );
}

/**
 * One product, laid out as a report page: the figures that matter in the top
 * left, the price by group beside them, the price over time across the
 * bottom, in the app's blue with slate beside it.
 */
function ProductView({ focus, rows, side, sp, keep, pickerOptions, partnerLabel, range }: {
  focus: ProductTrend; rows: PriceRow[]; side: PriceSide; sp: Search; keep: (o: Search) => string;
  pickerOptions: { key: string; item: string; code: string; uom: string; lines: number; change: number | null }[];
  partnerLabel: string; range: { from: string; to: string };
}) {
  const changes = priceChanges(rows);
  // Grouping follows the product's own span, not the filter's: two days of
  // sales inside a year-long filter are two days, not one month.
  const dates = rows.map((r) => r.date).sort();
  const size = bucketOf(dates[0] ?? range.from, dates[dates.length - 1] ?? range.to);
  const tl = timeline(rows, size);
  // The same periods priced including tax, for the second line.
  const withTax = rows.map((r) => ({ ...r, unit_base: r.unit_base + r.unit_tax }));
  const tlTax = timeline(withTax, size);
  const buckets = tl.buckets.map((b) => ({ ...b, avgTax: tlTax.buckets.find((x) => x.t === b.t)?.avg }));
  const taxed = rows.some((r) => Math.abs(r.unit_tax) >= 0.005);
  const avgTax = focus.qty ? withTax.reduce((t, r) => t + r.unit_base * r.qty, 0) / focus.qty : 0;
  const sale = side === "sale";

  /** A grouping as bars: before and including tax, side by side. */
  const bars = (by: (r: PriceRow) => string | null | undefined): GroupBar[] => {
    const tax = new Map(breakdown(withTax, by).map((x) => [x.label, x.avg]));
    return breakdown(rows, by).map((x) => ({ label: x.label, avg: x.avg, avgTax: tax.get(x.label) ?? null, qty: x.qty }));
  };
  const left: [string, GroupBar[], string] = sale
    ? ["Average price by customer group", bars((r) => r.pgroup), "No customer here belongs to a customer group."]
    : ["Average price by supplier", bars((r) => r.partner), "No supplier on these lines."];
  const right: [string, GroupBar[], string] = sale
    ? ["Average price by price level", bars((r) => r.level), "No sale of it recorded a price level."]
    : ["Average price by branch", bars((r) => r.branch), "No branch on these lines."];
  // The groupings not on the board, as tables underneath — only where there
  // are two or more to compare.
  const more = ([
    ...(sale ? [["By branch", breakdown(rows, (r) => r.branch)], [`By ${partnerLabel.toLowerCase()}`, breakdown(rows, (r) => r.partner).slice(0, 8)]] : []),
    ["By discount", breakdown(rows, (r) => r.disc_kind ?? "No discount")],
  ] as [string, Slice[]][]).filter(([label, x]) => x.length > 1 || (label === "By discount" && x.some((y) => y.label !== "No discount")));
  const clear = keep({ item: undefined, q: sp.q && sp.q.trim().toLowerCase() === focus.code.toLowerCase() ? undefined : sp.q });
  const big = (v: number) => (v >= 1e9 ? `${+(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${+(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `${+(v / 1e3).toFixed(1)}K` : v.toLocaleString("en-US"));

  return (
    <>
      <section className="pbi">
        <header className="pbi-head">
          <Link scroll={false} href={clear} className="pbi-back" aria-label="Back to all products" title="All products"><ArrowLeft size={18} aria-hidden="true" /></Link>
          <div className="pbi-title">
            <h2>{focus.item}</h2>
            <p>Product price analysis <span className="ph-sku">· {focus.code} · per {focus.uom}</span></p>
            <PricePicker value={focus.key} baseQuery={keep({ item: undefined })} options={pickerOptions} />
          </div>
        </header>

        <div className="pbi-top">
          <dl className="pbi-kpis">
            <div><dd title={`${money(focus.avg)} MMK`}>{big(focus.avg)}</dd><dt>Average price</dt></div>
            {taxed
              ? <div><dd title={`${money(avgTax)} MMK`}>{big(avgTax)}</dd><dt>Average price incl tax</dt></div>
              : <div><dd title={`${money(focus.low)} – ${money(focus.high)} MMK`}>{big(focus.high - focus.low)}</dd><dt>Price range</dt></div>}
            <div><dd>{focus.orders.toLocaleString("en-US")}</dd><dt>{sale ? "Invoices" : "Bills"} count</dt></div>
            <div><dd>{big(focus.qty)}</dd><dt>Quantity {sale ? "sold" : "bought"}</dt></div>
          </dl>
          {[left, right].map(([title, data, empty]) => (
            <div key={title} className="pbi-panel">
              <h3>{title}</h3>
              <GroupBars data={data} empty={empty} />
            </div>
          ))}
        </div>

        <div className="pbi-panel pbi-time">
          <h3>Average price timeline</h3>
          <p className="pbi-legend">
            <i style={{ background: "var(--pbi-line)" }} /> Average price
            {taxed && <><i style={{ background: "var(--pbi-alt)" }} /> Average price incl tax</>}
            <i className="dot" style={{ background: "var(--pbi-alt)", opacity: 0.6 }} /> each {sale ? "sale" : "purchase"}
            <span className="pbi-note">{size === "day" ? "daily" : size === "week" ? "weekly" : "monthly"} · {money(focus.first)} → {money(focus.last)} · <Change t={focus} /> · {changes.length} change{changes.length === 1 ? "" : "s"}</span>
          </p>
          <PriceTimeline points={tl.points} buckets={buckets}
            label={`${focus.item}: unit price from ${money(focus.first)} to ${money(focus.last)} MMK, ${focus.lines} lines`} />
        </div>
      </section>

      {more.length > 0 && (
        <div className="ph-parts">
          {more.map(([label, slices]) => (
            <section key={label} className="card ph-part">
              <div className="card-head"><h2>{label}</h2></div>
              <table className="ph-table ph-part-table">
                <thead><tr><th /><th className="r">Average</th><th className="r">vs all</th><th className="r">Share of qty</th></tr></thead>
                <tbody>
                  {slices.map((x) => {
                    const d = focus.avg ? (x.avg - focus.avg) / focus.avg : 0;
                    return (
                      <tr key={x.label}>
                        <td className="wrapcell">{x.label}<div className="ph-sku">{x.qty.toLocaleString("en-US")} {focus.uom} · {x.lines} line{x.lines === 1 ? "" : "s"}</div></td>
                        <td className="r ph-base">{money(x.avg)}</td>
                        <td className="r">{Math.abs(d) < 0.0005 ? <span className="ph-flat">Same</span>
                          : <span className={d > 0 ? "ph-up" : "ph-down"}>{d > 0 ? "▲" : "▼"} {pct(d)}</span>}</td>
                        <td className="r"><span className="ph-share"><span style={{ width: `${Math.max(2, x.share * 100)}%` }} /></span><div className="ph-sku">{Math.round(x.share * 100)}%</div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}

      <ChangesAndLines rows={rows} changes={changes} side={side} sp={sp} keep={keep} pick={null} partnerLabel={partnerLabel} />
    </>
  );
}

/** The days prices moved, or every posted line — one switch. */
function ChangesAndLines({ rows, changes, side, sp, keep, pick, partnerLabel }: {
  rows: PriceRow[]; changes: PriceChange[]; side: PriceSide; sp: Search;
  keep: (o: Search) => string; pick: ((k: string) => string) | null; partnerLabel: string;
}) {
  const showAll = sp.view === "all";
  const pg = paginate(rows, sp.page, 25);
  const pgc = paginate(changes, sp.page, 25);
  const docs = side === "sale" ? "Sales invoice" : side === "receipt" ? "Goods receipt" : "Purchase invoice";
  return (
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
                  <th>Date</th>{pick && <th>Product / SKU</th>}<th className="r">Previous price</th><th className="r">New price</th>
                  <th className="r">Change</th><th>{docs}s</th>
                </tr>
              </thead>
              <tbody>
                {pgc.rows.map((c) => (
                  <tr key={`${c.key}-${c.date}`}>
                    <td>{shortDate(c.date)}</td>
                    {pick && <td className="wrapcell"><Link scroll={false} href={pick(c.key)} className="ph-prod">{c.item}</Link><div className="ph-sku">{c.code} · per {c.uom}</div></td>}
                    <td className="r">{money(c.prev)}<div className="ph-sku">{shortDate(c.prevDate)}</div></td>
                    <td className="r ph-base">{money(c.next)}</td>
                    <td className="r">
                      <span className={c.change > 0 ? "ph-up" : "ph-down"}><span aria-hidden="true">{c.change > 0 ? "▲" : "▼"}</span> {money(Math.abs(c.change))}<span className="sr-only">{c.change > 0 ? " up" : " down"}</span></span>
                      {c.pct !== null && <div className="ph-sku">{pct(c.pct)}</div>}
                    </td>
                    <td>{c.docs.slice(0, 3).map((d, i) => <span key={d.id}>{i > 0 && ", "}<Link href={`/documents/${d.id}`}>{d.no}</Link></span>)}{c.docs.length > 3 && <span className="ph-sku"> +{c.docs.length - 3}</span>}</td>
                  </tr>
                ))}
                {changes.length === 0 && <tr><td colSpan={pick ? 6 : 5} className="page-sub" style={{ textAlign: "center", padding: 24 }}>No price moved in these filters{rows.length > 0 ? ". All lines shows what was posted." : "."}</td></tr>}
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
                  <th>Date</th><th>Product / SKU</th><th>{partnerLabel}</th><th>{docs}</th>
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
  );
}

import Link from "next/link";
import { Banknote, TrendingUp, Smartphone, Users, Package, Clock, ShieldAlert, AlertTriangle, Check } from "lucide-react";
import { currentUser, can } from "@/lib/auth";
import { retailDashboard } from "@/lib/phone";
import { money } from "@/lib/format";
import { Stat, compact } from "@/components/stat";
import { WeekBars } from "@/components/week-bars";
import { ArrowRight } from "lucide-react";
import { ShareDonut } from "@/components/charts";
import { PeriodPicker } from "@/components/period-picker";
import { resolvePeriod, DEFAULT_PERIOD } from "@/lib/period";
import {
  getTopCategories, getRevenueByRegion, getRevenueByCustomerCategory, getSpendBySupplierCategory, getDocuments,
  getHealth,
} from "@/lib/queries";

type Share = { id: string; name: string; revenue: number | string };

/* Badge per document type in Recent activity, as on the business overview. */
const TYPE_MARK: Record<string, { short: string; tint: string }> = {
  GOODS_RECEIPT: { short: "GR", tint: "#6C5CE0" },
  PURCHASE_ORDER: { short: "PO", tint: "#3B6FD4" },
  PURCHASE_INVOICE: { short: "PI", tint: "var(--warn)" },
  SUPPLIER_PAYMENT: { short: "PAY", tint: "var(--brand)" },
  SALES_ORDER: { short: "SO", tint: "#3B6FD4" },
  DELIVERY: { short: "DO", tint: "#6C5CE0" },
  SALES_INVOICE: { short: "SI", tint: "var(--warn)" },
  CUSTOMER_RECEIPT: { short: "REC", tint: "var(--brand)" },
  STOCK_TRANSFER: { short: "TR", tint: "var(--muted)" },
  STOCK_ADJUSTMENT: { short: "ADJ", tint: "var(--muted)" },
};

const since = (at: string | null, on: string) => {
  const t = at ? new Date(at).getTime() : new Date(on).getTime();
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(on).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

/* A breakdown where nothing has been filed is one slice reading "Not
   categorised" — a circle around the whole company that tells nobody
   anything. */
const worthDrawing = (rows: { id: string }[]) =>
  rows.length > 0 && !(rows.length === 1 && rows[0].id === "none");

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await currentUser();
  if (!user) return null;
  const sp = await searchParams;
  const { denied } = sp;
  // One window per donut, as on the business overview: each card's period
  // picker edits its own key in the URL and leaves the others alone.
  const period = { cat: resolvePeriod(sp.cat), reg: resolvePeriod(sp.reg),
                   cust: resolvePeriod(sp.cust), supp: resolvePeriod(sp.supp) };
  const hrefWith = (key: string, value: string) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(sp)) if (v && k !== "denied") next[k] = v;
    if (value === DEFAULT_PERIOD) delete next[key];
    else next[key] = value;
    const q = new URLSearchParams(next).toString();
    return q ? `/?${q}` : "/";
  };
  const co = user.companyId;
  const [d, cats, regionRows, custRows, suppRows, recentDocs, health] = await Promise.all([
    retailDashboard(co),
    getTopCategories(co, period.cat.from, period.cat.to),
    getRevenueByRegion(co, period.reg.from, period.reg.to),
    getRevenueByCustomerCategory(co, period.cust.from, period.cust.to),
    getSpendBySupplierCategory(co, period.supp.from, period.supp.to),
    getDocuments(co, undefined, undefined, 5),
    getHealth(co),
  ]);
  const categories = cats as unknown as Share[];
  const regions = regionRows as unknown as Share[];
  const custCategories = custRows as unknown as Share[];
  const suppCategories = suppRows as unknown as Share[];
  const recent = recentDocs as unknown as {
    id: string; doc_type: string; doc_no: string | null; partner_name: string | null;
    gross_total: number | string; posted_at: string | null; posting_date: string;
  }[];
  const seeCost = can(user, "cost.view");

  // The ledger checking itself: each line is a query that finds breaks, so
  // "fine" here means the query found none, not that nobody looked.
  const checks = [
    { label: "Trial balance", ok: health.trialBalance === 0,
      value: health.trialBalance === 0 ? "Balanced" : `Off by MMK ${money(health.trialBalance)}` },
    { label: "Journal integrity", ok: health.unbalanced === 0,
      value: `${health.unbalanced} unbalanced entr${health.unbalanced === 1 ? "y" : "ies"}` },
    { label: "Inventory ↔ GL", ok: health.inventoryBreaks === 0,
      value: health.inventoryBreaks === 0 ? `Reconciled · MMK ${compact(d.stock.value)}`
        : `${health.inventoryBreaks} break${health.inventoryBreaks === 1 ? "" : "s"}` },
  ];
  const healthy = checks.every((c) => c.ok);

  const change = d.yesterday.revenue > 0
    ? ((d.today.revenue - d.yesterday.revenue) / d.yesterday.revenue) * 100 : null;
  const gp = d.today.revenue - d.today.cost;
  const margin = d.today.revenue ? (gp / d.today.revenue) * 100 : 0;
  const date = new Date().toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Yangon" });

  return (
    <>
      <div className="page-head hero">
        <h1>Dashboard</h1>
        <p className="page-sub">{date}</p>
      </div>

      {denied && (
        <div className="alert" role="alert">Your role cannot open that page ({denied}). Ask a manager.</div>
      )}

      <div className="stats">
        <Stat icon={<Banknote size={20} />} label="Today's Sales" value={`${compact(d.today.revenue)} MMK`}
          note={change === null ? "No sales yesterday" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}% vs yesterday`}
          noteTone={change === null ? undefined : change >= 0 ? "up" : "down"} />
        {seeCost && (
          <Stat icon={<TrendingUp size={20} />} tone="slate" label="Gross Profit" value={`${compact(gp)} MMK`}
            note={`${margin.toFixed(1)}% margin`} />
        )}
        <Stat icon={<Smartphone size={20} />} tone="violet" label="Phones Sold" value={`${d.today.phones} units`}
          note={`${d.yesterday.phones} yesterday`} />
        <Stat icon={<Users size={20} />} tone="amber" label="Receivables" value={`${compact(d.ar.owed)} MMK`}
          note={`${d.ar.customers} customer${d.ar.customers === 1 ? "" : "s"} due`} noteTone="warn" />
      </div>

      <div className="section-grid eqrow">
        <div className="card">
          <div className="card-head"><h2>Sales Performance</h2><span className="page-sub">Last 7 days · MMK</span></div>
          <div className="card-body"><WeekBars data={d.week as never} /></div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Top Selling Models</h2><span className="page-sub">Last 30 days</span></div>
          <div className="card-body">
            {d.topModels.length === 0 && <p className="page-sub">No phones sold yet.</p>}
            {d.topModels.map((m: any) => (
              <div className="listrow" key={m.model}>
                <span className="thumb"><Smartphone size={18} aria-hidden="true" /></span>
                <span className="grow"><div className="prod-name">{m.model}</div><div className="prod-sub">{m.sold} sold</div></span>
                <span className="num">{compact(m.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="section-grid eqrow">
        <div className="card">
          <div className="card-head"><h2>Recent Sales</h2><Link href="/sales/invoices">View all</Link></div>
          <table>
            <thead><tr><th>Invoice</th><th>Customer / Item</th><th className="num">Total</th><th>Status</th></tr></thead>
            <tbody>
              {d.recent.map((r: any) => (
                <tr key={r.id}>
                  <td className="m"><Link href={`/documents/${r.id}`}>{r.doc_no}</Link></td>
                  <td>{r.partner_code === "WALKIN" ? "Walk-in" : r.customer}{r.item ? ` · ${r.item}` : ""}</td>
                  <td className="num">{money(r.total)}</td>
                  <td>
                    {r.outstanding <= 0.005 ? <span className="pill ok">Paid</span>
                      : r.outstanding < r.total - 0.005 ? <span className="pill warn">Partial</span>
                      : <span className="pill warn">On account</span>}
                  </td>
                </tr>
              ))}
              {d.recent.length === 0 && <tr><td colSpan={4} className="page-sub">No sales yet.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-head"><h2>Low Stock</h2><span className="page-sub">Selling, nearly out</span></div>
          <div className="card-body">
            {d.low.length === 0 && <p className="page-sub">Nothing selling is running out.</p>}
            {d.low.map((l: any) => (
              <div className="listrow" key={l.name}>
                <span className="grow">
                  <div>{l.name}</div>
                  <div className="low" style={{ fontSize: "var(--t-sm)" }}>{l.left_} unit{l.left_ === 1 ? "" : "s"} left</div>
                </span>
                <span style={{ width: 110 }}>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(8, (l.left_ / 3) * 100)}%` }} /></div>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="stats">
        {seeCost && (
          <Stat icon={<Package size={20} />} tone="slate" label="Inventory Value" value={`${compact(d.stock.value)} MMK`}
            note={<Link href="/inventory">Inventory summary</Link>} />
        )}
        <Stat icon={<Clock size={20} />} tone="amber" label="Aged Phones" value={d.aged}
          note={<Link href="/reports/phone-stock">Unsold over 90 days</Link>} noteTone={d.aged ? "warn" : undefined} />
        <Stat icon={<ShieldAlert size={20} />} tone="violet" label="Warranties Ending" value={d.ending}
          note={<Link href="/inventory/warranty?ending=30">Within 30 days</Link>} />
        {d.bad.length > 0 && (
          <Stat icon={<AlertTriangle size={20} />} tone="amber" label="Serial / Stock Mismatch" value={d.bad.length}
            note={d.bad.map((b: any) => `${b.name}: ${b.serials} IMEIs vs ${b.on_hand} on hand`).join("; ")} noteTone="down" />
        )}
      </div>

      <div className="section-grid-2">
        <div className="card">
          <div className="card-head">
            <span><h2>Revenue by category</h2><span className="page-sub">Sales {period.cat.sentence}</span></span>
            <PeriodPicker current={period.cat} label="revenue by category" hrefFor={(k) => hrefWith("cat", k)} />
          </div>
          <div className="card-body"><ShareDonut data={categories} currency="MMK" /></div>
        </div>
        <div className="card">
          <div className="card-head">
            <span><h2>Revenue by state / region</h2><span className="page-sub">Sales {period.reg.sentence}</span></span>
            <PeriodPicker current={period.reg} label="revenue by state or region" hrefFor={(k) => hrefWith("reg", k)} />
          </div>
          <div className="card-body">
            {regions.length === 1 && regions[0].id === "none" ? (
              <div className="empty">
                No customer has a state or region yet.{" "}
                <Link href="/partners" style={{ color: "var(--link)" }}>Set one on a customer</Link> to see where revenue comes from.
              </div>
            ) : <ShareDonut data={regions} currency="MMK" />}
          </div>
        </div>
        {worthDrawing(custCategories) && (
          <div className="card">
            <div className="card-head">
              <span><h2>Revenue by customer type</h2><span className="page-sub">Revenue {period.cust.sentence}</span></span>
              <PeriodPicker current={period.cust} label="revenue by customer type" hrefFor={(k) => hrefWith("cust", k)} />
            </div>
            <div className="card-body"><ShareDonut data={custCategories} currency="MMK" /></div>
          </div>
        )}
        {worthDrawing(suppCategories) && (
          <div className="card">
            <div className="card-head">
              <span><h2>Purchases by supplier type</h2><span className="page-sub">Purchases {period.supp.sentence}</span></span>
              <PeriodPicker current={period.supp} label="purchases by supplier type" hrefFor={(k) => hrefWith("supp", k)} />
            </div>
            <div className="card-body"><ShareDonut data={suppCategories} currency="MMK" /></div>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: "var(--s3)" }}>
        <div className="card-head">
          <span><h2>Accounting health</h2><span className="page-sub" style={{ display: "block" }}>Automated checks between operational ledgers and the general ledger</span></span>
          <span className={`pill ${healthy ? "ok" : "overdue"}`}>
            {healthy ? <Check size={13} aria-hidden="true" /> : <AlertTriangle size={13} aria-hidden="true" />}
            {" "}{healthy ? "Healthy" : "Needs attention"}
          </span>
        </div>
        <div className="card-body">
          <div className="dash-health">
            {checks.map((c) => (
              <div key={c.label} className={`dash-health-item${c.ok ? "" : " bad"}`}>
                <span className="dash-health-mark" aria-hidden="true">
                  {c.ok ? <Check size={14} /> : <AlertTriangle size={14} />}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="dash-kpi-note" style={{ display: "block" }}>{c.label}</span>
                  <strong>{c.value}</strong>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Recent activity</h2>
          <Link href="/documents">View all documents <ArrowRight size={14} style={{ verticalAlign: "-2px" }} /></Link>
        </div>
        <div className="card-body">
          {recent.length === 0 ? (
            <div className="empty">Nothing posted yet.</div>
          ) : (
            <div className="dash-activity">
              {recent.map((r) => {
                const mark = TYPE_MARK[r.doc_type] ?? { short: "DOC", tint: "var(--muted)" };
                return (
                  <Link key={r.id} href={`/documents/${r.id}`} className="dash-activity-row">
                    <span className="dash-activity-mark" style={{
                      color: mark.tint, background: `color-mix(in srgb, ${mark.tint} 10%, transparent)`,
                    }}>{mark.short}</span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 500, display: "block" }}>{r.doc_no ?? "—"}</span>
                      <span className="dash-kpi-note">
                        {r.doc_type.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}
                        {r.partner_name ? ` · ${r.partner_name}` : ""}
                      </span>
                    </span>
                    <span className="dash-activity-right">
                      <span>
                        <span style={{ fontWeight: 700, display: "block" }}>MMK {money(r.gross_total)}</span>
                        <span className="dash-kpi-note">{since(r.posted_at, r.posting_date)}</span>
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

    </>
  );
}

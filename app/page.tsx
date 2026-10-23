import { seenLocations } from "@/lib/branch-scope";
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
  getTopCategories, getRevenueByRegion, getRevenueByBranch, getReceiptsByAccount, getRevenueByCustomerCategory, getSpendBySupplierCategory, getDocuments,
  getHealth,
} from "@/lib/queries";
import { getLocale, getTranslations } from "next-intl/server";

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
  CUSTOMER_REFUND: { short: "RF", tint: "var(--bad)" },
  STOCK_TRANSFER: { short: "TR", tint: "var(--muted)" },
  STOCK_ADJUSTMENT: { short: "ADJ", tint: "var(--muted)" },
};

const since = (at: string | null, on: string,
  t: Awaited<ReturnType<typeof getTranslations<"dashboard">>>, dateLocale: string) => {
  const ms = at ? new Date(at).getTime() : new Date(on).getTime();
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 1) return t("justNow");
  if (mins < 60) return t("minAgo", { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t("hoursAgo", { n: hours });
  return new Date(on).toLocaleDateString(dateLocale, { day: "numeric", month: "short" });
};

/** The document types the dashboard names; anything else is said as its code. */
const DOC_TYPES = new Set(["GOODS_RECEIPT", "PURCHASE_ORDER", "PURCHASE_INVOICE", "SUPPLIER_PAYMENT",
  "SALES_ORDER", "DELIVERY", "SALES_INVOICE", "CUSTOMER_RECEIPT", "STOCK_TRANSFER", "STOCK_ADJUSTMENT"]);

/* A breakdown where nothing has been filed is one slice reading "Not
   categorised" — a circle around the whole company that tells nobody
   anything. */
const worthDrawing = (rows: { id: string }[]) =>
  rows.length > 0 && !(rows.length === 1 && rows[0].id === "none");

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await currentUser();
  if (!user) return null;
  const t = await getTranslations("dashboard");
  // Dates in the reader's language: Burmese month names and digits under Myanmar.
  const dateLocale = (await getLocale()) === "my" ? "my-MM" : "en-GB";
  const when = (p: { key: string; month: string | null; label: string }) =>
    p.month ? t("periodMonth", { month: new Date(`${p.month}-01T00:00:00Z`).toLocaleDateString(dateLocale, { month: "long", year: "numeric", timeZone: "UTC" }) })
      : t(`period.${p.key}`);
  const sp = await searchParams;
  const { denied } = sp;
  // One window per donut, as on the business overview: each card's period
  // picker edits its own key in the URL and leaves the others alone.
  const period = { cat: resolvePeriod(sp.cat), reg: resolvePeriod(sp.reg),
                   cust: resolvePeriod(sp.cust), supp: resolvePeriod(sp.supp), branch: resolvePeriod(sp.branch), pay: resolvePeriod(sp.pay) };
  const hrefWith = (key: string, value: string) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(sp)) if (v && k !== "denied") next[k] = v;
    if (value === DEFAULT_PERIOD) delete next[key];
    else next[key] = value;
    const q = new URLSearchParams(next).toString();
    return q ? `/?${q}` : "/";
  };
  const co = user.companyId;
  const [d, cats, regionRows, branchRows, payRows, custRows, suppRows, recentDocs, health] = await Promise.all([
    seenLocations().then((locs) => retailDashboard(co, locs)),
    getTopCategories(co, period.cat.from, period.cat.to),
    getRevenueByRegion(co, period.reg.from, period.reg.to),
    seenLocations().then((locs) => getRevenueByBranch(co, period.branch.from, period.branch.to, locs)),
    seenLocations().then((locs) => getReceiptsByAccount(co, period.pay.from, period.pay.to, locs)),
    getRevenueByCustomerCategory(co, period.cust.from, period.cust.to),
    getSpendBySupplierCategory(co, period.supp.from, period.supp.to),
    seenLocations().then((locs) => getDocuments(co, undefined, undefined, 5, locs)),
    getHealth(co),
  ]);
  const categories = cats as unknown as Share[];
  const regions = regionRows as unknown as Share[];
  const branches = branchRows as unknown as Share[];
  const payments = payRows as unknown as Share[];
  // A shop whose customers have no region set has no use for a region chart;
  // it is kept for the distributor who does, and the branch chart takes its place.
  const hasRegions = !(regions.length === 0 || (regions.length === 1 && regions[0].id === "none"));
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
  const date = new Date().toLocaleDateString(dateLocale, {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Yangon" });

  return (
    <>
      <div className="page-head hero">
        <h1>{t("title")}</h1>
        <p className="page-sub">{date}</p>
      </div>

      {denied && (
        <div className="alert" role="alert">{t("denied", { page: denied })}</div>
      )}

      <div className="stats">
        <Stat icon={<Banknote size={20} />} label={t("todaysSales")} value={`${compact(d.today.revenue)} MMK`}
          note={change === null ? t("noSalesYesterday") : t("vsYesterday", { pct: `${change >= 0 ? "+" : ""}${change.toFixed(1)}` })}
          noteTone={change === null ? undefined : change >= 0 ? "up" : "down"} />
        {seeCost && (
          <Stat icon={<TrendingUp size={20} />} tone="slate" label={t("grossProfit")} value={`${compact(gp)} MMK`}
            note={t("margin", { pct: margin.toFixed(1) })} />
        )}
        <Stat icon={<Smartphone size={20} />} tone="violet" label={t("phonesSold")} value={t("units", { n: d.today.phones })}
          note={t("yesterday", { n: d.yesterday.phones })} />
        <Stat icon={<Users size={20} />} tone="amber" label={t("receivables")} value={`${compact(d.ar.owed)} MMK`}
          note={t("customersDue", { n: d.ar.customers })} noteTone="warn" />
      </div>

      <div className="section-grid eqrow">
        <div className="card">
          <div className="card-head"><h2>{t("salesPerformance")}</h2><span className="page-sub">{t("last7")}</span></div>
          <div className="card-body"><WeekBars data={(d.week as unknown as { day: string; label: string; revenue: number }[]).map((w) => ({
            ...w, label: new Date(`${w.day}T00:00:00Z`).toLocaleDateString(dateLocale, { weekday: "short", timeZone: "UTC" }) }))} /></div>
        </div>
        <div className="card">
          <div className="card-head"><h2>{t("topModels")}</h2><span className="page-sub">{t("last30")}</span></div>
          <div className="card-body">
            {d.topModels.length === 0 && <p className="page-sub">{t("noPhonesSold")}</p>}
            {d.topModels.slice(0, 5).map((m: any) => (
              <div className="listrow" key={m.model}>
                <span className="grow prod-text"><div className="prod-name clamp2" title={m.model}>{m.model}</div><div className="prod-sub">{t("sold", { n: m.sold })}</div></span>
                <span className="num">{compact(m.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="section-grid eqrow">
        <div className="card">
          <div className="card-head"><h2>{t("recentSales")}</h2><Link href="/sales/invoices">{t("viewAll")}</Link></div>
          <table>
            <thead><tr><th>{t("invoice")}</th><th>{t("customerItem")}</th><th className="num">{t("total")}</th><th>{t("status")}</th></tr></thead>
            <tbody>
              {d.recent.slice(0, 5).map((r: any) => (
                <tr key={r.id}>
                  <td className="m"><Link href={`/documents/${r.id}`}>{r.doc_no}</Link></td>
                  <td>{r.partner_code === "WALKIN" ? t("walkIn") : r.customer}{r.item ? ` · ${r.item}` : ""}</td>
                  <td className="num">{money(r.total)}</td>
                  <td>
                    {r.outstanding <= 0.005 ? <span className="pill ok">{t("paid")}</span>
                      : r.outstanding < r.total - 0.005 ? <span className="pill warn">{t("partial")}</span>
                      : <span className="pill warn">{t("onAccount")}</span>}
                  </td>
                </tr>
              ))}
              {d.recent.length === 0 && <tr><td colSpan={4} className="page-sub">{t("noSales")}</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-head"><h2>{t("lowStock")}</h2><span className="page-sub">{t("lowStockSub")}</span></div>
          <div className="card-body">
            {d.low.length === 0 && <p className="page-sub">{t("nothingLow")}</p>}
            {d.low.slice(0, 5).map((l: any) => (
              <div className="listrow" key={l.name}>
                <span className="grow">
                  <div>{l.name}</div>
                  <div className="low" style={{ fontSize: "var(--t-sm)" }}>{t("left", { n: l.left_ })}</div>
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
          <Stat icon={<Package size={20} />} tone="slate" label={t("inventoryValue")} value={`${compact(d.stock.value)} MMK`}
            note={<Link href="/inventory">{t("inventorySummary")}</Link>} />
        )}
        <Stat icon={<Clock size={20} />} tone="amber" label={t("agedPhones")} value={d.aged}
          note={<Link href="/reports/phone-stock">{t("unsold90")}</Link>} noteTone={d.aged ? "warn" : undefined} />
        <Stat icon={<ShieldAlert size={20} />} tone="violet" label={t("warrantiesEnding")} value={d.ending}
          note={<Link href="/inventory/warranty?ending=30">{t("within30")}</Link>} />
        {d.bad.length > 0 && (
          <Stat icon={<AlertTriangle size={20} />} tone="amber" label={t("mismatch")} value={d.bad.length}
            note={d.bad.map((b: any) => t("mismatchItem", { name: b.name, serials: b.serials, onHand: b.on_hand })).join("; ")} noteTone="down" />
        )}
      </div>

      <div className="section-grid-2">
        <div className="card">
          <div className="card-head">
            <span><h2>{t("byCategory")}</h2><span className="page-sub">{t("salesIn", { when: when(period.cat) })}</span></span>
            <PeriodPicker current={period.cat} label={t("byCategoryLabel")} hrefFor={(k) => hrefWith("cat", k)} />
          </div>
          <div className="card-body"><ShareDonut data={categories} currency="MMK" /></div>
        </div>
        {hasRegions ? (
          <div className="card">
            <div className="card-head">
              <span><h2>{t("byRegion")}</h2><span className="page-sub">{t("salesIn", { when: when(period.reg) })}</span></span>
              <PeriodPicker current={period.reg} label={t("byRegionLabel")} hrefFor={(k) => hrefWith("reg", k)} />
            </div>
            <div className="card-body"><ShareDonut data={regions} currency="MMK" /></div>
          </div>
        ) : branches.length > 1 && (
          <div className="card">
            <div className="card-head">
              <span><h2>{t("byBranch")}</h2><span className="page-sub">{t("salesIn", { when: when(period.branch) })}</span></span>
              <PeriodPicker current={period.branch} label={t("byBranchLabel")} hrefFor={(k) => hrefWith("branch", k)} />
            </div>
            <div className="card-body"><ShareDonut data={branches} currency="MMK" /></div>
          </div>
        )}
        {payments.length > 1 && (
          <div className="card">
            <div className="card-head">
              <span><h2>{t("byPayment")}</h2><span className="page-sub">{t("receivedIn", { when: when(period.pay) })}</span></span>
              <PeriodPicker current={period.pay} label={t("byPaymentLabel")} hrefFor={(k) => hrefWith("pay", k)} />
            </div>
            <div className="card-body"><ShareDonut data={payments} currency="MMK" /></div>
          </div>
        )}
        {worthDrawing(custCategories) && (
          <div className="card">
            <div className="card-head">
              <span><h2>{t("byCustomerType")}</h2><span className="page-sub">{t("revenueIn", { when: when(period.cust) })}</span></span>
              <PeriodPicker current={period.cust} label={t("byCustomerTypeLabel")} hrefFor={(k) => hrefWith("cust", k)} />
            </div>
            <div className="card-body"><ShareDonut data={custCategories} currency="MMK" /></div>
          </div>
        )}
        {worthDrawing(suppCategories) && (
          <div className="card">
            <div className="card-head">
              <span><h2>{t("bySupplierType")}</h2><span className="page-sub">{t("purchasesIn", { when: when(period.supp) })}</span></span>
              <PeriodPicker current={period.supp} label={t("bySupplierTypeLabel")} hrefFor={(k) => hrefWith("supp", k)} />
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
            {" "}{healthy ? t("healthy") : t("needsAttention")}
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
          <h2>{t("recentActivity")}</h2>
          <Link href="/documents">{t("viewAllDocs")} <ArrowRight size={14} style={{ verticalAlign: "-2px" }} /></Link>
        </div>
        <div className="card-body">
          {recent.length === 0 ? (
            <div className="empty">{t("nothingPosted")}</div>
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
                        {DOC_TYPES.has(r.doc_type) ? t(`docType.${r.doc_type}`) : r.doc_type.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}
                        {r.partner_name ? ` · ${r.partner_name}` : ""}
                      </span>
                    </span>
                    <span className="dash-activity-right">
                      <span>
                        <span style={{ fontWeight: 700, display: "block" }}>MMK {money(r.gross_total)}</span>
                        <span className="dash-kpi-note">{since(r.posted_at, r.posting_date, t, dateLocale)}</span>
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

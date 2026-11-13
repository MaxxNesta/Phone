import Link from "next/link";
import { Banknote, Receipt, Calculator, Smartphone, TrendingUp, Users, ScanLine } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { requirePermission, can } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { salesOverview } from "@/lib/overviews";
import { money } from "@/lib/format";
import { KpiCard } from "@/components/kpi-card";
import { SalesComboCard } from "@/components/sales-combo-card";
import { salesLast30 } from "@/lib/queries";

export const metadata = { title: "Sales overview" };

/**
 * The Sales menu's landing page: today's selling at the branches the reader
 * sees. Gross profit only for those who may see cost, as at the till.
 */
export default async function SalesOverview() {
  const user = await requirePermission("sales.view");
  const t = await getTranslations("overview");
  const dateLocale = (await getLocale()) === "my" ? "my-MM" : "en-GB";
  const locs = await seenLocations();
  const [d, perf] = await Promise.all([salesOverview(user.companyId, locs), salesLast30(user.companyId, locs)]);
  const seeCost = can(user, "cost.view");
  const { kpi } = d;
  const gp = kpi.revenue - kpi.cost;
  const takingsTotal = d.takings.reduce((s, x) => s + x.revenue, 0);
  const day = (s: string, o: Intl.DateTimeFormatOptions) => new Date(`${s}T00:00:00Z`).toLocaleDateString(dateLocale, { ...o, timeZone: "UTC" });

  return (
    <>
      <div className="page-head hero">
        <h1>{t("salesTitle")}</h1>
        <p className="page-sub">{t("salesSub", { date: day(d.today, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) })}</p>
        {can(user, "pos.sell") && (
          <div className="head-actions"><Link className="btn" href="/pos"><ScanLine size={15} aria-hidden="true" /> {t("openPos")}</Link></div>
        )}
      </div>

      <div className="kpis kpis-tiled kpis-compact ov-kpis">
        <KpiCard icon={<Banknote size={16} aria-hidden="true" />} label={t("todaysSales")} value={money(kpi.revenue)} unit="MMK" hint={t("todaysSalesHint")} />
        <KpiCard icon={<Receipt size={16} aria-hidden="true" />} label={t("salesCount")} value={kpi.sales} hint={t("salesCountHint")} />
        <KpiCard icon={<Calculator size={16} aria-hidden="true" />} label={t("avgSale")} value={money(kpi.sales ? kpi.revenue / kpi.sales : 0)} unit="MMK" hint={t("avgSaleHint")} />
        <KpiCard icon={<Smartphone size={16} aria-hidden="true" />} label={t("phonesSold")} value={kpi.phones} hint={t("phonesSoldHint")} />
        {seeCost && (
          <KpiCard icon={<TrendingUp size={16} aria-hidden="true" />} label={t("grossProfit")} value={money(gp)} unit="MMK"
            hint={t("grossProfitHint", { pct: kpi.revenue ? ((gp / kpi.revenue) * 100).toFixed(1) : "0" })} />
        )}
        <KpiCard icon={<Users size={16} aria-hidden="true" />} label={t("receivables")} value={money(d.ar.owed)} unit="MMK"
          hint={t("receivablesHint", { n: d.ar.customers })} />
      </div>

      <div className="section-grid eqrow">
        <SalesComboCard title={t("salesByDay")} rows={perf.rows} now={perf.now} before={perf.before}
          from={perf.from} to={perf.to} showProfit={seeCost} />
        <div className="card">
          <div className="card-head"><h2>{t("takings")}</h2><span className="page-sub">{t("today")}</span></div>
          <div className="card-body">
            <p className="page-sub ov-sub">{t("takingsSub")}</p>
            {d.takings.length === 0 && <p className="page-sub">{t("noTakings")}</p>}
            {d.takings.map((x) => (
              <div className="listrow" key={x.id}>
                <span className="grow"><div>{x.name}</div><div className="prod-sub">{t("payments", { n: x.receipts })}</div></span>
                <span className="num">{money(x.revenue)}</span>
              </div>
            ))}
            {d.takings.length > 0 && (
              <div className="listrow ov-total"><span className="grow">{t("total")}</span><span className="num">{money(takingsTotal)}</span></div>
            )}
          </div>
        </div>
      </div>

      <div className="section-grid eqrow">
        <div className="card">
          <div className="card-head"><h2>{t("recentSales")}</h2><Link href="/sales/invoices">{t("viewAll")}</Link></div>
          <table className="ov-table">
            <thead><tr><th>{t("colSale")}</th><th>{t("colDate")}</th><th>{t("colCustomer")}</th><th className="num">{t("colItems")}</th><th className="num">{t("colTotal")}</th><th>{t("colStatus")}</th></tr></thead>
            <tbody>
              {d.recent.map((r) => (
                <tr key={r.id}>
                  <td className="m"><Link href={`/documents/${r.id}`}>{r.doc_no}</Link></td>
                  <td className="nowrap">{day(r.date, { day: "numeric", month: "short" })}</td>
                  <td className="ov-name">{r.walk_in ? t("walkIn") : r.customer}</td>
                  <td className="num">{r.items}</td>
                  <td className="num">{money(r.total)}</td>
                  <td>{r.voided ? <span className="pill reversed">{t("voided")}</span>
                    : r.outstanding <= 0.005 ? <span className="pill ok">{t("paid")}</span>
                    : r.outstanding < r.total - 0.005 ? <span className="pill warn">{t("partial")}</span>
                    : <span className="pill warn">{t("onAccount")}</span>}</td>
                </tr>
              ))}
              {d.recent.length === 0 && <tr><td colSpan={6} className="page-sub">{t("noSales")}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="card-head"><h2>{t("topModels")}</h2><span className="page-sub">{t("last30")}</span></div>
          <div className="card-body">
            {d.top.length === 0 && <p className="page-sub">{t("noPhones")}</p>}
            {d.top.map((m) => (
              <div className="listrow" key={m.model}>
                <span className="grow prod-text"><div className="prod-name clamp2" title={m.model}>{m.model}</div><div className="prod-sub">{t("sold", { n: m.sold })}</div></span>
                <span className="num">{money(m.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

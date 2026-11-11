import { lowStockHref } from "@/lib/plans";
import { getCompany } from "@/lib/queries";
import Link from "next/link";
import { ShoppingBag, FileText, Wallet, CalendarClock, Plus } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { requirePermission, can } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { purchasesOverview } from "@/lib/overviews";
import { money } from "@/lib/format";
import { KpiCard } from "@/components/kpi-card";

export const metadata = { title: "Purchases overview" };

/**
 * The Purchases menu's landing page: this month's buying. What is owed to
 * suppliers shows only to those who may see payables (accounting), low stock
 * only to those who may see inventory.
 */
export default async function PurchasesOverview() {
  const user = await requirePermission("purchase.view");
  const t = await getTranslations("overview");
  const dateLocale = (await getLocale()) === "my" ? "my-MM" : "en-GB";
  const see = { payables: can(user, "accounting.view"), stock: can(user, "inventory.view") };
  const d = await purchasesOverview(user.companyId, await seenLocations(), see);
  const day = (s: string, o: Intl.DateTimeFormatOptions) => new Date(`${s}T00:00:00Z`).toLocaleDateString(dateLocale, { ...o, timeZone: "UTC" });
  const p = d.payables;
  const company = await getCompany();
  const lowHref = company ? lowStockHref(company.plan) : "/items/stock";

  return (
    <>
      <div className="page-head hero">
        <h1>{t("purchasesTitle")}</h1>
        <p className="page-sub">{t("purchasesSub", { month: day(d.today, { month: "long", year: "numeric" }) })}</p>
        {can(user, "purchase.post") && (
          <div className="head-actions"><Link className="btn" href="/purchases/new"><Plus size={15} aria-hidden="true" /> {t("newBill")}</Link></div>
        )}
      </div>

      <div className="kpis kpis-tiled kpis-compact ov-kpis">
        <KpiCard icon={<ShoppingBag size={16} aria-hidden="true" />} label={t("spend")} value={money(d.month.spend)} unit="MMK" hint={t("spendHint")} />
        <KpiCard icon={<FileText size={16} aria-hidden="true" />} label={t("bills")} value={d.month.invoices} hint={t("billsHint")} />
        {see.payables && <>
          <KpiCard icon={<Wallet size={16} aria-hidden="true" />} label={t("payablesOwed")} value={money(p.owed)} unit="MMK"
            hint={t("payablesOwedHint", { n: p.invoices, overdue: money(p.overdue) })} tone={p.overdue > 0.005 ? "warn" : undefined} />
          <KpiCard icon={<CalendarClock size={16} aria-hidden="true" />} label={t("dueWeek")} value={money(p.due.total)} unit="MMK"
            hint={t("dueWeekHint", { n: p.due.invoices })} />
        </>}
      </div>

      <div className="section-grid eqrow">
        <div className="card">
          <div className="card-head"><h2>{t("recentBills")}</h2><Link href="/purchases/invoices">{t("viewAll")}</Link></div>
          <table className="ov-table">
            <thead><tr><th>{t("colInvoice")}</th><th>{t("colDate")}</th><th>{t("colSupplier")}</th><th className="num">{t("colItems")}</th><th className="num">{t("colTotal")}</th>{see.payables && <th>{t("colStatus")}</th>}</tr></thead>
            <tbody>
              {d.recent.map((r) => (
                <tr key={r.id}>
                  <td className="m"><Link href={`/documents/${r.id}`}>{r.doc_no}</Link></td>
                  <td className="nowrap">{day(r.date, { day: "numeric", month: "short" })}</td>
                  <td className="ov-name">{r.supplier}</td>
                  <td className="num">{r.items}</td>
                  <td className="num">{money(r.total)}</td>
                  {see.payables && <td>{r.voided ? <span className="pill reversed">{t("voided")}</span>
                    : r.outstanding <= 0.005 ? <span className="pill ok">{t("paid")}</span>
                    : r.outstanding < r.total - 0.005 ? <span className="pill warn">{t("partial")}</span>
                    : <span className="pill warn">{t("unpaid")}</span>}</td>}
                </tr>
              ))}
              {d.recent.length === 0 && <tr><td colSpan={6} className="page-sub">{t("noBills")}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="card-head"><h2>{t("topSuppliers")}</h2><span className="page-sub">{t("thisMonth")}</span></div>
          <div className="card-body">
            {d.top.length === 0 && <p className="page-sub">{t("noSpend")}</p>}
            {d.top.map((s) => (
              <div className="listrow" key={s.id}>
                <span className="grow prod-text"><div className="prod-name clamp2" title={s.name}>{s.name}</div><div className="prod-sub">{t("invoicesN", { n: s.invoices })}</div></span>
                <span className="num">{money(s.spend)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {(see.payables || see.stock) && (
        <div className="section-grid eqrow">
          {see.payables && (
            <div className="card">
              <div className="card-head"><h2>{t("unpaidBills")}</h2><Link href="/payables">{t("viewAll")}</Link></div>
              <table className="ov-table">
                <thead><tr><th>{t("colInvoice")}</th><th>{t("colSupplier")}</th><th>{t("colDue")}</th><th className="num">{t("colOwed")}</th></tr></thead>
                <tbody>
                  {p.unpaid.map((b) => (
                    <tr key={b.id}>
                      <td className="m"><Link href={`/documents/${b.id}`}>{b.doc_no}</Link></td>
                      <td className="ov-name">{b.supplier}</td>
                      <td className="nowrap">{b.due_date ? <>{day(b.due_date, { day: "numeric", month: "short" })}{b.due_date < d.today && <> <span className="pill overdue">{t("overdue")}</span></>}</> : t("noDue")}</td>
                      <td className="num">{money(b.outstanding)}</td>
                    </tr>
                  ))}
                  {p.unpaid.length === 0 && <tr><td colSpan={4} className="page-sub">{t("nothingOwed")}</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {see.stock && (
            <div className="card">
              <div className="card-head"><h2>{t("lowStock")}</h2><Link href={lowHref}>{t("viewAll")}</Link></div>
              <div className="card-body">
                <p className="page-sub ov-sub">{t("lowStockSub")}</p>
                {d.low.length === 0 && <p className="page-sub">{t("nothingLow")}</p>}
                {d.low.map((l) => (
                  <div className="listrow" key={l.name}>
                    <span className="grow prod-text"><div className="prod-name clamp2" title={l.name}>{l.name}</div><div className="prod-sub">{t("sold60", { n: l.sold_60 })}</div></span>
                    <span className="num low">{t("left", { n: l.left_ })}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

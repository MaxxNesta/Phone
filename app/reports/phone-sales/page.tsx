import Link from "next/link";
import { requirePermission, can } from "@/lib/auth";
import { phoneSales, SALES_DIMENSIONS, type SalesDimension, stripCost } from "@/lib/phone";
import { money } from "@/lib/format";
import { Stat, compact } from "@/components/stat";
import { RankedBarChart } from "@/components/charts";
import { Banknote, TrendingUp, Percent, Smartphone } from "lucide-react";
import { paginate } from "@/lib/paging";
import { Pager } from "@/components/pager";

export const metadata = { title: "Sales & margin" };

type Search = { from?: string; to?: string; by?: string; scope?: string; page?: string };

export default async function PhoneSalesReport({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("reports.view");
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const from = sp.from || today.slice(0, 8) + "01";
  const to = sp.to || today;
  const by = (sp.by && sp.by in SALES_DIMENSIONS ? sp.by : "model") as SalesDimension;
  const phonesOnly = sp.scope !== "all";
  const seeCost = can(user, "cost.view");

  const raw = await phoneSales(user.companyId, from, to, by, phonesOnly);
  const rows = stripCost(raw as Record<string, any>[], seeCost);
  const sum = (k: string) => raw.reduce((s, r: any) => s + Number(r[k] ?? 0), 0);
  const revenue = sum("revenue"), cost = sum("cost"), units = sum("units");
  const href = (b: string) => `/reports/phone-sales?${new URLSearchParams({ from, to, by: b, scope: sp.scope ?? "" })}`;

  const pg = paginate(rows, sp.page);
  return (
    <>
      <div className="page-head hero">
        <h1>Sales &amp; margin</h1>
        <p className="page-sub">
          Posted invoices less customer returns. Cost of sales is the exact cost each invoice posted —
          the same figures the ledger carries.
        </p>
      </div>

      <form className="card filters" method="get">
        <div className="card-body filter-row">
          <div className="field"><label htmlFor="rf">From</label><input id="rf" type="date" name="from" defaultValue={from} /></div>
          <div className="field"><label htmlFor="rt">To</label><input id="rt" type="date" name="to" defaultValue={to} /></div>
          <div className="field">
            <label htmlFor="rs">Products</label>
            <select id="rs" name="scope" defaultValue={sp.scope ?? ""}>
              <option value="">Phones only</option>
              <option value="all">Phones and accessories</option>
            </select>
          </div>
          <input type="hidden" name="by" value={by} />
          <button className="btn">Show</button>
        </div>
      </form>

      <div className="stats">
        <Stat icon={<Banknote size={20} />} label="Revenue" value={`${compact(revenue)} MMK`} />
        {seeCost && <Stat icon={<TrendingUp size={20} />} tone="slate" label="Gross Profit" value={`${compact(revenue - cost)} MMK`} />}
        {seeCost && <Stat icon={<Percent size={20} />} tone="violet" label="Gross Margin"
          value={revenue ? `${(((revenue - cost) / revenue) * 100).toFixed(1)}%` : "—"} />}
        <Stat icon={<Smartphone size={20} />} tone="amber" label="Units" value={units} />
      </div>

      <div className="chips" style={{ marginBottom: "var(--s3)" }} role="group" aria-label="Group by">
        {Object.entries(SALES_DIMENSIONS).map(([k, l]) => (
          <Link key={k} href={href(k)} className="chip" data-on={k === by}>{l}</Link>
        ))}
      </div>

      <div className="section-grid">
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>{SALES_DIMENSIONS[by]}</th><th className="num">Units</th><th className="num">Revenue</th>
                {seeCost && <><th className="num">COGS</th><th className="num">Gross profit</th><th className="num">Margin</th></>}
              </tr>
            </thead>
            <tbody>
              {pg.rows.map((r: any) => (
                <tr key={r.key}>
                  <td className={by === "imei" ? "m" : undefined}>{r.key}</td>
                  <td className="num">{r.units}</td>
                  <td className="num">{money(r.revenue)}</td>
                  {seeCost && <>
                    <td className="num">{money(r.cost)}</td>
                    <td className="num">{money(r.gross_profit)}</td>
                    <td className="num">{r.margin_pct != null ? `${r.margin_pct}%` : "—"}</td>
                  </>}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="page-sub">No sales in this period.</td></tr>}
            </tbody>
          </table>
          <Pager p={pg} params={sp} />
        </div>
        <div className="card">
          <div className="card-head"><h2>Revenue by {SALES_DIMENSIONS[by].toLowerCase()}</h2></div>
          <div className="card-body">
            <RankedBarChart compact data={raw.slice(0, 10).map((r: any) => ({ label: String(r.key), value: Number(r.revenue) }))} />
          </div>
        </div>
      </div>
    </>
  );
}

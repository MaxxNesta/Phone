import { requirePermission, can } from "@/lib/auth";
import { phoneStockSummary } from "@/lib/phone";
import { money } from "@/lib/format";

export const metadata = { title: "Stock & aging" };

/** Fast and slow is about cover: how many days of selling the stock holds. */
function pace(units: number, sold30: number) {
  if (sold30 === 0) return ["Not selling", "reversed"] as const;
  const days = Math.round((units / sold30) * 30);
  if (days <= 30) return [`Fast · ${days} d cover`, "ok"] as const;
  if (days <= 90) return [`Steady · ${days} d cover`, "draft"] as const;
  return [`Slow · ${days} d cover`, "warn"] as const;
}

export default async function PhoneStockReport() {
  const user = await requirePermission("reports.view");
  const seeCost = can(user, "cost.view");
  const rows = await phoneStockSummary(user.companyId);

  return (
    <>
      <div className="page-head">
        <h1>Phone stock &amp; aging</h1>
        <p className="page-sub">Handsets on the shelf by model and branch, how long they have waited, and how fast each model sells</p>
      </div>
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Model</th><th>Brand</th><th>Branch</th><th className="num">Units</th>
              {seeCost && <th className="num">Value</th>}
              <th className="num">0–30 d</th><th className="num">31–60 d</th><th className="num">61–90 d</th>
              <th className="num">90+ d</th><th className="num">Avg age</th>
              <th className="num">Sold 30 d</th><th className="num">Sold 90 d</th><th>Pace</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any, i: number) => {
              const [label, tone] = pace(r.units, r.sold_30);
              return (
                <tr key={i}>
                  <td>{r.model_name}</td><td>{r.brand_name ?? "—"}</td><td>{r.branch}</td>
                  <td className="num">{r.units}</td>
                  {seeCost && <td className="num">{money(r.value)}</td>}
                  <td className="num">{r.d0_30}</td><td className="num">{r.d31_60}</td>
                  <td className="num">{r.d61_90}</td><td className={`num${r.d90 ? " low" : ""}`}>{r.d90}</td>
                  <td className="num">{r.avg_age} d</td>
                  <td className="num">{r.sold_30}</td><td className="num">{r.sold_90}</td>
                  <td><span className={`pill ${tone}`}>{label}</span></td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={13} className="page-sub">No phones on the shelf.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

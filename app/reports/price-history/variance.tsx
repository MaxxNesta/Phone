import Link from "next/link";
import { money, shortDate } from "@/lib/format";
import type { OrderVarianceRow } from "@/lib/queries";

/**
 * Order against invoice, line by line: what was agreed on the purchase order
 * and what the supplier billed for it. Only the order → goods receipt → bill
 * route can differ — a bill raised straight from an order is held to the
 * order's price by the posting engine — so a gap here is a bill that came in
 * above or below what was agreed. A flag to look into, not a finding of fault:
 * nothing says whether the supplier overcharged or the order was keyed wrong.
 */
export function OrderVariance({ rows, all, keep }: {
  rows: OrderVarianceRow[]; all: boolean; keep: (o: Record<string, string | undefined>) => string;
}) {
  const withGap = rows.map((r) => {
    const unit = r.invoice_price - r.order_price;
    return { ...r, unit, total: unit * r.qty, pct: r.order_price > 0 ? unit / r.order_price : null };
  });
  const differs = withGap.filter((r) => Math.abs(r.unit) >= 0.005);
  const above = differs.filter((r) => r.unit > 0).reduce((t, r) => t + r.total, 0);
  const below = differs.filter((r) => r.unit < 0).reduce((t, r) => t + r.total, 0);
  const shown = (all ? withGap : differs).sort((a, b) => Math.abs(b.total) - Math.abs(a.total) || b.date.localeCompare(a.date));

  return (
    <>
      <div className="kpis ph-kpis">
        <div className="kpi"><div className="kpi-label">Lines from orders</div><div className="kpi-value">{rows.length.toLocaleString("en-US")}</div><div className="kpi-note">billed in the period</div></div>
        <div className="kpi"><div className="kpi-label">Price differs</div><div className="kpi-value">{differs.length.toLocaleString("en-US")}</div>
          <div className="kpi-note">{rows.length ? `${Math.round((differs.length / rows.length) * 100)}% of lines` : "—"}</div></div>
        <div className="kpi"><div className="kpi-label">Billed above order</div><div className="kpi-value">{money(above)}</div><div className="kpi-note">MMK, more than agreed</div></div>
        <div className="kpi"><div className="kpi-label">Billed below order</div><div className="kpi-value">{money(Math.abs(below))}</div><div className="kpi-note">MMK, less than agreed</div></div>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Order vs invoice</h2>
          <div className="scopetabs" role="tablist" aria-label="Lines">
            <Link scroll={false} className="scopetab" data-active={!all} href={keep({ only: undefined })}>Different price</Link>
            <Link scroll={false} className="scopetab" data-active={all} href={keep({ only: "all" })}>All ordered lines</Link>
          </div>
        </div>
        <div className="tablewrap">
          <table className="ph-table">
            <thead>
              <tr>
                <th>Date</th><th>Product / SKU</th><th>Supplier</th><th>Invoice</th><th>Order</th>
                <th className="r">Qty / Unit</th><th className="r">Order price</th><th className="r">Invoice price</th>
                <th className="r">Difference / unit</th><th className="r">Total (MMK)</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={`${r.doc_id}-${i}`}>
                  <td>{shortDate(r.date)}</td>
                  <td className="wrapcell"><div className="ph-prod">{r.item}</div><div className="ph-sku">{r.code}</div></td>
                  <td>{r.partner}</td>
                  <td><Link href={`/documents/${r.doc_id}`}>{r.doc_no}</Link></td>
                  <td><Link href={`/documents/${r.order_id}`}>{r.order_no}</Link><div className="ph-sku">{shortDate(r.order_date)}</div></td>
                  <td className="r">{r.qty.toLocaleString("en-US")} {r.uom}</td>
                  <td className="r">{money(r.order_price)}</td>
                  <td className="r ph-base">{money(r.invoice_price)}</td>
                  <td className="r">
                    {Math.abs(r.unit) < 0.005 ? <span className="ph-flat">Same</span> : (
                      <span className={r.unit > 0 ? "ph-over" : "ph-under"}>
                        <span aria-hidden="true">{r.unit > 0 ? "▲" : "▼"}</span> {money(Math.abs(r.unit))}
                        {r.pct !== null && <span className="ph-sku"> {(Math.abs(r.pct) * 100).toFixed(1)}%</span>}
                        <span className="sr-only">{r.unit > 0 ? " above order" : " below order"}</span>
                      </span>
                    )}
                  </td>
                  <td className="r">{Math.abs(r.total) < 0.005 ? "—" : <strong>{r.total > 0 ? "+" : "−"}{money(Math.abs(r.total))}</strong>}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={10} className="page-sub" style={{ textAlign: "center", padding: 24 }}>
                  {rows.length === 0 ? "No supplier bill in these filters came from a purchase order." : "Every billed line matches its order price."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="ph-foot">
          <span className="page-sub">{shown.length.toLocaleString("en-US")} line{shown.length === 1 ? "" : "s"} · unit price before discounts, per the invoice&rsquo;s unit, in MMK at each document&rsquo;s own rate</span>
        </div>
      </section>
    </>
  );
}

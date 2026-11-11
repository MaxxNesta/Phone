import { NextRequest } from "next/server";
import { requirePermission, can } from "@/lib/auth";
import { getPriceHistory, getOrderInvoiceVariance, type PriceSide } from "@/lib/queries";
import { csvResponse } from "@/lib/csv";

/** The price history as filtered on screen, every row rather than one page. */
export async function GET(req: NextRequest) {
  const user = await requirePermission("reports.view");
  const p = req.nextUrl.searchParams;
  const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  const from = p.get("from") ?? "", to = p.get("to") ?? "";
  if (!isDate(from) || !isDate(to)) return new Response("Dates must be YYYY-MM-DD", { status: 400 });
  const asked = p.get("side");
  const filters = {
    q: p.get("q") || undefined, partnerId: p.get("partner") || undefined,
    currency: p.get("currency") || undefined, locationId: p.get("location") || undefined, from, to,
  };
  if (asked === "variance" && can(user, "cost.view")) {
    const v = await getOrderInvoiceVariance(user.companyId, filters);
    return csvResponse([
      ["Date", "Invoice", "Order", "Order date", "Supplier", "Product", "SKU", "Qty", "Unit", "Currency",
       "Order price (MMK)", "Invoice price (MMK)", "Difference per unit", "Difference %", "Difference total (MMK)"],
      ...v.map((r) => {
        const unit = r.invoice_price - r.order_price;
        return [r.date, r.doc_no, r.order_no, r.order_date, r.partner, r.item, r.code, r.qty, r.uom, r.currency,
          r.order_price.toFixed(2), r.invoice_price.toFixed(2), unit.toFixed(2),
          r.order_price > 0 ? ((unit / r.order_price) * 100).toFixed(2) : "", (unit * r.qty).toFixed(2)];
      }),
    ], `order-vs-invoice-${from}-to-${to}`);
  }
  // Purchase prices are cost: the same rule as the page.
  const side: PriceSide = asked === "sale" || !can(user, "cost.view") ? "sale" : asked === "receipt" ? "receipt" : "purchase";
  const rows = await getPriceHistory(user.companyId, side, {
    q: p.get("q") || undefined, partnerId: p.get("partner") || undefined,
    currency: p.get("currency") || undefined, locationId: p.get("location") || undefined, from, to,
  });
  return csvResponse([
    ["Date", "Document", "Product", "SKU", side === "sale" ? "Customer" : "Supplier", "Qty", "Unit",
     "Currency", "Unit price", "FX rate to MMK", "Unit price (MMK)"],
    ...rows.map((r) => [r.date, r.doc_no, r.item, r.code, r.partner, r.qty, r.uom,
      r.currency, r.unit_fc.toFixed(2), r.rate, r.unit_base.toFixed(2)]),
  ], `price-history-${side}-${from}-to-${to}`);
}

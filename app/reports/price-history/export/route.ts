import { NextRequest } from "next/server";
import { requirePermission, can } from "@/lib/auth";
import { getPriceHistory, type PriceSide } from "@/lib/queries";
import { csvResponse } from "@/lib/csv";

/** The price history as filtered on screen, every row rather than one page. */
export async function GET(req: NextRequest) {
  const user = await requirePermission("reports.view");
  const p = req.nextUrl.searchParams;
  const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  const from = p.get("from") ?? "", to = p.get("to") ?? "";
  if (!isDate(from) || !isDate(to)) return new Response("Dates must be YYYY-MM-DD", { status: 400 });
  const asked = p.get("side");
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

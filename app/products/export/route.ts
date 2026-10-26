import { requirePermission, can } from "@/lib/auth";
import { productList, EXPORT_COLUMNS } from "@/lib/products";

const TRACK: Record<string, string> = { IMEI: "IMEI", SERIAL: "Serial", OPTIONAL: "Optional serial", NONE: "Quantity" };
const STATUS: Record<string, string> = { HEALTHY: "In stock", LOW: "Low stock", OUT: "Out of stock" };

/** All products as CSV: the page's filters, the columns chosen in Export, SKU first. */
export async function GET(req: Request) {
  const user = await requirePermission("items.manage");
  const sp = Object.fromEntries(new URL(req.url).searchParams) as Record<string, string>;
  const { list, levels } = await productList(user.companyId, sp);
  const seeCost = can(user, "cost.view");

  const all = [...EXPORT_COLUMNS.filter((c) => seeCost || c.key !== "last_price"), ...levels.map((l) => ({ key: `level:${l.id}`, label: l.name }))];
  const asked = new Set((sp.cols ?? "").split(",").filter(Boolean));
  // In the order Export listed them: SKU first, the price levels after Selling price.
  const cols = asked.size
    ? [...asked].map((k) => all.find((c) => c.key === k)).filter((c): c is (typeof all)[number] => !!c)
    : all;

  const value = (r: any, k: string): unknown => {
    if (k.startsWith("level:")) return r.levels[k.slice(6)] ?? "";
    switch (k) {
      case "code": return r.code;
      case "product": return r.model;
      case "variant": return r.variant ?? "";
      case "brand": return r.brand ?? "";
      case "category": return r.category ?? "";
      case "tracking": return TRACK[r.identity] ?? r.identity ?? "";
      case "price": return r.price ?? "";
      case "available": return r.available;
      case "on_hand": return r.qty;
      case "status": return STATUS[r.status] ?? r.status;
      case "last_price": return seeCost ? (r.last_price ?? "") : "";
      case "last_purchase": return r.last_bought ? new Date(r.last_bought).toISOString().slice(0, 10) : "";
    }
    return "";
  };
  const quote = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [cols.map((c) => quote(c.label)).join(","), ...list.map((r) => cols.map((c) => quote(value(r, c.key))).join(","))];
  return new Response("﻿" + lines.join("\n") + "\n", {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="products.csv"` },
  });
}

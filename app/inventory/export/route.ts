import { seenLocations, seenRows } from "@/lib/branch-scope";
import { sql } from "@/lib/db";
import { requirePermission, can } from "@/lib/auth";
import { inventorySummary, catalogFacets } from "@/lib/phone";
import { catalogSelection } from "@/components/catalog-filters";

/**
 * Stock by product as a CSV, for the branch, warehouse and filters on the
 * summary page — every matching row, not just the page on screen. Cost and
 * value only for someone who may see them.
 */
export async function GET(req: Request) {
  const user = await requirePermission("inventory.view");
  const co = user.companyId;
  const seeCost = can(user, "cost.view");
  const sp = Object.fromEntries(new URL(req.url).searchParams) as Record<string, string | undefined>;

  const seen = await seenLocations();
  const allLocs = (await seenRows((await sql`
    select w.id, b.id as branch_id from location w left join location b on b.id = w.parent_id
     where w.company_id = ${co} and w.is_stock_location and w.is_active`) as unknown as Record<string, unknown>[], "id")) as any[];
  const whOpts = sp.branch ? allLocs.filter((l) => l.branch_id === sp.branch) : allLocs;
  const warehouse = whOpts.some((l) => l.id === sp.wh) ? sp.wh : undefined;
  const facets = await catalogFacets(co, sp.category || undefined, sp.brand || undefined);
  const { rows } = await inventorySummary(co, {
    locationId: warehouse, locs: warehouse ? seen : sp.branch ? whOpts.map((l) => l.id as string) : seen,
    q: sp.q || undefined, groupId: sp.category || undefined, ...catalogSelection(sp, facets),
    status: sp.status || undefined,
  });
  const shown = sp.all === "1" || sp.status === "OUT" ? rows : rows.filter((r: any) => Number(r.qty) > 0 || Number(r.reserved) > 0);

  const quote = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["Product", "Variant", "Category", "Brand", "On hand", "Reserved", "Available",
    ...(seeCost ? ["Avg FIFO cost (MMK)", "Stock value (MMK)"] : []), "Status"];
  const lines = shown.map((r: any) => [r.model, r.variant ?? "", r.category, r.brand ?? "", r.qty, r.reserved, r.available,
    ...(seeCost ? [r.avg_cost != null ? Math.round(Number(r.avg_cost)) : "", Math.round(Number(r.value))] : []),
    r.status === "HEALTHY" ? "In stock" : r.status === "LOW" ? "Low stock" : "Out of stock"].map(quote).join(","));
  // A BOM, so Excel opens Burmese names as UTF-8.
  const body = "﻿" + [head.join(","), ...lines].join("\n") + "\n";
  const day = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="stock-by-product-${day}.csv"`,
    },
  });
}

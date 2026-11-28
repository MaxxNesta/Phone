import { getSalesBreakdown } from "./queries";

/**
 * Where the money came from, for the Executive dashboard's Markets tab
 * (2026-11-28): net sales, gross profit, units and invoices by the
 * customer's region and township. One breakdown by township — the sales
 * report's own, so the figures agree with it — and the regions summed from
 * it, rather than a second pass for the regions.
 */
export type MarketFig = { sales: number; gp: number; units: number; invoices: number };
export type Markets = {
  regions: Record<string, MarketFig>;
  /** Per region: township (or "city:<name>" for a city of several townships) → net sales. */
  towns: Record<string, Record<string, number>>;
  /** Per region: net sales from customers with no township. */
  noTownship: Record<string, number>;
};

const CITIES = new Set(["Mandalay", "Yangon", "Nay Pyi Taw"]);

export async function getMarkets(companyId: string, from: string, to: string): Promise<Markets> {
  const rows = await getSalesBreakdown(companyId, from, to, "township");
  const regions: Markets["regions"] = {}, towns: Markets["towns"] = {}, noTownship: Markets["noTownship"] = {};
  for (const r of rows) {
    const region = r.code || "No region";
    const sales = r.revenue - r.returned;
    const f = (regions[region] ??= { sales: 0, gp: 0, units: 0, invoices: 0 });
    f.sales += sales; f.gp += r.margin; f.units += r.qty; f.invoices += r.invoices;
    const t = (r.name ?? "").trim();
    if (!t) { noTownship[region] = (noTownship[region] ?? 0) + sales; continue; }
    // A city alone (no township chosen) is drawn as its dot; no township shares a city's name.
    const key = CITIES.has(t) ? `city:${t}` : t;
    const mine = (towns[region] ??= {});
    mine[key] = (mine[key] ?? 0) + sales;
  }
  return { regions, towns, noTownship };
}

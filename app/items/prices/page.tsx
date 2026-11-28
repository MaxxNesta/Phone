import { todayLocal } from "@/lib/format";
import { getCompany, getPriceList } from "@/lib/queries";
import { sql } from "@/lib/db";
import { setItemPrice, clearItemPrice, changePrices, createPriceLevel, updatePriceLevel, deletePriceLevel } from "@/lib/actions";
import { AddPriceLevelForm, PriceLevelRow } from "@/components/price-level-form";
import { PriceList, type PriceProduct } from "@/components/price-list";
import { getTranslations } from "next-intl/server";

/**
 * The price list (2026-11-24 layout, after the Astryx preview): products down,
 * each with its units (PCS, PACK, BOX) beneath it, a column per price level.
 * A price opens a side panel to set it from a date, with its dated history;
 * the levels themselves are managed in a dialog, out of the prices' way.
 */
export default async function Prices({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const company = await getCompany();
  const c = await getTranslations("common");
  const t = await getTranslations("prices");
  if (!company) return <div className="empty">{c("noCompany")}</div>;

  const [list, levelUse] = await Promise.all([
    getPriceList(company.id) as unknown as Promise<Array<{
      item_id: string; code: string; name: string; parent_item_id: string | null; model_name: string | null;
      uom_id: string; uom_code: string; factor: number; is_base: boolean; base_code: string;
      level_id: string; price: string | null; valid_from: string | null;
      history: { price: number | null; from: string; note: string | null }[] | null;
    }>>,
    // Counted once each, grouped, rather than a count per level.
    sql`select pl.id, pl.code, pl.name, pl.sort_order, coalesce(p.n, 0)::int as prices, coalesce(b.n, 0)::int as partners
          from price_level pl
          left join (select price_level_id, count(*) as n from item_price where company_id = ${company.id} group by 1) p on p.price_level_id = pl.id
          left join (select price_level_id, count(*) as n from business_partner where company_id = ${company.id} group by 1) b on b.price_level_id = pl.id
         where pl.company_id = ${company.id}
         order by pl.sort_order, pl.code` as unknown as Promise<Array<{
      id: string; code: string; name: string; sort_order: number; prices: number; partners: number;
    }>>,
  ]);

  // Rows come one per product, unit and level; the list wants a product with its units, each with a cell per level.
  const products = new Map<string, PriceProduct>();
  for (const r of list) {
    const p = products.get(r.item_id) ?? { itemId: r.item_id, code: r.code, name: r.name, modelId: r.parent_item_id, modelName: r.model_name, units: [] };
    products.set(r.item_id, p);
    let u = p.units.find((x) => x.uomId === r.uom_id);
    if (!u) {
      u = { uomId: r.uom_id, code: r.uom_code, isBase: r.is_base,
            per: r.is_base ? null : `1 ${r.uom_code.toLowerCase()} = ${Number(r.factor).toLocaleString("en-US", { maximumFractionDigits: 4 })} ${r.base_code.toLowerCase()}`,
            cells: {} };
      p.units.push(u);
    }
    u.cells[r.level_id] = { price: r.price == null ? null : Number(r.price), validFrom: r.valid_from, history: r.history ?? [] };
  }

  return (
    <PriceList
      products={[...products.values()]}
      levels={levelUse.map((l, i) => ({ id: l.id, name: l.name, isDefault: i === 0 }))}
      today={todayLocal()}
      openLevels={sp.levels === "1"}
      initialQ={sp.q ?? ""}
      setAction={setItemPrice}
      clearAction={clearItemPrice}
      changeAction={changePrices}
      manage={
        <>
          <AddPriceLevelForm action={createPriceLevel} />
          {levelUse.length === 0 ? (
            <div className="empty">{t("noLevels")}</div>
          ) : (
            <div className="tablewrap">
              <table className="pl3-levels">
                <thead>
                  <tr><th>{c("code")}</th><th>{c("name")}</th><th className="r">{c("order")}</th><th className="r">{t("pricesCol")}</th><th className="r">Actions</th></tr>
                </thead>
                <tbody>
                  {levelUse.map((l, i) => (
                    <PriceLevelRow key={l.id} level={l} first={i === 0} updateAction={updatePriceLevel} deleteAction={deletePriceLevel} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      }
    />
  );
}

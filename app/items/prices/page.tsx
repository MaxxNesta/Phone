import { getCompany, getPriceList } from "@/lib/queries";
import { sql } from "@/lib/db";
import { setItemPrice, createPriceLevel, updatePriceLevel, deletePriceLevel } from "@/lib/actions";
import { AddPriceLevelForm, PriceLevelRow } from "@/components/price-level-form";
import { PriceRow } from "@/components/price-row";
import { HelpHint } from "@/components/help-hint";
import { paginate } from "@/lib/paging";
import { Pager } from "@/components/pager";
import { getTranslations } from "next-intl/server";

export default async function Prices({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const company = await getCompany();
  const t = await getTranslations("prices");
  const c = await getTranslations("common");
  const it = await getTranslations("items");
  if (!company) return <div className="empty">{c("noCompany")}</div>;

  const [list, packs] = await Promise.all([
    getPriceList(company.id) as unknown as Promise<Array<{
      item_id: string; code: string; name: string; base_uom_id: string; uom_code: string;
      level_id: string; level_name: string; sort_order: number;
      price: string | null; valid_from: string | null; prices: number;
    }>>,
    sql`select iu.item_id, iu.uom_id, iu.factor, u.code
          from item_uom iu
          join uom u on u.id = iu.uom_id
          join item i on i.id = iu.item_id
         where i.company_id = ${company.id}` as unknown as Promise<Array<{
      item_id: string; uom_id: string; factor: string; code: string;
    }>>,
  ]);

  // The query returns one row per item per level; the table wants one row per
  // item with a column per level.
  const levels = [...new Map(list.map((r) => [r.level_id, r])).values()]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((r) => ({ id: r.level_id, name: r.level_name }));

  const items = [...new Map(list.map((r) => [r.item_id, r])).values()].map((r) => ({
    itemId: r.item_id,
    code: r.code,
    name: r.name,
    baseUomId: r.base_uom_id,
    uomCode: r.uom_code,
    packs: packs
      .filter((p) => p.item_id === r.item_id)
      .map((p) => ({ uomId: p.uom_id, code: p.code, factor: Number(p.factor) })),
    levels: levels.map((l) => {
      const cell = list.find((x) => x.item_id === r.item_id && x.level_id === l.id);
      return {
        levelId: l.id,
        levelName: l.name,
        price: cell?.price ?? null,
        validFrom: cell?.valid_from ?? null,
        prices: Number(cell?.prices ?? 0),
      };
    }),
  }));

  // What each level is carrying, so a row can warn before it is renamed and
  // explain itself when a delete is refused.
  const levelUse = (await sql`
    select pl.id, pl.code, pl.name, pl.sort_order,
           (select count(*)::int from item_price ip where ip.price_level_id = pl.id) as prices,
           (select count(*)::int from business_partner bp where bp.price_level_id = pl.id) as partners
      from price_level pl
     where pl.company_id = ${company.id}
     order by pl.sort_order, pl.code`) as unknown as Array<{
      id: string; code: string; name: string; sort_order: number;
      prices: number; partners: number;
    }>;

  const today = new Date().toISOString().slice(0, 10);
  const priced = items.filter((i) => i.levels.some((l) => l.price !== null)).length;

  const pg = paginate(items, sp.page);
  return (
    <>
      <div className="page-head">
        <span className="eyebrow">{it("masterData")}</span>
        <h1>{t("title")}</h1>
        <HelpHint>{t("help")}</HelpHint>
      </div>

      <AddPriceLevelForm action={createPriceLevel} />

      <section>
        <div className="card">
          <div className="card-head">
            <h2>{t("levels")}</h2>
            <span className="page-sub">{t("levelsSub", { n: levelUse.length })}</span>
          </div>
          {levelUse.length === 0 ? (
            <div className="empty">
              {t("noLevels")}
            </div>
          ) : (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>{c("code")}</th>
                    <th>{c("name")}</th>
                    <th className="r">{c("order")}</th>
                    <th className="r">{t("pricesCol")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {levelUse.map((l, i) => (
                    <PriceLevelRow
                      key={l.id}
                      level={l}
                      first={i === 0}
                      updateAction={updatePriceLevel}
                      deleteAction={deletePriceLevel}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="card">
          <div className="card-head">
            <h2>{t("prices")}</h2>
            <span className="page-sub">{t("priced", { priced, total: items.length })}</span>
          </div>

          {items.length === 0 ? (
            <div className="empty">{t("noItems")}</div>
          ) : (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>{c("code")}</th>
                    <th>{t("item")}</th>
                    {levels.map((l) => (
                      <th key={l.id} className="r">{l.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pg.rows.map((row) => (
                    <PriceRow key={row.itemId} row={row} today={today} action={setItemPrice} />
                  ))}
                </tbody>
              </table>
              <Pager p={pg} params={sp} />
            </div>
          )}
        </div>
      </section>
    </>
  );
}

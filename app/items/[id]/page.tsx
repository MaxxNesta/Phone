import { seenLocations } from "@/lib/branch-scope";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { getCompany, getStockMovements } from "@/lib/queries";
import { PackLadder } from "@/components/pack-sizes";
import { VariantTags, asVariant } from "@/components/variant-tags";
import { ItemThumb } from "@/components/item-thumb";
import { HelpHint } from "@/components/help-hint";
import { requireUser, can } from "@/lib/auth";
import { getTranslations } from "next-intl/server";

const money = (v: unknown) =>
  Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const qty = (v: unknown) =>
  Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 4 });

/**
 * One item, everything true about it.
 *
 * The catalogue could only ever show an item as a row among others, and
 * the only way to see one on its own was to open its editor — which is a
 * form for changing things, not a page for reading them. A voucher line
 * naming an item had nowhere to point.
 *
 * Read-only on purpose. Editing stays in the catalogue panel, so there is
 * one place where an item is changed rather than two that can disagree.
 */
export default async function ItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // What the stock cost is for those who may see cost; for everyone else
  // the column is not there at all.
  const seeCost = can(await requireUser(), "cost.view");
  const company = await getCompany();
  const t = await getTranslations("itemDetail");
  const c = await getTranslations("common");
  const pk = await getTranslations("packSizes");
  const f = await getTranslations("itemForm");
  const it = await getTranslations("items");
  if (!company) return <div className="empty">{c("noCompany")}</div>;

  const [item] = (await sql`
    select i.id, i.code, i.name, i.name_my, i.barcode, i.is_stocked, i.is_active,
           i.valuation_method, i.tracks_batch, i.tracks_expiry,
           i.tracks_serial, i.identity, i.warranty_months, i.supplier_warranty_months,
           exists (select 1 from stock_movement m where m.item_id = i.id) as has_moved,
           (select count(*)::int from item c where c.parent_item_id = i.id) as variant_count,
           (select count(*)::int from item c where c.parent_item_id = i.id and c.tracks_serial) as variants_tracked,
           (select count(*)::int from item c where c.parent_item_id = i.id
              and exists (select 1 from stock_movement m where m.item_id = c.id)) as variants_moved,
           i.parent_item_id,
           to_char(i.photo_updated_at, 'YYYYMMDDHH24MISSMS') as photo_version,
           u.code as uom_code,
           b.name as brand_name,
           g.name as group_name, g.id as group_id,
           pg.name as parent_group_name,
           p.code as parent_code, p.name as parent_name,
           (select json_agg(json_build_object('a', va.name, 'o', vo.name)
                      order by iva.sort_order)
              from item_variant_option ivo
              join variant_option vo on vo.id = ivo.option_id
              join variant_attribute va on va.id = vo.attribute_id
              left join item_variant_attribute iva
                     on iva.item_id = coalesce(i.parent_item_id, i.id)
                    and iva.attribute_id = va.id
             where ivo.item_id = i.id) as variant
      from item i
      join uom u on u.id = i.base_uom_id
      join item_group g on g.id = i.item_group_id
      left join item_group pg on pg.id = g.parent_id
      left join brand b on b.id = i.brand_id
      left join item p on p.id = i.parent_item_id
     where i.id = ${id} and i.company_id = ${company.id}`) as any[];

  if (!item) notFound();

  const partNos = await sql`select kind, part_no, maker from item_part_number where item_id = ${id} order by kind, part_no`;
  /* A model (a product with variants) is never sold itself: its variants are
     (fn_document_line_not_parent). So it shows no prices of its own, and its
     stock is its variants' stock, added up per warehouse. */
  const isModel = item.variant_count > 0;
  const [packs, prices, stock, movements, variants] = await Promise.all([
    sql`select u.code, u.name_my as my, iu.factor, iu.sale_price,
               (select bu.name_my from item bi join uom bu on bu.id = bi.base_uom_id where bi.id = ${id}) as base_my
          from v_item_pack iu
          join uom u on u.id = iu.uom_id
         where iu.item_id = ${id} order by iu.factor` as unknown as Promise<
      Array<{ code: string; my: string | null; factor: string; sale_price: string | null; base_my: string | null }>>,
    // The price standing today at each level — a future-dated price is
    // real but not yet the answer, so it is not shown as one.
    isModel ? Promise.resolve([]) : sql`select pl.name as level, pl.sort_order, ip.price, u.code as uom_code,
               to_char(ip.valid_from, 'YYYY-MM-DD') as valid_from
          from price_level pl
          left join lateral (
            select ip.price, ip.uom_id, ip.valid_from from item_price ip
             where ip.item_id = ${id} and ip.price_level_id = pl.id
               and ip.uom_id = (select base_uom_id from item where id = ${id})
               and ip.valid_from <= fn_shop_today()
             order by ip.valid_from desc limit 1) ip on true
          left join uom u on u.id = ip.uom_id
         where pl.company_id = ${company.id}
         order by pl.sort_order, pl.code` as unknown as Promise<
      Array<{ level: string; price: string | null; uom_code: string | null; valid_from: string | null }>>,
    // Quarantine bins (0218) are stock but not for sale: marked, and said in the total.
    sql`select l.code, l.name, l.is_quarantine, sum(s.qty_on_hand) as qty_on_hand
          from v_stock_on_hand s join location l on l.id = s.location_id
         where s.item_id in (select ${id}::uuid union all select id from item where parent_item_id = ${id})
         group by l.code, l.name, l.is_quarantine
        having sum(s.qty_on_hand) <> 0
         order by l.code` as unknown as Promise<
      Array<{ code: string; name: string; is_quarantine: boolean; qty_on_hand: string }>>,
    seenLocations().then((locs) => getStockMovements(company.id, id, null, null, locs)) as unknown as Promise<any[]>,
    // Each variant with what it holds, the quarantine part apart: one read of the stock view for them all.
    isModel ? sql`
      with q as (
        select s.item_id, sum(s.qty_on_hand)::float as qty,
               coalesce(sum(s.qty_on_hand) filter (where l.is_quarantine), 0)::float as quarantine
          from v_stock_on_hand s join location l on l.id = s.location_id
         where s.item_id in (select id from item where parent_item_id = ${id})
         group by s.item_id)
      select i.id, i.code, i.name, coalesce(q.qty, 0) as qty, coalesce(q.quarantine, 0) as quarantine
        from item i left join q on q.item_id = i.id
       where i.parent_item_id = ${id} order by i.code` as unknown as Promise<
      Array<{ id: string; code: string; name: string; qty: number; quarantine: number }>> : Promise.resolve([]),
  ]);

  const onHand = stock.reduce((s, r) => s + Number(r.qty_on_hand), 0);
  const held = stock.filter((r) => r.is_quarantine).reduce((s, r) => s + Number(r.qty_on_hand), 0);
  // Newest first: the list comes oldest first, for the stock card.
  const recent = movements.slice(-12).reverse();

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">
          <Link href="/products" className="plain">{it("masterData")}</Link> · {t("items")}
        </span>
        <h1>
          {item.code} · {item.name}
          <VariantTags variant={asVariant(item.variant)} className="vartags-inline" />
        </h1>
        <div className="page-sub">
          {item.name_my && <>{item.name_my} · </>}
          {item.parent_group_name ? `${item.parent_group_name} / ` : ""}{item.group_name}
          {item.brand_name && <> · {item.brand_name}</>}
          {!item.is_stocked && <> · <span className="pill">{t("service")}</span></>}
          {!item.is_active && <> · <span className="pill warn">{t("inactive")}</span></>}
        </div>
      </div>

      <div className="actions" style={{ marginBottom: "var(--s3)" }}>
        {/* Editing lives in the catalogue, so this page cannot drift from
            the form that actually writes — but it opens on this item with
            its editor already up, rather than dropping you into a list of
            sixteen to find it again. */}
        {/* A variant is edited on its product's grid, opened on just this
            row; anything else in the catalogue, opened on just itself. */}
        <Link className="btn ghost"
          href={`/items/${item.id}/edit`}>
          {item.parent_item_id ? t("editVariant") : t("editItem")}
        </Link>
        {item.is_stocked && (
          <Link className="btn ghost" href={`/inventory/movements?item=${item.id}`}>
            {t("allMovements")}
          </Link>
        )}
        {item.parent_item_id && (
          <Link className="btn ghost" href={`/items/${item.parent_item_id}`}>
            {t("parentProduct", { code: item.parent_code })}
          </Link>
        )}
      </div>

      <section className={isModel ? undefined : "grid2"}>
        <div className="card">
          <div className="card-head">
            <div className="headwith">
              <h2>{t("howCounted")}</h2>
              <HelpHint label={t("baseAndPacks")}>{t("baseAndPacksHelp")}</HelpHint>
            </div>
          </div>
          <div className="card-body">
            <div className="row">
              <div className="field">
                <label>{f("itemCode")}</label>
                <div className="code">{item.code}</div>
              </div>
              <div className="field">
                <label>{f("baseUnit")}</label>
                <div className="code">{item.uom_code}</div>
              </div>
              <div className="field">
                <label>{t("valuation")}</label>
                <div className="code">{item.valuation_method}</div>
              </div>
              {item.barcode && (
                <div className="field">
                  <label>{c("barcode")}</label>
                  <div className="code">{item.barcode}</div>
                </div>
              )}
            </div>
            <div className="field" style={{ marginTop: "var(--s2)" }}>
              <label>{pk("label")}</label>
              {packs.length === 0 ? (
                <span className="hint">
                  {pk("onlyBase", { unit: item.uom_code })}
                </span>
              ) : (
                <PackLadder base={item.uom_code} baseMy={packs[0]?.base_my} packs={packs.map((p) => ({ code: p.code, my: p.my, factor: Number(p.factor),
                  price: p.sale_price == null ? null : Number(p.sale_price) }))} />
              )}
            </div>
            {isModel && (
              <div className="field" style={{ marginTop: "var(--s2)" }}>
                <label>{t("prices")}</label>
                <span className="hint">{t("pricesOnVariants")}</span>
              </div>
            )}
            {partNos.length > 0 && (
              <div className="field" style={{ marginTop: "var(--s2)" }}>
                <label>Part numbers</label>
                <ul className="plainlist">
                  {partNos.map((p) => (
                    <li key={p.kind + p.part_no}><span className="code">{p.part_no}</span>
                      <span className="subline"> {p.kind === "OEM" ? "OEM" : p.kind === "SUPPLIER" ? "Supplier code" : "Equivalent"}{p.maker ? ` · ${p.maker}` : ""}</span></li>
                  ))}
                </ul>
              </div>
            )}
            {(item.tracks_batch || item.tracks_expiry) && (
              <div className="field" style={{ marginTop: "var(--s2)" }}>
                <label>{c("tracking")}</label>
                <div>
                  {item.tracks_batch && <span className="pill">{t("batches")}</span>}{" "}
                  {item.tracks_expiry && <span className="pill">{t("expiry")}</span>}
                </div>
              </div>
            )}
          </div>
        </div>

        {isModel ? null : <div className="card">
          <div className="card-head">
            <h2>{t("prices")}</h2>
            <span className="page-sub">{t("pricesSub")}</span>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>{t("level")}</th><th className="r">{c("price")}</th><th>{t("per")}</th><th>{t("from")}</th></tr>
              </thead>
              <tbody>
                {prices.map((p) => (
                  <tr key={p.level}>
                    <td>{p.level}</td>
                    <td className="r">
                      {p.price === null
                        ? <span className="page-sub">{t("notPriced")}</span>
                        : <strong>{money(p.price)}</strong>}
                    </td>
                    <td className="code">{p.uom_code ?? "—"}</td>
                    <td className="page-sub">{p.valid_from ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>}
      </section>

      {item.is_stocked && (
        <section>
          <div className="card">
            <div className="card-head">
              <h2>{t("onHand")}</h2>
              <span className="page-sub">
                {t("onHandSub", { qty: qty(onHand), unit: item.uom_code, n: stock.length })}
                {held > 0 && <> · {t("inQuarantine", { qty: qty(held) })}</>}
              </span>
            </div>
            {stock.length === 0 ? (
              <div className="empty">{t("noneInStock")}</div>
            ) : (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr><th>{c("warehouse")}</th><th className="r">{c("quantity")}</th></tr>
                  </thead>
                  <tbody>
                    {stock.map((s) => (
                      <tr key={s.code}>
                        <td><span className="code">{s.code}</span> {s.name}
                          {s.is_quarantine && <> <span className="pill warn">{t("quarantineBin")}</span></>}</td>
                        <td className="r">{qty(s.qty_on_hand)} {item.uom_code}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {variants.length > 0 && (
        <section>
          <div className="card">
            <div className="card-head">
              <h2>{t("variants")}</h2>
              <span className="page-sub">{variants.length}</span>
            </div>
            <div className="tablewrap">
              <table>
                <thead><tr><th>{c("code")}</th><th>{c("name")}</th><th className="r">{t("onHand")}</th></tr></thead>
                <tbody>
                  {variants.map((v) => (
                    <tr key={v.id}>
                      <td className="code">
                        <Link href={`/items/${v.id}`} style={{ color: "var(--link)" }}>
                          {v.code}
                        </Link>
                      </td>
                      <td className="wrap">{v.name}</td>
                      <td className="r">
                        {v.qty ? `${qty(v.qty)} ${item.uom_code}` : <span className="page-sub">—</span>}
                        {v.quarantine > 0 && <div className="subline">{t("inQuarantineShort", { qty: qty(v.quarantine) })}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {item.is_stocked && recent.length > 0 && (
        <section>
          <div className="card">
            <div className="card-head">
              <h2>{t("recentMovements")}</h2>
              <span className="page-sub">{t("newest", { n: recent.length })}</span>
            </div>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>{c("date")}</th>{isModel && <th>{t("variant")}</th>}<th>{c("document")}</th><th>{c("warehouse")}</th>
                    <th className="r">{c("quantity")}</th>{seeCost && <th className="r">{t("unitCost")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {recent.map((m) => (
                    <tr key={m.id}>
                      <td>{String(m.movement_date).slice(0, 10)}</td>
                      {isModel && <td className="wrap"><span className="code">{m.item_code}</span><div className="subline">{m.item_name}</div></td>}
                      <td>
                        <Link href={`/documents/${m.document_id}`}
                              style={{ color: "var(--link)" }}>
                          {m.doc_no}
                        </Link>
                        <div className="subline">{m.doc_type}</div>
                      </td>
                      <td className="code">{m.location_code}</td>
                      <td className="r" style={{ color: Number(m.qty) < 0 ? "var(--bad)" : undefined }}>
                        {qty(m.qty)}
                      </td>
                      {seeCost && <td className="r">{m.unit_cost ? money(m.unit_cost) : "—"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

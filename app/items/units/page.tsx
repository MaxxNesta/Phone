import { getCompany } from "@/lib/queries";
import { sql } from "@/lib/db";
import { createUnit, updateUnit, deactivateUnit, activateUnit, deleteUnit, addStandardUnits } from "@/lib/actions";
import { AddUnitForm } from "@/components/unit-form";
import { UnitRow } from "@/components/unit-row";
import { DataTable, type DataRow } from "@/components/data-table";
import { HelpHint } from "@/components/help-hint";
import { getTranslations } from "next-intl/server";
import { UOM } from "@/lib/uom-labels";
import Link from "next/link";

export default async function Units() {
  // The layout already read the company; this is that same cached read.
  const co = await getCompany();
  const t = await getTranslations("units");
  const c = await getTranslations("common");
  const cat = await getTranslations("categories");
  if (!co) return <div className="empty">{c("noCompany")}</div>;

  const units = (await sql`
    select u.id, u.code, u.name, u.name_my, u.is_active, u.ref_uom_id, u.ref_qty::float as ref_qty, u.whole_numbers,
           r.code as ref_code,
           count(i.id)::int as items
      from uom u
      left join uom r on r.id = u.ref_uom_id
      left join item i on i.base_uom_id = u.id
     where u.company_id = ${co.id}
     group by u.id, r.code
     order by u.name`) as any[];

  const rows: DataRow[] = units.map((u) => ({
    key: u.id,
    searchText: [u.code, u.name, u.name_my].filter(Boolean).join(" "),
    sort: { code: u.code, name: u.name, items: Number(u.items), is_active: u.is_active ? 1 : 0 },
    node: (
      <UnitRow
        unit={u}
        updateAction={updateUnit}
        deactivateAction={deactivateUnit}
        activateAction={activateUnit}
        deleteAction={deleteUnit}
        rulesFrom={units}
      />
    ),
  }));

  const active = units.filter((u) => u.is_active).length;

  /* Spare parts: every product's packs as parent → child steps, biggest
     first, down to the stock unit — 1 CTN holds 10 BOX, 1 BOX holds 12 PCS.
     A unit smaller than the stock unit (FT on hose counted in M) is the
     stock unit's child the same way. One query for the whole catalogue. */
  const conv: DataRow[] = [];
  {
    const packs = (await sql`
      select i.id, i.code, i.name, coalesce(bu.name_my || ' ', '') || bu.code as base,
             coalesce(pu.name_my || ' ', '') || pu.code as unit, iu.factor::float as factor, iu.sale_price::float as price
        from item_uom iu
        join item i on i.id = iu.item_id
        join uom bu on bu.id = i.base_uom_id
        join uom pu on pu.id = iu.uom_id
       where iu.company_id = ${co.id} and i.is_active
       order by i.code, iu.factor desc`) as unknown as
      { id: string; code: string; name: string; base: string; unit: string; factor: number; price: number | null }[];
    const n4 = (n: number) => Number(n.toFixed(4)).toLocaleString("en-US", { maximumFractionDigits: 4 });
    const byItem = new Map<string, typeof packs>();
    for (const p of packs) byItem.set(p.id, [...(byItem.get(p.id) ?? []), p]);
    for (const list of byItem.values()) {
      const it = list[0];
      const chain = [...list.map((p) => ({ unit: p.unit, factor: p.factor, price: p.price })), { unit: it.base, factor: 1, price: null }]
        .sort((a, b) => b.factor - a.factor);
      chain.slice(0, -1).forEach((parent, i) => {
        const child = chain[i + 1];
        const holds = parent.factor / child.factor;
        conv.push({
          key: `${it.id}-${parent.unit}`,
          searchText: [it.code, it.name, parent.unit, child.unit].join(" "),
          sort: { item: `${it.code} ${i}`, parent: parent.unit, holds, child: child.unit, stock: parent.factor },
          csv: { item: `${it.code} ${it.name}`, parent: parent.unit, holds: n4(holds), child: child.unit, stock: `${n4(parent.factor)} ${it.base}`,
                 price: parent.price ?? "" },
          node: (
            <tr>
              <td>{i === 0 ? <Link href={`/items/${it.id}`}><span className="code">{it.code}</span> {it.name}</Link>
                           : <span className="subline">{it.code}</span>}</td>
              <td><strong>1 {parent.unit}</strong>{parent.factor === 1 && <span className="subline"> · {UOM.stockUnit}</span>}</td>
              <td className="r">{n4(holds)}</td>
              <td>{child.unit}{child.factor === 1 && <span className="subline"> · {UOM.stockUnit}</span>}</td>
              <td className="r">{n4(parent.factor)} {it.base}</td>
              <td className="r">{parent.price != null ? n4(parent.price) : ""}</td>
            </tr>
          ),
        });
      });
    }
  }

  return (
    <>
      <div className="page-head hero">
        <span className="eyebrow">{cat("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <HelpHint>{t("help")}</HelpHint>
        <p className="page-sub">{t("sub")}</p>
      </div>

      <AddUnitForm action={createUnit} rulesFrom={units} standardAction={addStandardUnits} />

      <section>
        <div className="card">
          <div className="card-head">
            <h2>{t("title")}</h2>
            <span className="page-sub">
              {units.length} total · {active} active
            </span>
          </div>

          {units.length === 0 ? (
            <div className="empty">
              {t("nothingYet")}
            </div>
          ) : (
            <DataTable
              rows={rows}
              emptyLabel={t("none")}
              searchPlaceholder={t("search")}
              defaultSort={{ key: "name", dir: "asc" }}
              columns={[
                { key: "code", label: c("code"), sortable: true },
                { key: "name", label: c("name"), sortable: true },
                { key: "equals", label: UOM.equals, align: "r" as const }, { key: "whole", label: UOM.whole },
                { key: "items", label: c("items"), sortable: true, align: "r" },
                { key: "is_active", label: c("status"), sortable: true },
                { key: "actions", label: "" },
              ]}
            />
          )}
        </div>
      </section>

      <section>
          <div className="card">
            <div className="card-head">
              <h2>{UOM.conversions}</h2>
              <span className="page-sub">What each pack holds, parent to child, down to the unit stock is counted in</span>
            </div>
            {conv.length === 0 ? (
              <div className="empty">No product has a pack yet. Add one under the product&apos;s Pack sizes.</div>
            ) : (
              <DataTable
                rows={conv}
                emptyLabel="No conversion matches"
                searchPlaceholder="Search product or unit"
                defaultSort={{ key: "item", dir: "asc" }}
                csvFilename="unit-conversions.csv"
                columns={[
                  { key: "item", label: "Product", sortable: true },
                  { key: "parent", label: "ကြီး · Parent", sortable: true },
                  { key: "holds", label: UOM.factor, sortable: true, align: "r" },
                  { key: "child", label: "ငယ် · Child", sortable: true },
                  { key: "stock", label: UOM.base, sortable: true, align: "r" },
                  { key: "price", label: UOM.sellsAt, align: "r" },
                ]}
              />
            )}
          </div>
        </section>
    </>
  );
}

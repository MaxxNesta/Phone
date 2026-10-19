import { getCompany } from "@/lib/queries";
import { sql } from "@/lib/db";
import { createUnit, updateUnit, deactivateUnit, activateUnit, deleteUnit } from "@/lib/actions";
import { AddUnitForm } from "@/components/unit-form";
import { UnitRow } from "@/components/unit-row";
import { DataTable, type DataRow } from "@/components/data-table";
import { HelpHint } from "@/components/help-hint";
import { getTranslations } from "next-intl/server";

export default async function Units() {
  // The layout already read the company; this is that same cached read.
  const co = await getCompany();
  const t = await getTranslations("units");
  const c = await getTranslations("common");
  const cat = await getTranslations("categories");
  if (!co) return <div className="empty">{c("noCompany")}</div>;

  const units = (await sql`
    select u.id, u.code, u.name, u.name_my, u.is_active,
           count(i.id)::int as items
      from uom u
      left join item i on i.base_uom_id = u.id
     where u.company_id = ${co.id}
     group by u.id
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
      />
    ),
  }));

  const active = units.filter((u) => u.is_active).length;

  return (
    <>
      <div className="page-head hero">
        <span className="eyebrow">{cat("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <HelpHint>{t("help")}</HelpHint>
        <p className="page-sub">{t("sub")}</p>
      </div>

      <AddUnitForm action={createUnit} />

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
              Nothing yet. Add the units your items are counted in &mdash; Piece,
              Box, Carton &mdash; before creating items, since every item needs one.
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
                { key: "items", label: c("items"), sortable: true, align: "r" },
                { key: "is_active", label: c("status"), sortable: true },
                { key: "actions", label: "" },
              ]}
            />
          )}
        </div>
      </section>
    </>
  );
}

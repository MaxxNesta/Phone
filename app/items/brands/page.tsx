import { getCompany } from "@/lib/queries";
import { sql } from "@/lib/db";
import { currentUser, can } from "@/lib/auth";
import { createBrand, updateBrand, deactivateBrand, activateBrand, deleteBrand } from "@/lib/actions";
import { AddBrandForm } from "@/components/brand-form";
import { BrandRow } from "@/components/brand-row";
import { DataTable, type DataRow } from "@/components/data-table";
import { HelpHint } from "@/components/help-hint";
import { getTranslations } from "next-intl/server";

export default async function Brands() {
  // The layout already read the company; this is that same cached read.
  const co = await getCompany();
  const t = await getTranslations("brands");
  const c = await getTranslations("common");
  const cat = await getTranslations("categories");
  if (!co) return <div className="empty">{c("noCompany")}</div>;

  const brands = (await sql`
    select b.id, b.code, b.name, b.name_my, b.is_active, count(i.id)::int as items
      from brand b
      left join item i on i.brand_id = b.id
     where b.company_id = ${co.id}
     group by b.id
     order by b.name`) as any[];

  const rows: DataRow[] = brands.map((b) => ({
    key: b.id,
    searchText: [b.code, b.name, b.name_my].filter(Boolean).join(" "),
    sort: { code: b.code, name: b.name, items: Number(b.items), is_active: b.is_active ? 1 : 0 },
    node: (
      <BrandRow
        brand={b}
        updateAction={updateBrand}
        deactivateAction={deactivateBrand}
        activateAction={activateBrand}
        deleteAction={deleteBrand}
      />
    ),
  }));

  return (
    <>
      <div className="page-head hero">
        <span className="eyebrow">{cat("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <HelpHint>{t("help")}</HelpHint>
        <p className="page-sub">{t("sub")}</p>
      </div>

      {/* Owner only: the shop sells Apple, and another brand is asked twice. */}
      {can((await currentUser())!, "brands.manage") && <AddBrandForm action={createBrand} />}

      <section>
        <div className="card">
          <div className="card-head">
            <h2>{t("title")}</h2>
            <span className="page-sub">{brands.length}</span>
          </div>

          {brands.length === 0 ? (
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

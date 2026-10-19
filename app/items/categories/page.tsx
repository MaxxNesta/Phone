import { getCompany } from "@/lib/queries";
import { sql } from "@/lib/db";
import { createCategory, updateCategory, deactivateCategory, activateCategory, deleteCategory } from "@/lib/actions";
import { allCategories, childrenOf, levelCounts, branchIds } from "@/lib/tree";
import { AddCategoryForm } from "@/components/level-form";
import { CategoryRow } from "@/components/category-row";
import { DataTable, type DataRow } from "@/components/data-table";
import { HelpHint } from "@/components/help-hint";
import { getTranslations } from "next-intl/server";

export default async function CategoriesRoot() {
  // The layout already read the company; this is that same cached read.
  const co = await getCompany();
  const t = await getTranslations("categories");
  const c = await getTranslations("common");
  if (!co) return <div className="empty">{c("noCompany")}</div>;

  const nodes = await allCategories(co.id);
  const counts = await levelCounts(co.id);
  const roots = childrenOf(nodes, null).map((g) => ({
    ...g,
    inside: counts.childrenOf(g.id),
    total: branchIds(nodes, g.id).reduce((s, id) => s + counts.itemsIn(id), 0),
  }));

  const rows: DataRow[] = roots.map((g) => ({
    key: g.id,
    searchText: [g.code, g.name, g.name_my].filter(Boolean).join(" "),
    sort: { code: g.code, name: g.name, inside: g.inside, total: g.total, is_active: g.is_active ? 1 : 0 },
    node: (
      <CategoryRow
        category={g}
        returnTo="/items/categories"
        updateAction={updateCategory}
        deactivateAction={deactivateCategory}
        activateAction={activateCategory}
        deleteAction={deleteCategory}
      />
    ),
  }));

  return (
    <>
      <div className="page-head hero">
        <span className="eyebrow">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <HelpHint>{t("help")}</HelpHint>
        <p className="page-sub">{t("sub")}</p>
      </div>

      <AddCategoryForm
        action={createCategory}
        parentId={null}
        returnTo="/items/categories"
        label={t("labelCategory")}
        codeHint="01"
        nameHint="Stationary"
      />

      <section>
        <div className="card">
          <div className="card-head">
            <h2>{t("title")}</h2>
            <span className="page-sub">{roots.length}</span>
          </div>

          {roots.length === 0 ? (
            <div className="empty">
              {t("nothingYet")}
            </div>
          ) : (
            <DataTable
              rows={rows}
              emptyLabel={t("none")}
              searchPlaceholder={t("search")}
              defaultSort={{ key: "code", dir: "asc" }}
              columns={[
                { key: "code", label: c("code"), sortable: true },
                { key: "name", label: c("name"), sortable: true },
                { key: "inside", label: t("inside"), sortable: true, align: "r" },
                { key: "total", label: c("items"), sortable: true, align: "r" },
                { key: "actions", label: "" },
              ]}
            />
          )}
        </div>
      </section>
    </>
  );
}

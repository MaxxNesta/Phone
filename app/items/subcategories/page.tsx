import { getCompany } from "@/lib/queries";
import Link from "next/link";
import { sql } from "@/lib/db";
import { allCategories, subcategories, childrenOf, levelCounts, branchIds } from "@/lib/tree";
import { createCategory, updateCategory, deactivateCategory, activateCategory, deleteCategory } from "@/lib/actions";
import { AddCategoryForm } from "@/components/level-form";
import { CategoryRow } from "@/components/category-row";
import { DataTable, type DataRow } from "@/components/data-table";
import { HelpHint } from "@/components/help-hint";
import { getTranslations } from "next-intl/server";

export default async function Subcategories() {
  // The layout already read the company; this is that same cached read.
  const co = await getCompany();
  const t = await getTranslations("categories");
  const c = await getTranslations("common");
  if (!co) return <div className="empty">{c("noCompany")}</div>;

  const nodes = await allCategories(co.id);
  const roots = childrenOf(nodes, null);
  const counts = await levelCounts(co.id);
  const subs = subcategories(nodes).map((s) => ({
    ...s,
    parentName: nodes.find((n) => n.id === s.parent_id)?.name ?? null,
    // Categories two levels deep can't have children of their own, so this
    // is always 0 here — kept only because CategoryRow's shape needs it,
    // never shown (see showInside below).
    inside: 0,
    total: branchIds(nodes, s.id).reduce((sum, id) => sum + counts.itemsIn(id), 0),
  }));

  const rows: DataRow[] = subs.map((s) => ({
    key: s.id,
    searchText: [s.code, s.name, s.name_my, s.parentName].filter(Boolean).join(" "),
    sort: {
      code: s.code, name: s.name, parentName: s.parentName ?? "",
      total: s.total, is_active: s.is_active ? 1 : 0,
    },
    node: (
      <CategoryRow
        category={s}
        parentName={s.parentName}
        showInside={false}
        returnTo="/items/subcategories"
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
        <h1>{t("subsTitle")}</h1>
        <HelpHint>{t("subsHelp")}</HelpHint>
        <p className="page-sub">{t("subsSub")}</p>
      </div>

      <AddCategoryForm
        action={createCategory}
        categories={roots}
        returnTo="/items/subcategories"
        label={t("labelSub")}
        codeHint="01"
        nameHint="Soft Drinks"
      />

      <section>
        <div className="card">
          <div className="card-head">
            <h2>{t("subsTitle")}</h2>
            <span className="page-sub">{subs.length}</span>
          </div>

          {subs.length === 0 ? (
            <div className="empty">
              {t("subsNone")}{" "}
              <Link href="/items/categories" style={{ color: "var(--link)" }}>{t("goToCategories")}</Link>
            </div>
          ) : (
            <DataTable
              rows={rows}
              emptyLabel={t("subsEmpty")}
              searchPlaceholder={t("subsSearch")}
              defaultSort={{ key: "code", dir: "asc" }}
              columns={[
                { key: "code", label: c("code"), sortable: true },
                { key: "name", label: c("name"), sortable: true },
                { key: "parentName", label: c("category"), sortable: true },
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

import Link from "next/link";
import { sql } from "@/lib/db";
import { currentUser, can } from "@/lib/auth";
import { createItem } from "@/lib/actions";
import { allCategories } from "@/lib/tree";
import { getBrands, getCompany, getVariantAttributes } from "@/lib/queries";
import { ItemForm } from "@/components/item-form";
import { HelpHint } from "@/components/help-hint";
import { getTranslations } from "next-intl/server";

export default async function NewItem() {
  // The layout already read the company; this is that same cached read.
  const co = await getCompany();
  const t = await getTranslations("items");
  if (!co) return <div className="empty">No company found.</div>;

  const [nodes, uoms, brands, variantAttributes] = await Promise.all([
    allCategories(co.id),
    sql`select id, code, name from uom where company_id = ${co.id} and is_active order by code`,
    getBrands(co.id),
    getVariantAttributes(co.id),
  ]);

  if (nodes.length === 0) {
    return (
      <>
        <div className="page-head">
          <span className="eyebrow">{t("masterData")}</span>
          <h1>{t("newItem")}</h1>
        </div>
        <div className="alert">
          {t("noCategories")}{" "}
          <Link href="/items/categories" style={{ textDecoration: "underline" }}>
            {t("addCategoryFirst")}
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">{t("masterData")}</span>
        <h1>{t("newItem")}</h1>
        <HelpHint>{t("newItemHelp")}</HelpHint>
      </div>

      <ItemForm
        variantAttributes={variantAttributes as never}
        action={createItem}
        nodes={nodes}
        uoms={uoms as never}
        brands={brands as never}
        returnTo="/items"
        retail={Boolean((await getCompany())?.retail_mode)}
        canAddBrand={can((await currentUser())!, "brands.manage")}
        canKeepDuplicates={can((await currentUser())!, "items.duplicates")}
      />
    </>
  );
}

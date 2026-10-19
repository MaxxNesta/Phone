import { getCompany } from "@/lib/queries";
import { sql } from "@/lib/db";
import {
  createVariantAttribute, updateVariantAttribute, deleteVariantAttribute,
  createVariantOption, updateVariantOption, deleteVariantOption, moveVariantOption,
} from "@/lib/actions";
import { AttributeCard, type Attribute } from "@/components/attribute-card";
import { AddAttributeForm } from "@/components/attribute-form";
import { HelpHint } from "@/components/help-hint";
import { getTranslations } from "next-intl/server";

/**
 * The ways products vary.
 *
 * Kept as master data rather than typed onto each product, for the reason
 * every other list here is: Red has to be one colour and not four spellings
 * of one, or "which colours sold" has no answer.
 *
 * Most of a trading catalogue never touches this page. A tin of condensed
 * milk has no size, and nothing makes it acquire one — an item with no
 * variants is an ordinary item and always was.
 */
export default async function VariantAttributes() {
  // The layout already read the company; this is that same cached read.
  const co = await getCompany();
  const t = await getTranslations("attributes");
  const c = await getTranslations("common");
  const cat = await getTranslations("categories");
  if (!co) return <div className="empty">{c("noCompany")}</div>;

  const attributes = (await sql`
    select a.id, a.code, a.name, a.name_my, a.is_active,
           (select count(*)::int from item_variant_attribute iva
             where iva.attribute_id = a.id) as products
      from variant_attribute a
     where a.company_id = ${co.id}
     order by a.sort_order, a.name`) as any[];

  const options = (await sql`
    select o.id, o.attribute_id, o.code, o.name, o.name_my, o.sort_order,
           (select count(*)::int from item_variant_option ivo
             where ivo.option_id = o.id) as used
      from variant_option o
     where o.company_id = ${co.id}
     order by o.sort_order, o.name`) as any[];

  const withOptions: Attribute[] = attributes.map((a) => ({
    ...a,
    options: options.filter((o) => o.attribute_id === a.id),
  }));

  return (
    <>
      <div className="page-head hero">
        <span className="eyebrow">{cat("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <HelpHint>{t("help")}</HelpHint>
        <p className="page-sub">{t("sub")}</p>
      </div>

      <AddAttributeForm action={createVariantAttribute} />

      {withOptions.length === 0 ? (
        <div className="empty">
          {t("nothingYet")}
        </div>
      ) : (
        <div className="attrgrid">
          {withOptions.map((a) => (
            <AttributeCard
              key={a.id}
              attribute={a}
              addOption={createVariantOption}
              updateOption={updateVariantOption}
              removeOption={deleteVariantOption}
              moveOption={moveVariantOption}
              update={updateVariantAttribute}
              remove={deleteVariantAttribute}
            />
          ))}
        </div>
      )}
    </>
  );
}

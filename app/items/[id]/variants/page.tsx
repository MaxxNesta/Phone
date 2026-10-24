import Link from "next/link";
import { sql } from "@/lib/db";
import { getCompany, getVariantGrid, getVariantStock } from "@/lib/queries";
import { saveVariantGrid } from "@/lib/actions";
import { VariantGrid, type GridRow } from "@/components/variant-grid";
import { variantPhotos } from "@/lib/variants";
import { HelpHint } from "@/components/help-hint";
import { getTranslations } from "next-intl/server";

/**
 * One product's variants, all editable at once.
 *
 * Reached from the catalogue, because that is where somebody is when they
 * realise the twelve sizes they just created have no barcodes on them.
 */
export default async function VariantsOfProduct({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  /** One variant's row only, when its own Edit opened this page. */
  searchParams: Promise<{ only?: string }>;
}) {
  const { id } = await params;
  const { only } = await searchParams;
  const company = await getCompany();
  const g = await getTranslations("variantGrid");
  const c = await getTranslations("common");
  const it = await getTranslations("items");
  if (!company) return <div className="empty">{c("noCompany")}</div>;

  const [parent] = await sql`
    select id, code, name, base_uom_id from item
     where id = ${id} and company_id = ${company.id}`;
  if (!parent) return <div className="empty">{g("noProduct")}</div>;

  const [uom] = await sql`select code from uom where id = ${parent.base_uom_id}`;

  const { levels, rows } = (await getVariantGrid(company.id, id)) as unknown as
    { levels: { id: string; name: string }[]; rows: any[] };

  if (rows.length === 0) {
    return (
      <>
        <div className="page-head">
          <span className="eyebrow">{it("masterData")}</span>
          <h1>{parent.name}</h1>
        </div>
        <div className="empty">
          {g("noVariants", { code: parent.code })}{" "}
          <Link href="/items" style={{ color: "var(--link)" }}>{g("backToItems")}</Link>
        </div>
      </>
    );
  }

  // The garment for each row, resolved by colour the same way every other
  // screen does it, so a size with no photograph of its own still shows one.
  const variantStock = (await getVariantStock(company.id)) as unknown as
    Parameters<typeof variantPhotos>[0];
  const photos = variantPhotos(variantStock);
  const srcOf = (itemId: string) => {
    const v = variantStock.find((x) => x.id === itemId);
    return v ? photos.srcFor(v) : null;
  };

  const shown = only && rows.some((r) => r.id === only) ? rows.filter((r) => r.id === only) : rows;
  const gridRows: GridRow[] = shown.map((r) => ({
    id: r.id, code: r.code, name: r.name, nameIsCustom: !!r.name_is_custom, twins: r.twins ?? null,
    barcode: r.barcode, prices: r.prices,
    is_active: r.is_active, on_hand: r.on_hand,
    photoSrc: srcOf(r.id),
    parts: r.parts,
  }));

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">
          <Link href="/items" style={{ color: "inherit" }}>{it("title")}</Link> · {parent.code}
        </span>
        <h1>{g("titleVariants", { name: parent.name })}</h1>
        <HelpHint>{g("help")}</HelpHint>
      </div>

      <section>
        <div className="card">
          <div className="card-head">
            <h2>{shown.length === rows.length ? g("count", { n: rows.length }) : shown[0].name}</h2>
            {shown.length !== rows.length && (
              <Link href={`/items/${parent.id}/variants`} className="linkish">{g("showAll", { n: rows.length })}</Link>
            )}
            <span className="page-sub">
              {g("scanHint")}
            </span>
          </div>
          <div className="card-body">
            <VariantGrid
              action={saveVariantGrid}
              parentId={parent.id}
              rows={gridRows}
              levels={levels}
              uom={uom?.code ?? ""}
              productName={parent.name}
            />
          </div>
        </div>
      </section>
    </>
  );
}

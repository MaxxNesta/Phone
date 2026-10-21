import { getCompany } from "@/lib/queries";
import Link from "next/link";
import { getFormData, createStockAdjustment } from "@/lib/actions";
import { allCategories } from "@/lib/tree";
import { sql } from "@/lib/db";
import { AdjustmentForm } from "@/components/adjustment-form";
import { ErpCrumbs } from "@/components/erp-worklist";
import { HelpHint } from "@/components/help-hint";
import { getTranslations } from "next-intl/server";

export default async function NewStockAdjustment() {
  const t = await getTranslations("inventory");
  const c = await getTranslations("common");
  const n = await getTranslations("nav");
  const d = await getFormData();
  // The layout already read the company; this is that same cached read.
  const co = await getCompany();
  if (!co) return <div className="empty">{c("noCompany")}</div>;
  const categories = await allCategories(co.id);
  const today = new Date().toISOString().slice(0, 10);

  if (categories.length === 0 || d.locations.length === 0) {
    return (
      <>
        <ErpCrumbs steps={[
          { label: n("inventory") },
          { label: t("adj.title") },
        ]} />
        <div className="page-head">
          <h1>{t("adj.title")}</h1>
        </div>
        <div className="alert">
          {categories.length === 0 && <div>{t("noCategoriesFirst")}</div>}
          {d.locations.length === 0 && <div>{t("noLocation")}</div>}
        </div>
      </>
    );
  }

  return (
    <>
      <ErpCrumbs steps={[
        { label: n("inventory") },
        { label: t("adj.title") },
      ]} />
      <div className="page-head">
        <h1>{t("adj.title")}</h1>
        <HelpHint>
          {t("adj.help")}{" "}
          <Link href="/documents?type=STOCK_ADJUSTMENT" style={{ color: "var(--link)" }}>
            {t("pastAdjustments")}
          </Link>
        </HelpHint>
      </div>

      <AdjustmentForm
        action={createStockAdjustment}
        items={d.items as never}
        locations={d.locations as never}
        stockByLocation={d.stockByLocation as never}
        shelfSerials={await sql`
          select item_id, location_id, imei from v_stock_serial
           where status = 'IN_STOCK' order by imei` as never}
        categories={categories}
        uoms={d.uoms as never}
        today={today}
      />
    </>
  );
}

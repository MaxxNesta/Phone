import { todayLocal } from "@/lib/format";
import { getCompany } from "@/lib/queries";
import Link from "next/link";
import { getFormData, createStockTransfer } from "@/lib/actions";
import { allCategories } from "@/lib/tree";
import { sql } from "@/lib/db";
import { StockTransferForm } from "@/components/stock-transfer-form";
import { ErpCrumbs } from "@/components/erp-worklist";
import { DocHeading } from "@/components/doc-heading";
import { HelpHint } from "@/components/help-hint";
import { getTranslations } from "next-intl/server";

export default async function NewStockTransfer() {
  const t = await getTranslations("inventory");
  const c = await getTranslations("common");
  const n = await getTranslations("nav");
  const d = await getFormData();
  // The layout already read the company; this is that same cached read.
  const co = await getCompany();
  if (!co) return <div className="empty">{c("noCompany")}</div>;
  const categories = await allCategories(co.id);
  const today = todayLocal();

  if (categories.length === 0 || d.allLocations.length < 2) {
    return (
      <>
        <ErpCrumbs steps={[
          { label: n("inventory") },
          { label: t("tr.title") },
        ]} />
        <div className="page-head">
          <h1>{t("tr.title")}</h1>
        </div>
        <div className="alert">
          {categories.length === 0 && <div>{t("noCategoriesFirst")}</div>}
          {d.allLocations.length < 2 && <div>{t("tr.needTwo")}</div>}
        </div>
      </>
    );
  }

  return (
    <>
      {/* The heading every new document has (returns, adjustments). */}
      <DocHeading
        back={{ href: "/inventory/transfer", label: t("pastTransfers") }}
        trail={[{ label: t("pastTransfers"), href: "/inventory/transfer" }]}
        title={t("tr.title")} status="New">
        <HelpHint>
          {t("tr.help")}{" "}
          <Link href="/inventory/transfer" style={{ color: "var(--link)" }}>
            {t("pastTransfers")}
          </Link>
        </HelpHint>
      </DocHeading>

      <StockTransferForm
        action={createStockTransfer}
        items={d.items as never}
        // Quarantine (0218) is offered at both ends: stock goes in when found
        // faulty and comes out when released. The engine asks for a reason.
        locations={[...d.locations, ...d.quarantineLocations] as never}
        toLocations={[...d.allLocations, ...d.quarantineLocations] as never}
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

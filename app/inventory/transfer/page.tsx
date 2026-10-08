import { getCompany } from "@/lib/queries";
import Link from "next/link";
import { getFormData, createStockTransfer } from "@/lib/actions";
import { allCategories } from "@/lib/tree";
import { sql } from "@/lib/db";
import { StockTransferForm } from "@/components/stock-transfer-form";
import { ErpCrumbs } from "@/components/erp-worklist";
import { HelpHint } from "@/components/help-hint";

export default async function NewStockTransfer() {
  const d = await getFormData();
  // The layout already read the company; this is that same cached read.
  const co = await getCompany();
  if (!co) return <div className="empty">No company found.</div>;
  const categories = await allCategories(co.id);
  const today = new Date().toISOString().slice(0, 10);

  if (categories.length === 0 || d.locations.length < 2) {
    return (
      <>
        <ErpCrumbs steps={[
          { label: "Inventory" },
          { label: "Stock transfer" },
        ]} />
        <div className="page-head">
          <h1>Stock transfer</h1>
        </div>
        <div className="alert">
          {categories.length === 0 && <div>No categories yet — add one first.</div>}
          {d.locations.length < 2 && <div>Needs at least two stock locations set up.</div>}
        </div>
      </>
    );
  }

  return (
    <>
      <ErpCrumbs steps={[
        { label: "Inventory" },
        { label: "Stock transfer" },
      ]} />
      <div className="page-head">
        <h1>Stock transfer</h1>
        <HelpHint>
          Move stock between two of the company&rsquo;s own warehouses — the
          company-wide total never changes, only which location holds it.{" "}
          <Link href="/documents?type=STOCK_TRANSFER" style={{ color: "var(--link)" }}>
            Past transfers
          </Link>
        </HelpHint>
      </div>

      <StockTransferForm
        action={createStockTransfer}
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

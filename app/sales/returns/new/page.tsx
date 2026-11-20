import { todayLocal } from "@/lib/format";
import Link from "next/link";
import { getFormData, createSalesReturn } from "@/lib/actions";
import { getReturnableSales, getCompany } from "@/lib/queries";
import { allCategories } from "@/lib/tree";
import { sql } from "@/lib/db";
import { ReturnForm } from "@/components/return-form";
import { channelsAt } from "@/lib/payment-channels";
import { ErpCrumbs } from "@/components/erp-worklist";
import { HelpHint } from "@/components/help-hint";

export default async function NewSalesReturn({
  searchParams,
}: {
  searchParams?: Promise<{ claim?: string }>;
}) {
  const { claim } = (await searchParams) ?? {};
  const d = await getFormData();
  // The layout already read the company; this is that same cached read.
  const co = await getCompany();
  if (!co) return <div className="empty">No company found.</div>;
  const categories = await allCategories(co.id);
  const salesDocs = await getReturnableSales(co.id);
  const today = todayLocal();

  /**
   * Opened from a warranty claim (0221): the phone comes back faulty, from
   * the customer who bought it, against the sale it was sold on, at what it
   * was sold for. The return goes into quarantine and the claim records it.
   */
  const prefill = claim ? await (async () => {
    const [c] = await sql`
      select c.id, c.fault, c.partner_id, c.sale_document_id, c.item_id, s.serial_no, sd.location_id,
             (select (dl.net_amount / nullif(dl.base_qty, 0))::float from document_line dl
               where dl.document_id = c.sale_document_id and dl.item_id = c.item_id order by dl.line_no limit 1) as price
        from warranty_claim c
        join stock_serial s on s.id = c.serial_id
        left join document sd on sd.id = c.sale_document_id
       where c.id = ${claim} and c.company_id = ${co.id} and c.status = 'OPEN'`;
    if (!c) return null;
    const here = (d.locations as unknown as { id: string }[]).some((l) => l.id === c.location_id);
    return {
      sourceDocumentId: String(c.sale_document_id ?? ""), docNo: "", partnerId: String(c.partner_id ?? ""),
      locationId: here ? String(c.location_id) : "",
      lines: [{ itemId: String(c.item_id), qty: "1", unitPrice: c.price != null ? String(Math.round(Number(c.price) * 100) / 100) : "",
                serials: [{ serial: String(c.serial_no) }] }],
      faulty: String(c.fault), claimId: String(c.id),
    };
  })() : null;
  // How money can be paid back, as each location's branch maps it.
  const channels = Object.fromEntries(await Promise.all(
    (d.locations as unknown as { id: string }[]).map(async (l) => [l.id, await channelsAt(co.id, l.id)])));

  if (d.customers.length === 0 || categories.length === 0 || d.locations.length === 0) {
    return (
      <>
        <ErpCrumbs steps={[
          { label: "Customer returns", href: "/sales/returns" },
          { label: "Customer return" },
        ]} />
        <div className="page-head">
          <h1>Customer return</h1>
        </div>
        <div className="alert">
          {d.customers.length === 0 && <div>No customers yet — add one first.</div>}
          {categories.length === 0 && <div>No categories yet — add one first.</div>}
          {d.locations.length === 0 && <div>No stock location is set up.</div>}
        </div>
      </>
    );
  }

  return (
    <>
      <ErpCrumbs steps={[
        { label: "Customer returns", href: "/sales/returns" },
        { label: "Customer return" },
      ]} />
      <div className="page-head">
        <h1>Customer return</h1>
        <HelpHint>
          Goods come back and the customer owes less — one document for
          both.{" "}
          <Link href="/documents?type=SALES_RETURN" style={{ color: "var(--link)" }}>Past returns</Link>
        </HelpHint>
      </div>

      <ReturnForm
        kind="sales"
        action={createSalesReturn}
        partners={d.customers as never}
        items={d.items as never}
        locations={d.locations as never}
        categories={categories}
        uoms={d.uoms as never}
        today={today}
        serialPool={await sql`select item_id, imei, customer_id as partner_id, out_document_id as document_id, location_id
                 from v_stock_serial where status = 'SOLD' order by imei` as never}
        salesDocs={salesDocs as never}
        channels={channels}
        prefill={prefill as never}
      />
    </>
  );
}

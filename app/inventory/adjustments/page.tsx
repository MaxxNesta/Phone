import { todayLocal } from "@/lib/format";
import { getCompany, rejectedOnReceipt } from "@/lib/queries";
import Link from "next/link";
import { getFormData, createStockAdjustment } from "@/lib/actions";
import { allCategories } from "@/lib/tree";
import { sql } from "@/lib/db";
import { AdjustmentForm } from "@/components/adjustment-form";
import { ErpCrumbs } from "@/components/erp-worklist";
import { DocHeading } from "@/components/doc-heading";
import { HelpHint } from "@/components/help-hint";
import { getTranslations } from "next-intl/server";

export default async function NewStockAdjustment({
  searchParams,
}: {
  searchParams?: Promise<{ writeoff?: string }>;
}) {
  const { writeoff } = (await searchParams) ?? {};
  const t = await getTranslations("inventory");
  const c = await getTranslations("common");
  const n = await getTranslations("nav");
  const d = await getFormData();
  // The layout already read the company; this is that same cached read.
  const co = await getCompany();
  if (!co) return <div className="empty">{c("noCompany")}</div>;
  const categories = await allCategories(co.id);
  const today = todayLocal();

  /**
   * Opened from a goods receipt's defects (Path B): the units still in
   * quarantine that the supplier will neither take back nor credit, written
   * off from the bin they sit in, each line naming the receipt line it came
   * in on so the receipt can say what became of it.
   */
  const prefill = writeoff ? await (async () => {
    const [gr] = await sql`
      select id, doc_no from document
       where id = ${writeoff} and company_id = ${co.id} and doc_type = 'GOODS_RECEIPT' and status = 'POSTED'`;
    if (!gr) return null;
    const rows = (await rejectedOnReceipt(gr.id)) as any[];
    const held = rows.map((r) => {
      const us = r.units as any[];
      const serials = us.filter((u) => u.stillHeld).map((u) => String(u.imei));
      const qty = us.length ? serials.length
        : Math.max(0, Number(r.qty) - Number(r.returned) - Number(r.written_off ?? 0));
      return { r, serials, qty };
    }).filter((x) => x.qty > 0);
    if (held.length === 0) return null;
    // One adjustment is one bin: the first one holding these units.
    const bin = String(held[0].r.location_id);
    const here = held.filter((x) => String(x.r.location_id) === bin);
    const why = (src: string) => [...new Set(here.filter((x) => x.r.source === src).map((x) => String(x.r.reject_reason)))];
    return {
      docNo: String(gr.doc_no),
      locationId: bin,
      lines: here.map((x) => ({
        itemId: String(x.r.item_id), qty: String(-x.qty), sourceLineId: String(x.r.line_id),
        // What these units came in at: the cost the write-off takes off stock.
        cost: Number(x.r.unit_cost),
        serials: x.serials.map((serial) => ({ serial })),
        origin: `${x.r.source === "FOUND" ? "Reported defective after receipt" : "Rejected at receipt"} · ${String(x.r.reject_reason)}`,
      })),
      memo: [
        ...why("REFUSED").map((r) => `Rejected at receipt: ${r}.`),
        ...why("FOUND").map((r) => `Reported defective after receipt: ${r}.`),
      ].join(" ") + ` (${gr.doc_no}) Written off: the supplier will not take it back or credit it.`,
    };
  })() : null;

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
      <DocHeading
        back={writeoff && prefill
          ? { href: `/documents/${writeoff}`, label: `Back to ${prefill.docNo}` }
          : { href: "/documents?type=STOCK_ADJUSTMENT", label: t("pastAdjustments") }}
        trail={[{ label: t("pastAdjustments"), href: "/documents?type=STOCK_ADJUSTMENT" },
                ...(writeoff && prefill ? [{ label: prefill.docNo, href: `/documents/${writeoff}` }] : [])]}
        title={prefill ? t("adj.writeOffTitle") : t("adj.title")} status="New">
        <HelpHint>
          {t("adj.help")}{" "}
          <Link href="/documents?type=STOCK_ADJUSTMENT" style={{ color: "var(--link)" }}>
            {t("pastAdjustments")}
          </Link>
        </HelpHint>
      </DocHeading>

      <AdjustmentForm
        action={createStockAdjustment}
        items={d.items as never}
        // Defective stock is written off from quarantine, so its bins are offered too.
        locations={[...d.locations, ...d.quarantineLocations] as never}
        stockByLocation={d.stockByLocation as never}
        shelfSerials={await sql`
          select item_id, location_id, imei from v_stock_serial
           where status = 'IN_STOCK' order by imei` as never}
        categories={categories}
        uoms={d.uoms as never}
        today={today}
        prefill={prefill}
      />
    </>
  );
}

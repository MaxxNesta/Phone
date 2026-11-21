import { todayLocal } from "@/lib/format";
import Link from "next/link";
import { getFormData, createPurchaseReturn } from "@/lib/actions";
import { allCategories } from "@/lib/tree";
import { sql } from "@/lib/db";
import { getReturnablePurchases, getCompany, rejectedOnReceipt } from "@/lib/queries";
import { ReturnForm } from "@/components/return-form";
import { ErpCrumbs } from "@/components/erp-worklist";
import { HelpHint } from "@/components/help-hint";

export default async function NewPurchaseReturn({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; refused?: string; outcome?: string; claim?: string }>;
}) {
  const { source, refused, outcome, claim } = await searchParams;
  const d = await getFormData();
  // The layout already read the company; this is that same cached read.
  const co = await getCompany();
  if (!co) return <div className="empty">No company found.</div>;
  const categories = await allCategories(co.id);
  const today = todayLocal();
  const returnable = await getReturnablePurchases(co.id);

  /**
   * Opened from a goods receipt that is being cancelled because the goods went
   * back. The supplier, the warehouse and the lines are all on that receipt,
   * so asking for them again is asking a question whose answer is already
   * known — and the whole point of coming here from there is not having to go
   * and find it.
   */
  /**
   * Opened from a receipt's refused units (D-P7): the ones still in
   * quarantine, by IMEI, at what they were received at, from quarantine.
   * Units the supplier is replacing go back against the receipt even once it
   * is billed — the bill stands, the supplier owes goods — so they name the
   * receipt line they arrived on and the order expects them again. Units
   * for credit go back against the bill once there is one, as any return.
   */
  const refusedPrefill = refused
    ? await (async () => {
        const [gr] = await sql`
          select id, partner_id, doc_no from document
           where id = ${refused} and company_id = ${co.id}
             and doc_type = 'GOODS_RECEIPT' and status = 'POSTED'`;
        if (!gr) return null;
        const want = outcome === "CREDIT" ? "CREDIT" : "REPLACE";
        const all = (await rejectedOnReceipt(gr.id)) as any[];
        const rows = all.filter((r) => r.reject_outcome === want);
        const [billed] = want === "CREDIT" ? await sql`
          select d.id, d.doc_no from document d
           where d.company_id = ${co.id} and d.doc_type = 'PURCHASE_INVOICE' and d.status = 'POSTED'
             and (fn_current_document(d.source_document_id) = fn_current_document(${gr.id})
               or d.id = fn_current_document((select source_document_id from document where id = ${gr.id})))
           limit 1` : [];
        const lines = rows.map((r) => {
          const held = (r.units as any[]).filter((u) => u.stillHeld).map((u) => ({ serial: String(u.imei) }));
          const qty = (r.units as any[]).length ? held.length : Number(r.qty) - Number(r.returned);
          return {
            itemId: String(r.item_id), qty: String(qty), unitPrice: String(Number(r.unit_cost)),
            serials: held, sourceLineId: billed ? null : String(r.line_id), location: String(r.location_id),
            reason: String(r.reject_reason), found: r.source === "FOUND",
            // Each line says where its units came from, and counts only its own.
            origin: `${r.source === "FOUND" ? "Reported defective after receipt" : "Rejected at receipt"} · ${String(r.reject_reason)}`,
            available: qty,
          };
        }).filter((l) => Number(l.qty) > 0);
        if (lines.length === 0) return null;
        // What the receipt holds, for the sidebar: one read. Refused units are
        // receipt lines of their own (0218); faults found later are reports
        // beside the line (0224); ordered is the order lines this receipt answers.
        const [held] = await sql`
          select coalesce(sum(dl.base_qty), 0)::float as received,
                 (select coalesce(sum(o.base_qty), 0)::float from document_line o
                   where o.id in (select source_line_id from document_line where document_id = ${gr.id})) as ordered,
                 (select o.doc_no from document o
                   where o.id = (select source_document_id from document where id = ${gr.id})
                     and o.doc_type = 'PURCHASE_ORDER') as order_no
            from document_line dl where dl.document_id = ${gr.id}`;
        const count = (src: string) => all.filter((r) => r.source === src).reduce((t, r) => t + Number(r.qty), 0);
        return {
          receipt: { docNo: String(gr.doc_no), orderNo: held.order_no ? String(held.order_no) : null,
                     ordered: Number(held.ordered), received: Number(held.received),
                     rejected: count("REFUSED"), found: count("FOUND"), replace: want === "REPLACE" },
          sourceDocumentId: String(billed?.id ?? gr.id),
          docNo: String(billed?.doc_no ?? gr.doc_no),
          partnerId: String(gr.partner_id),
          locationId: lines[0].location,
          lines: lines.map(({ location, reason, found, ...l }) => l),
          // One sentence per reason, said the same way the receipt says it.
          memo: [
            ...[...new Set(lines.filter((l) => !l.found).map((l) => l.reason))].map((r) => `Rejected at receipt: ${r}.`),
            ...[...new Set(lines.filter((l) => l.found).map((l) => l.reason))].map((r) => `Reported defective after receipt: ${r}.`),
          ].join(" ") + ` (${gr.doc_no}) ` + (want === "REPLACE" ? "Supplier to replace." : "Supplier to credit."),
        };
      })()
    : null;

  /**
   * Opened from a warranty claim (0221): the faulty phone goes from quarantine
   * to the supplier it came from, under their warranty, at what it cost. The
   * claim records the return.
   */
  const claimPrefill = claim ? await (async () => {
    const [c] = await sql`
      select c.id, c.claim_no, c.fault, c.item_id, c.supplier_id, s.serial_no, v.location_id, v.unit_cost
        from warranty_claim c
        join stock_serial s on s.id = c.serial_id
        join v_stock_serial v on v.serial_id = c.serial_id
        join location l on l.id = v.location_id and l.is_quarantine
       where c.id = ${claim} and c.company_id = ${co.id} and c.status = 'OPEN' and v.status = 'IN_STOCK'`;
    if (!c || !c.supplier_id) return null;
    return {
      sourceDocumentId: "", docNo: "", partnerId: String(c.supplier_id), locationId: String(c.location_id),
      lines: [{ itemId: String(c.item_id), qty: "1", unitPrice: String(Number(c.unit_cost ?? 0)),
                serials: [{ serial: String(c.serial_no) }] }],
      memo: `Warranty claim ${c.claim_no}: ${c.fault}`, claimId: String(c.id),
    };
  })() : null;

  const prefill = claimPrefill ?? refusedPrefill ?? (source
    ? await (async () => {
        // Either kind of source: a receipt still sitting in the clearing
        // account, or the bill that has since asked for money. Which one is
        // correct is decided by the page sending us here, because that is
        // where it is known — and the engine refuses the wrong one anyway.
        const [doc] = await sql`
          select id, partner_id, location_id, doc_no
            from document
           where id = ${source} and company_id = ${co.id}
             and doc_type in ('GOODS_RECEIPT', 'PURCHASE_INVOICE')
             and status = 'POSTED'`;
        if (!doc) return null;
        const lines = await sql`
          select item_id, base_qty, net_amount
            from document_line where document_id = ${doc.id} order by line_no`;
        return {
          sourceDocumentId: String(doc.id),
          docNo: String(doc.doc_no),
          partnerId: String(doc.partner_id),
          locationId: doc.location_id ? String(doc.location_id) : "",
          lines: (lines as Record<string, unknown>[]).map((l) => ({
            itemId: String(l.item_id),
            qty: String(Number(l.base_qty)),
            // The receipt's own rate, which is the accrual a return has to
            // clear — the form derives the same figure, and starting from it
            // means the two never differ on screen.
            unitPrice: Number(l.base_qty) > 0
              ? String(Number(l.net_amount) / Number(l.base_qty)) : "",
          })),
        };
      })()
    : null);

  if (d.suppliers.length === 0 || categories.length === 0 || d.locations.length === 0) {
    return (
      <>
        <ErpCrumbs steps={[
          { label: "Supplier returns", href: "/purchases/returns" },
          { label: "Supplier return" },
        ]} />
        <div className="page-head">
          <h1>Supplier return</h1>
        </div>
        <div className="alert">
          {d.suppliers.length === 0 && <div>No suppliers yet — add one first.</div>}
          {categories.length === 0 && <div>No categories yet — add one first.</div>}
          {d.locations.length === 0 && <div>No stock location is set up.</div>}
        </div>
      </>
    );
  }

  return (
    <>
      <ErpCrumbs steps={[
        { label: "Supplier returns", href: "/purchases/returns" },
        ...(prefill ? [{ label: prefill.docNo, href: `/documents/${prefill.sourceDocumentId}` }] : []),
        { label: "Supplier return" },
      ]} />
      <div className="page-head">
        <h1>Supplier return</h1>
        <HelpHint>
          Goods go back and what&rsquo;s owed drops — one document for both.{" "}
          <Link href="/documents?type=PURCHASE_RETURN" style={{ color: "var(--link)" }}>Past returns</Link>
        </HelpHint>
      </div>

      <ReturnForm
        kind="purchase"
        action={createPurchaseReturn}
        partners={d.suppliers as never}
        items={d.items as never}
        // Faulty and refused goods go back from quarantine (0218).
        locations={[...d.locations, ...d.quarantineLocations] as never}
        categories={categories}
        uoms={d.uoms as never}
        today={today}
        serialPool={await sql`select item_id, imei, supplier_id as partner_id, received_document_id as document_id, location_id
                 from v_stock_serial where status = 'IN_STOCK' order by imei` as never}
        salesDocs={returnable as never}
        stockByLocation={d.stockByLocation as never}
        prefill={prefill as never}
      />
    </>
  );
}

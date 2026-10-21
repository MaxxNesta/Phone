import { getFormData, createPurchaseInvoice, saveInvoiceDraft } from "@/lib/actions";
import { getOpenGoodsReceipts, getOpenOrdersAwaitingGoods, getDocumentDraft, getCompany } from "@/lib/queries";
import { allCategories } from "@/lib/tree";
import { sql } from "@/lib/db";
import { InvoiceForm } from "@/components/invoice-form";
import { channelsAt } from "@/lib/payment-channels";
import { ErpCrumbs } from "@/components/erp-worklist";
import { DocHeading } from "@/components/doc-heading";
import { HelpHint } from "@/components/help-hint";

export default async function NewPurchaseInvoice({
  searchParams,
}: {
  searchParams: Promise<{ goods_receipt_id?: string; draft?: string }>;
}) {
  const { goods_receipt_id, draft: draftId } = await searchParams;
  const { suppliers, items, locations, uoms, cashAccounts, taxCodes, fx } = await getFormData();
  // The layout already read the company; this is that same cached read.
  const co = await getCompany();
  if (!co) return <div className="empty">No company found.</div>;

  // Resuming an unfinished bill. A draft deleted meanwhile opens a blank
  // form rather than an error.
  const draftRow = draftId ? await getDocumentDraft(co.id, draftId) : null;
  const draft = draftRow
    ? {
        id: draftRow.id as string,
        state: String((draftRow.payload as Record<string, unknown>)?.draft_state ?? ""),
      }
    : null;
  const categories = await allCategories(co.id);
  // How a bill paid now leaves the shop, as each location's branch maps it.
  const channels = Object.fromEntries(await Promise.all(
    (locations as unknown as { id: string }[]).map(async (l) => [l.id, await channelsAt(co.id, l.id)])));
  const goodsReceipts = await getOpenGoodsReceipts(co.id);
  // Raised from one receipt's own page: the crumb names it, so the way back
  // leads to that document rather than to a list the reader never came from.
  const from = goods_receipt_id
    ? (goodsReceipts as { id: string; doc_no: string }[]).find((g) => g.id === goods_receipt_id)
    : undefined;
  const awaiting = await getOpenOrdersAwaitingGoods(co.id, "PURCHASE_ORDER");
  const today = new Date().toISOString().slice(0, 10);

  // Items are deliberately not required: a product can be created from the
  // voucher itself. A category is, since nothing unclassified may enter stock.
  if (suppliers.length === 0 || categories.length === 0 || locations.length === 0) {
    return (
      <>
        <ErpCrumbs steps={[
          { label: "Purchase invoices", href: "/purchases/invoices" },
          { label: "New purchase invoice" },
        ]} />
        <div className="page-head">
          <h1>New purchase invoice</h1>
        </div>
        <div className="alert">
          {suppliers.length === 0 && <div>No suppliers yet — add one first.</div>}
          {categories.length === 0 && (
            <div>
              No categories yet — add one first, so new items have somewhere to file.
            </div>
          )}
          {locations.length === 0 && <div>No stock location is set up.</div>}
        </div>
      </>
    );
  }

  return (
    <>
      {/* Raised from one receipt: the arrow goes back to that document, not
          the list of every invoice. */}
      <DocHeading
        back={from
          ? { href: `/documents/${from.id}`, label: `Back to ${from.doc_no}` }
          : { href: "/purchases/invoices", label: "Back to purchase invoices" }}
        trail={[
          { label: "Purchase invoices", href: "/purchases/invoices" },
          ...(from ? [{ label: from.doc_no, href: `/documents/${from.id}` }] : []),
        ]}
        title="New purchase invoice" status={draft ? "Draft" : "New"}>
        <HelpHint>
          Stock arrives at the price paid and the supplier balance opens. Each
          receipt becomes its own FIFO cost layer.
        </HelpHint>
      </DocHeading>

      <InvoiceForm
        kind="purchase"
        fx={fx}
        action={createPurchaseInvoice}
        saveDraft={saveInvoiceDraft}
        draft={draft}
        partners={suppliers as never}
        items={items as never}
        locations={locations as never}
        categories={categories}
        uoms={uoms as never}
        today={today}
        cashAccounts={cashAccounts as never}
        channels={channels}
        goodsReceipts={goodsReceipts as never}
        initialGoodsReceiptId={goods_receipt_id}
        awaiting={awaiting}
        taxCodes={taxCodes as never}
      />
    </>
  );
}

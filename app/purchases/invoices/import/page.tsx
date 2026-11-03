import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { HelpHint } from "@/components/help-hint";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { PurchaseImport } from "@/components/purchase-import";

export const metadata = { title: "Import purchase invoices" };

export default async function ImportPurchaseInvoices() {
  await requirePermission("purchase.post");
  return (
    <>
      <Breadcrumbs trail={[{ label: "Purchase invoices", href: "/purchases/invoices" }, { label: "Import" }]} />
      <div className="page-head">
        <span className="eyebrow">Purchases</span>
        <h1>Import invoices</h1>
        <HelpHint>From the old system&apos;s Excel report. Historical records — no stock, journal or payable is created.</HelpHint>
      </div>
      <div className="actions">
        <Link href="/purchases/invoices/imported" className="btn ghost">Imported invoices</Link>
      </div>
      <PurchaseImport />
    </>
  );
}

import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { HelpHint } from "@/components/help-hint";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { PurchaseImport } from "@/components/purchase-import";

export const metadata = { title: "Import sales invoices" };

export default async function ImportSalesInvoices() {
  await requirePermission("sales.post");
  return (
    <>
      <Breadcrumbs trail={[{ label: "Sales invoices", href: "/sales/invoices" }, { label: "Import" }]} />
      <div className="page-head">
        <span className="eyebrow">Sales</span>
        <h1>Import invoices</h1>
        <HelpHint>The sales invoice report, uploaded or pasted. Each invoice posts as a real sale with its delivery — the phones must be in stock, so import the purchases that brought them in first.</HelpHint>
      </div>
      <div className="actions">
        <Link href="/sales/invoices" className="btn ghost">Sales invoices</Link>
      </div>
      <PurchaseImport side="sales" />
    </>
  );
}

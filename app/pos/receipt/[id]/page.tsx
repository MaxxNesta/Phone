import { seenLocations } from "@/lib/branch-scope";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/auth-core";
import { receiptView } from "@/lib/receipt";
import { PrintButton, AutoPrint } from "@/components/print-button";
import { ReceiptSlip } from "@/components/receipt-slip";
import { ReceiptPrintHost } from "@/components/receipt-print";

export const metadata = { title: "Receipt" };

export default async function Receipt({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }>;
}) {
  const user = await requirePermission("sales.view");
  const { id } = await params;
  const { print } = await searchParams;
  // Another branch's receipt is not found by someone who sees only their own.
  // A sale printed before is drawn with the template version it was printed
  // with; one never printed is pinned to its branch's template now.
  const view = await receiptView(user.companyId, id, await seenLocations(), { bind: true });
  if (!view) notFound();

  // Reprinting is the template's to allow; whoever manages receipts may always.
  if (!view.config.general.allowReprint && !can(user, "receipts.manage")) {
    return (
      <div className="empty" style={{ maxWidth: 520, margin: "3rem auto" }}>
        Reprinting receipts is turned off for this shop. A manager can print it, or turn reprinting on
        in Settings → POS Settings → Receipt Templates.
      </div>
    );
  }

  const logoUrl = view.identity.hasLogo ? "/api/company-logo" : null;
  const slip = <ReceiptSlip data={view.data} config={view.config} identity={view.identity} paper={view.paper} logoUrl={logoUrl} />;
  return (
    <>
      <div className="noprint rc-page-bar">
        <PrintButton />
        <span className="page-sub">
          {view.template ? `${view.template.name} · version ${view.template.version}` : "Standard receipt"}
        </span>
      </div>
      <div className={`rc-preview rc-preview-${view.paper} rc-page-preview`}>{slip}</div>
      <ReceiptPrintHost paper={view.paper}>{slip}</ReceiptPrintHost>
      {print === "1" && <AutoPrint />}
    </>
  );
}

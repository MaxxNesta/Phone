import { PartnerTabs } from "@/components/partner-tabs";
import { getCompany, getBranches } from "@/lib/queries";
import { scopedBranch, seenBranches } from "@/lib/branch-scope";
import { getOutstandingSummary } from "@/lib/partner-ledger";
import { OutstandingSummaryView } from "@/components/outstanding-summary-view";
import { HelpHint } from "@/components/help-hint";

export const metadata = { title: "Supplier outstanding summary" };

/** The supplier side of the Outstanding Summary (2026-11-25): a line a supplier, from the supplier ledger. */
export default async function SupplierSummaryPage({ searchParams }: { searchParams: Promise<{ branch?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;
  const branch = await scopedBranch(sp.branch);
  const branches = await seenBranches((await getBranches(company.id)) as unknown as { id: string; code: string; name: string }[]);
  const rows = await getOutstandingSummary(company.id, "SUPPLIER", { branchId: branch, from: sp.from || null, to: sp.to || null });
  return (
    <>
      <div className="page-head">
        <span className="eyebrow">Purchases</span>
        <h1>Supplier outstanding summary</h1>
        <HelpHint>
          One line a supplier: opening, purchases, returns, discounts and payments in the period, then what is paid
          ahead (prepaid) and what bills still owe (balance). The same figures as the supplier ledger.
        </HelpHint>
      </div>
      <PartnerTabs side="SUPPLIER" active="summary" />
      <OutstandingSummaryView side="SUPPLIER" rows={rows} branches={branches} sp={{ ...sp, branch: branch ?? "" }} base="/payables/summary" />
    </>
  );
}

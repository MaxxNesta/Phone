import { BranchScope } from "@/components/branch-scope";
import { seenLocations } from "@/lib/branch-scope";
import { getCompany, getAdvanceLedger, openBillsByPartner } from "@/lib/queries";
import { AdvanceSummary } from "@/components/advance-summary";
import Link from "next/link";
import { AdvanceLedger } from "@/components/advance-ledger";
import { HelpHint } from "@/components/help-hint";

export default async function CustomerAdvances({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await searchParams;
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;

  const locs = await seenLocations();
  const [advances, bills] = await Promise.all([
    getAdvanceLedger(company.id, "CUSTOMER", locs),
    openBillsByPartner(company.id, "SALES_INVOICE", locs),
  ]);

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">Sales</span>
        <h1>Customer advances</h1>
        <BranchScope />
        <HelpHint>
          Money customers have paid before any invoice existed — what is still
          held for them, and which bills the rest has gone to. It is a
          liability until it is applied, never a receivable.
        </HelpHint>
      </div>
      <div className="vtabs pay-tabs" role="tablist" aria-label="Receivables">
        <Link href="/receivables" role="tab" aria-selected={false}>Customers</Link>
        <Link href="/receivables/ledger" role="tab" aria-selected={false}>Customer ledger</Link>
        <Link href="/receivables/advances" role="tab" aria-selected className="on">Advances</Link>
      </div>

      <AdvanceSummary side="CUSTOMER" advances={advances} bills={bills} />
      <h2 className="adv-sum-sub">Every advance</h2>
      <AdvanceLedger side="CUSTOMER" advances={advances} />
    </>
  );
}

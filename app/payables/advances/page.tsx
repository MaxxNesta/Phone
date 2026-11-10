import { BranchScope } from "@/components/branch-scope";
import { seenLocations } from "@/lib/branch-scope";
import { getCompany, getAdvanceLedger, openBillsByPartner } from "@/lib/queries";
import { AdvanceSummary } from "@/components/advance-summary";
import Link from "next/link";
import { AdvanceLedger } from "@/components/advance-ledger";
import { HelpHint } from "@/components/help-hint";

export default async function SupplierAdvances({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await searchParams;
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;

  const locs = await seenLocations();
  const [advances, bills] = await Promise.all([
    getAdvanceLedger(company.id, "SUPPLIER", locs),
    openBillsByPartner(company.id, "PURCHASE_INVOICE", locs),
  ]);

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">Purchases</span>
        <h1>Supplier advances</h1>
        <BranchScope />
        <HelpHint>
          Money paid to suppliers before they billed for anything — what they
          still owe us in goods, and which bills the rest has gone to. It is an
          asset until it is applied, never a payable.
        </HelpHint>
      </div>
      <div className="vtabs pay-tabs" role="tablist" aria-label="Payables">
        <Link href="/payables" role="tab" aria-selected={false}>Suppliers</Link>
        <Link href="/payables/ledger" role="tab" aria-selected={false}>Supplier ledger</Link>
        <Link href="/payables/advances" role="tab" aria-selected className="on">Advances</Link>
      </div>

      <AdvanceSummary side="SUPPLIER" advances={advances} bills={bills} />
      <h2 className="adv-sum-sub">Every advance</h2>
      <AdvanceLedger side="SUPPLIER" advances={advances} />
    </>
  );
}

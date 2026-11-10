import { PartnerTabs } from "@/components/partner-tabs";
import { getCompany, getBranches } from "@/lib/queries";
import { scopedBranch, seenBranches } from "@/lib/branch-scope";
import { sql } from "@/lib/db";
import { getPartnerLedger } from "@/lib/partner-ledger";
import { PartnerLedgerView } from "@/components/partner-ledger-view";
import { HelpHint } from "@/components/help-hint";

export const metadata = { title: "Customer ledger" };

/**
 * Each customer's sales and payments with a running balance, under their
 * township, as the old Customer Ledger printed them. Money taken before the
 * invoice is a customer advance (Sale Advance): it shows on the day it was
 * received, and applying it to the invoice moves nothing here.
 */
export default async function CustomerLedgerPage({ searchParams }: { searchParams: Promise<{ branch?: string; partner?: string; township?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;
  // Someone limited to a branch sees that branch only, whatever the link asks for.
  const branch = await scopedBranch(sp.branch);
  const branches = await seenBranches((await getBranches(company.id)) as unknown as { id: string; code: string; name: string }[]);
  const [customers, towns, ledger] = await Promise.all([
    sql`select id, code, name from business_partner where company_id = ${company.id} and is_customer
          ${sp.township ? (sp.township === "-" ? sql`and township is null` : sql`and township = ${sp.township}`) : sql``}
        order by code`,
    sql`select distinct township from business_partner where company_id = ${company.id} and is_customer and township is not null order by township`,
    getPartnerLedger(company.id, "CUSTOMER", { branchId: branch, partnerId: sp.partner || null, township: sp.township || null, from: sp.from || null, to: sp.to || null }),
  ]);
  return (
    <>
      <div className="page-head">
        <span className="eyebrow">Sales</span>
        <h1>Customer ledger</h1>
        <HelpHint>
          Sales and payments per customer, grouped by township, with the running balance and each township&apos;s total.
          Money taken before the invoice is a customer advance (Sale Advance): it shows on the day it was received.
        </HelpHint>
      </div>
      <PartnerTabs side="CUSTOMER" active="ledger" />
      <PartnerLedgerView side="CUSTOMER" branches={branches} ledger={ledger} partners={customers as never}
        townships={towns.map((t) => t.township as string)} sp={{ ...sp, branch: branch ?? "" }} base="/receivables/ledger" />
    </>
  );
}

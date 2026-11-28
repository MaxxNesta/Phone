import { PartnerTabs } from "@/components/partner-tabs";
import { getCompany, getBranches } from "@/lib/queries";
import { scopedBranch, seenBranches } from "@/lib/branch-scope";
import { sql } from "@/lib/db";
import { getOutstandingSummary, partnerIdsOf } from "@/lib/partner-ledger";
import { OutstandingSummaryView } from "@/components/outstanding-summary-view";
import { HelpHint } from "@/components/help-hint";

export const metadata = { title: "Customer outstanding summary" };

/** The old Customer Outstanding Summary (2026-11-25): a line a customer, by township, from the customer ledger. */
export default async function CustomerSummaryPage({ searchParams }: { searchParams: Promise<{ branch?: string; township?: string; partner?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;
  const branch = await scopedBranch(sp.branch);
  const branches = await seenBranches((await getBranches(company.id)) as unknown as { id: string; code: string; name: string }[]);
  const [customers, towns, rows] = await Promise.all([
    sql`select id, code, name from business_partner where company_id = ${company.id} and is_customer
          ${sp.township ? (sp.township === "-" ? sql`and coalesce(city, township) is null` : sql`and coalesce(city, township) = ${sp.township}`) : sql``}
        order by code`,
    sql`select distinct coalesce(city, township) as township from business_partner where company_id = ${company.id} and is_customer and coalesce(city, township) is not null order by 1`,
    getOutstandingSummary(company.id, "CUSTOMER", { branchId: branch, partnerIds: partnerIdsOf(sp.partner), township: sp.township || null, from: sp.from || null, to: sp.to || null }),
  ]);
  return (
    <>
      <div className="page-head">
        <span className="eyebrow">Sales</span>
        <h1>Customer outstanding summary</h1>
        <HelpHint>
          One line a customer, grouped by township: opening, sales, returns, discounts and payments in the period, then
          what is paid ahead (prepaid) and what invoices still owe (balance). The same figures as the customer ledger.
        </HelpHint>
      </div>
      <PartnerTabs side="CUSTOMER" active="summary" />
      <OutstandingSummaryView side="CUSTOMER" rows={rows} townships={towns.map((t) => t.township as string)}
        branches={branches} partners={customers as never} sp={{ ...sp, branch: branch ?? "" }} base="/receivables/summary" />
    </>
  );
}

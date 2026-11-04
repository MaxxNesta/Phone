import Link from "next/link";
import { getCompany } from "@/lib/queries";
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
export default async function CustomerLedgerPage({ searchParams }: { searchParams: Promise<{ partner?: string; township?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;
  const [customers, towns, ledger] = await Promise.all([
    sql`select id, code, name from business_partner where company_id = ${company.id} and is_customer
          ${sp.township ? (sp.township === "-" ? sql`and township is null` : sql`and township = ${sp.township}`) : sql``}
        order by code`,
    sql`select distinct township from business_partner where company_id = ${company.id} and is_customer and township is not null order by township`,
    getPartnerLedger(company.id, "CUSTOMER", { partnerId: sp.partner || null, township: sp.township || null, from: sp.from || null, to: sp.to || null }),
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
      <div className="vtabs pay-tabs" role="tablist" aria-label="Receivables">
        <Link href="/receivables" role="tab" aria-selected={false}>Customers</Link>
        <Link href="/receivables/ledger" role="tab" aria-selected className="on">Customer ledger</Link>
      </div>
      <PartnerLedgerView side="CUSTOMER" ledger={ledger} partners={customers as never}
        townships={towns.map((t) => t.township as string)} sp={sp} base="/receivables/ledger" />
    </>
  );
}

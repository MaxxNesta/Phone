import Link from "next/link";
import { getCompany } from "@/lib/queries";
import { sql } from "@/lib/db";
import { getPartnerLedger } from "@/lib/partner-ledger";
import { PartnerLedgerView } from "@/components/partner-ledger-view";
import { HelpHint } from "@/components/help-hint";

export const metadata = { title: "Supplier ledger" };

/**
 * Each supplier's purchases and payments with a running balance, as the old
 * system printed them. A payment made ahead of the bill is a supplier advance:
 * it shows on the day it was paid and the balance goes below zero until the
 * bill arrives; applying it moves nothing here.
 */
export default async function SupplierLedgerPage({ searchParams }: { searchParams: Promise<{ partner?: string; supplier?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;
  const partner = sp.partner || sp.supplier || "";
  const [suppliers, ledger] = await Promise.all([
    sql`select id, code, name from business_partner where company_id = ${company.id} and is_supplier order by code`,
    getPartnerLedger(company.id, "SUPPLIER", { partnerId: partner || null, from: sp.from || null, to: sp.to || null }),
  ]);
  return (
    <>
      <div className="page-head">
        <span className="eyebrow">Purchases</span>
        <h1>Supplier ledger</h1>
        <HelpHint>
          Purchases and payments per supplier, with the running balance. A payment made before the bill is a supplier
          advance (Purchase Advance): it shows on the day it was paid, and the balance stays below zero until the bill it
          is applied to arrives.
        </HelpHint>
      </div>
      <div className="vtabs pay-tabs" role="tablist" aria-label="Payables">
        <Link href="/payables" role="tab" aria-selected={false}>Suppliers</Link>
        <Link href="/payables/ledger" role="tab" aria-selected className="on">Supplier ledger</Link>
      </div>
      <PartnerLedgerView side="SUPPLIER" ledger={ledger} partners={suppliers as never} sp={{ ...sp, partner }} base="/payables/ledger" />
    </>
  );
}

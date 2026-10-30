import { requirePermission } from "@/lib/auth";
import { sql } from "@/lib/db";
import { seenLocations } from "@/lib/branch-scope";
import { postedReceipts, landedCostTypes } from "@/lib/landed-cost-queries";
import { recordCourierBillAction } from "@/lib/courier-actions";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { HelpHint } from "@/components/help-hint";
import { CourierBillForm } from "@/components/courier-bill-form";
import { moneyAccounts } from "@/lib/courier-payables";

export async function generateMetadata() {
  const user = await requirePermission("purchase.post");
  const [{ n }] = await sql`select count(*)::int as n from landed_cost_type where company_id = ${user.companyId} and is_active`;
  return { title: n > 1 ? "Record import cost" : "Record carriage inward" };
}

export default async function RecordCourierBill({ searchParams }: { searchParams: Promise<{ partner?: string; gr?: string }> }) {
  const user = await requirePermission("purchase.post");
  const { partner, gr } = await searchParams;
  const [couriers, receipts, types, accounts] = await Promise.all([
    sql`select id, code, name from business_partner where company_id = ${user.companyId} and is_supplier and is_active order by name`,
    postedReceipts(user.companyId, await seenLocations()),
    landedCostTypes(user.companyId, true),
    sql`select r.role, a.code || ' ' || a.name as label from system_account r join account a on a.id = r.account_id
         where r.company_id = ${user.companyId} and r.role in ('CARRIAGE_INWARD', 'OTHER_PAYABLE', 'LANDED_COST_CLEARING')`,
  ]) as [any[], any[], any[], any[]];
  const label = (role: string) => accounts.find((a) => a.role === role)?.label ?? null;

  return (
    <div className="ie">
      <Breadcrumbs trail={[{ label: "Payables", href: "/payables" }, { label: "Carriage inward", href: "/payables?view=couriers" }, { label: types.length > 1 ? "Record import cost" : "Record carriage inward" }]} />
      <header className="ie-title">
        {types.length > 1
          ? <h1>Record import cost <HelpHint label="About import costs">One cost for goods already received: carriage, customs duty, insurance or another type in use. It is added to the phones&rsquo; cost and reaches cost of sales only as each phone sells. Carriage is booked through Carriage Inward; any other cost owed goes straight to the phones, and one paid now waits in Landed Cost Clearing for the moment it takes to spread. For several costs on one shipment, use Add landed cost.</HelpHint></h1>
          : <h1>Record carriage inward <HelpHint label="About carriage inward">Carriage inward is everything paid to a third party to bring these goods in: the car or driver fee, and any freight, customs and clearance the forwarder handles and bills as one amount. It is added to the phones&rsquo; cost and reaches cost of sales only as each phone sells. Booked to Carriage Inward, owed in Payable (Other) or paid now, and spread onto the phones of the goods receipt in the same step.</HelpHint></h1>}
      </header>
      <CourierBillForm
        action={recordCourierBillAction}
        couriers={couriers.map((c) => ({ id: c.id, label: `${c.name} · ${c.code}` }))}
        receipts={receipts.filter((r) => r.phones > 0).map((r) => ({ id: r.id, no: r.doc_no, date: r.doc_date, supplier: r.supplier, warehouse: r.warehouse, phones: r.phones, landed: r.landed_costs }))}
        types={types.map((t) => ({ id: t.id, label: t.name, code: t.code, method: t.default_method }))}
        carriageAccount={label("CARRIAGE_INWARD")}
        clearingAccount={label("LANDED_COST_CLEARING")}
        payableAccount={label("OTHER_PAYABLE")}
        paidFrom={(await moneyAccounts(user.companyId)).map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))}
        initialPartnerId={partner}
        initialReceiptId={gr}
        today={new Date().toISOString().slice(0, 10)}
      />
    </div>
  );
}

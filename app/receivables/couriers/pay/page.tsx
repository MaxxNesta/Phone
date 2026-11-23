import { todayLocal } from "@/lib/format";
import { requirePermission } from "@/lib/auth";
import { onlyMyLocations } from "@/lib/branch-scope";
import { getBranches } from "@/lib/queries";
import { moneyAccounts } from "@/lib/courier-payables";
import { codCouriers, courierParcels } from "@/lib/cod-couriers";
import { remitCourierAction } from "@/lib/courier-actions";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { HelpHint } from "@/components/help-hint";
import { CodRemitForm } from "@/components/cod-remit-form";

export const metadata = { title: "Courier pay-in" };

export default async function CourierPayIn({ searchParams }: { searchParams: Promise<{ courier?: string }> }) {
  const user = await requirePermission("sales.post");
  const { courier } = await searchParams;
  const [couriers, parcels, branches, accounts] = await Promise.all([
    codCouriers(user.companyId),
    courierParcels(user.companyId, null),
    getBranches(user.companyId).then((b) => onlyMyLocations(b as unknown as { id: string; code: string; name: string }[])),
    moneyAccounts(user.companyId),
  ]);
  const owing = couriers.filter((c) => c.held > 0.005 || c.outCount > 0);

  return (
    <div className="ie">
      <Breadcrumbs trail={[{ label: "Receivables", href: "/receivables" }, { label: "COD couriers", href: "/receivables?view=couriers" }, { label: "Pay in" }]} />
      <header className="ie-title">
        <h1>Courier pay-in <HelpHint label="About courier pay-in">The courier pays in the cash on delivery it collected, usually keeping its fee back. Tick any parcel it collected that is not confirmed yet: each is handed over through the same check as a driver&rsquo;s doorstep handover. It posts as a cash or bank voucher: the account takes what arrived, Carriage Outward the fee, and COD Receivable under the courier comes down by both.</HelpHint></h1>
      </header>
      {owing.length === 0 ? (
        <p className="page-sub">No courier is holding or carrying cash on delivery right now.</p>
      ) : (
        <CodRemitForm
          action={remitCourierAction}
          couriers={owing.map((c) => ({ id: c.id, name: c.name, held: c.held, feeMode: c.feeMode }))}
          parcels={parcels.map((p) => ({ id: p.id, courierId: p.collector!.id, no: p.no, invoiceNo: p.invoiceNo, date: p.date,
            customer: p.customer, invoiceId: p.invoiceId, goods: p.goods, extras: p.extras, availableDeposit: p.availableDeposit, sharedAmount: p.sharedAmount, branchId: p.branchId }))}
          branches={branches.map((b) => ({ id: b.id, label: `${b.code} · ${b.name}` }))}
          accounts={accounts.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))}
          initialCourierId={courier}
          today={todayLocal()}
        />
      )}
    </div>
  );
}

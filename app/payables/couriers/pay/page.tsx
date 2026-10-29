import { requirePermission } from "@/lib/auth";
import { onlyMyLocations, seenLocations } from "@/lib/branch-scope";
import { getBranches } from "@/lib/queries";
import { courierBalances, courierCharges, moneyAccounts } from "@/lib/courier-payables";
import { payCourierAction } from "@/lib/courier-actions";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { HelpHint } from "@/components/help-hint";
import { CourierPayForm } from "@/components/courier-pay-form";

export const metadata = { title: "Pay carriage inward" };

export default async function PayCourier({ searchParams }: { searchParams: Promise<{ partner?: string; charge?: string }> }) {
  const user = await requirePermission("accounting.post");
  const { partner, charge } = await searchParams;
  const locs = await seenLocations();
  const owing = (await courierBalances(user.companyId, locs)).filter((c) => c.outstanding > 0.0001);
  const charges = (await Promise.all(owing.map((c) => courierCharges(user.companyId, c.partner_id, locs))))
    .flatMap((list, i) => list.filter((x) => x.open > 0.0001).map((x) => ({ ...x, partnerId: owing[i].partner_id })));
  const [branches, accounts] = await Promise.all([
    onlyMyLocations((await getBranches(user.companyId)) as unknown as { id: string; code: string; name: string }[]),
    moneyAccounts(user.companyId),
  ]);

  return (
    <div className="ie">
      <Breadcrumbs trail={[{ label: "Payables", href: "/payables" }, { label: "Carriage inward", href: "/payables?view=couriers" }, { label: "Pay carriage inward" }]} />
      <header className="ie-title">
        <h1>Pay carriage inward <HelpHint label="About paying carriage inward">Tick the bills you are paying and how much of each. It posts as a cash or bank voucher: Payable (Other) down under the courier, the till down by the same amount.</HelpHint></h1>
      </header>
      {owing.length === 0 ? (
        <p className="page-sub">No courier is owed anything right now.</p>
      ) : (
        <CourierPayForm
          action={payCourierAction}
          couriers={owing.map((c) => ({ id: c.partner_id, name: c.partner_name, code: c.partner_code, outstanding: c.outstanding }))}
          charges={charges.map((c) => ({ id: c.id, partnerId: c.partnerId, lcId: c.lc_id, lcNo: c.lc_no, date: c.doc_date, type: c.cost_type, receipts: c.receipts, open: c.open, owed: c.owed }))}
          branches={branches.map((b) => ({ id: b.id, label: `${b.code} · ${b.name}` }))}
          accounts={accounts.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))}
          initialPartnerId={partner}
          initialChargeId={charge}
          today={new Date().toISOString().slice(0, 10)}
        />
      )}
    </div>
  );
}

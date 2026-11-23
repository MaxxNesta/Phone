import Link from "next/link";
import { todayLocal } from "@/lib/format";
import { requirePermission } from "@/lib/auth";
import { onlyMyLocations } from "@/lib/branch-scope";
import { getBranches } from "@/lib/queries";
import { moneyAccounts } from "@/lib/courier-payables";
import { driversCash } from "@/lib/cod";
import { receiveFromDriverAction } from "@/lib/cod-actions";
import { PartnerTabs } from "@/components/partner-tabs";
import { HelpHint } from "@/components/help-hint";
import { DriverHandinForm } from "@/components/driver-handin-form";

export const metadata = { title: "Receive from driver" };

export default async function ReceiveFromDriver({ searchParams }: { searchParams: Promise<{ driver?: string }> }) {
  const user = await requirePermission("sales.post");
  const { driver } = await searchParams;
  const [drivers, branches, accounts] = await Promise.all([
    driversCash(user.companyId),
    getBranches(user.companyId).then((b) => onlyMyLocations(b as unknown as { id: string; code: string; name: string }[])),
    moneyAccounts(user.companyId),
  ]);

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">Sales</span>
        <h1>Receivables</h1>
        <HelpHint>
          Cash on delivery a driver collected at the door sits in Cash with Drivers under that driver until it is handed in.
          Tick what is being handed in and enter the cash counted: it moves to the till. Counted short, the difference stays
          against the driver.
        </HelpHint>
      </div>
      <PartnerTabs side="CUSTOMER" active="drivers" />
      {/* The driver list is shared with Logistics trips, but COD needs it without that add-on. */}
      <div className="actions" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
        <Link href="/logistics/drivers" className="btn ghost">Manage drivers</Link>
      </div>
      {drivers.length === 0 ? (
        <p className="page-sub">No driver is holding cash on delivery.</p>
      ) : (
        <DriverHandinForm
          action={receiveFromDriverAction}
          drivers={drivers}
          branches={branches.map((b) => ({ id: b.id, label: `${b.code} · ${b.name}` }))}
          tills={accounts.filter((a) => !a.is_bank_account).map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))}
          initialDriverId={driver}
          today={todayLocal()}
        />
      )}
    </>
  );
}

import { requirePermission } from "@/lib/auth";
import { HelpHint } from "@/components/help-hint";
import { CodCouriersView } from "../cod-couriers-view";

export const metadata = { title: "COD couriers" };

/** Courier companies carrying cash on delivery: what each carries, holds and has paid in (Delivery menu). */
export default async function CodCouriers() {
  const user = await requirePermission("sales.view");
  return (
    <>
      <div className="page-head">
        <span className="eyebrow">Delivery</span>
        <h1>COD couriers</h1>
        <HelpHint>
          Cash on delivery carried by courier companies: what each is carrying, what it has collected and not
          paid in yet (COD Receivable under its name), and what it has paid in. Its fee is Carriage Outward,
          kept back from the pay-in or billed separately, as the courier is set up.
        </HelpHint>
      </div>
      <CodCouriersView companyId={user.companyId} />
    </>
  );
}

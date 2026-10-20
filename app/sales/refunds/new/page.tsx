import { requirePermission } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { getRefundableReturns } from "@/lib/queries";
import { createCustomerRefund } from "@/lib/actions";
import { channelsAt } from "@/lib/payment-channels";
import { RefundForm } from "@/components/refund-form";
import { ErpCrumbs } from "@/components/erp-worklist";
import { HelpHint } from "@/components/help-hint";

export const metadata = { title: "Refund a customer" };

export default async function NewRefund({ searchParams }: { searchParams: Promise<{ return?: string }> }) {
  const user = await requirePermission("sales.return");
  const { return: returnId } = await searchParams;
  const rows = (await getRefundableReturns(user.companyId, await seenLocations()))
    .filter((r) => Number(r.refundable) > 0.5 || r.id === returnId);
  const locations = [...new Set(rows.map((r) => r.location_id as string).filter(Boolean))];
  const channels = Object.fromEntries(await Promise.all(locations.map(async (l) => [l, await channelsAt(user.companyId, l)])));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <ErpCrumbs steps={[{ label: "Customer returns", href: "/sales/returns" }, { label: "Refund" }]} />
      <div className="page-head">
        <h1>Refund a customer</h1>
        <HelpHint>
          Pays back what a return left owed to the customer — in cash, by bank transfer or to their wallet. The money
          leaves the account the payment method is set to at the return&rsquo;s branch, and the customer&rsquo;s balance
          comes back to zero. Revenue is not touched: the return already reversed it.
        </HelpHint>
      </div>
      <RefundForm action={createCustomerRefund} returns={rows as never} channels={channels}
        today={today} initialReturnId={returnId} />
    </>
  );
}

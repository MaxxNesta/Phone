import { seenLocations } from "@/lib/branch-scope";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { getReceipt } from "@/lib/receipt";
import { PrintButton } from "@/components/print-button";
import { ReceiptSlip } from "@/components/receipt-slip";

export const metadata = { title: "Receipt" };

export default async function Receipt({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("sales.view");
  const { id } = await params;
  // Another branch's receipt is not found by someone who sees only their own.
  const data = await getReceipt(user.companyId, id, await seenLocations());
  if (!data) notFound();

  return (
    <>
      <div className="noprint" style={{ marginBottom: "1rem" }}><PrintButton /></div>
      <ReceiptSlip data={data} />
    </>
  );
}

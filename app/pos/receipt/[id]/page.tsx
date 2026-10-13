import { seenLocations } from "@/lib/branch-scope";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { getReceipt } from "@/lib/receipt";
import { PrintButton, AutoPrint } from "@/components/print-button";
import { ReceiptSlip } from "@/components/receipt-slip";

export const metadata = { title: "Receipt" };

export default async function Receipt({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }>;
}) {
  const user = await requirePermission("sales.view");
  const { id } = await params;
  const { print } = await searchParams;
  // Another branch's receipt is not found by someone who sees only their own.
  const data = await getReceipt(user.companyId, id, await seenLocations());
  if (!data) notFound();

  return (
    <>
      <div className="noprint" style={{ marginBottom: "1rem" }}><PrintButton /></div>
      {print === "1" && <AutoPrint />}
      <ReceiptSlip data={data} />
    </>
  );
}

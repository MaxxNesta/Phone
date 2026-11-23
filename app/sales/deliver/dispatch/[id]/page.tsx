import { sql } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { deliveryRows } from "@/lib/delivery-worklist";
import { CarrierSlip } from "@/components/carrier-slip";
import { PrintButton } from "@/components/print-button";

export default async function DeliverySlip({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("sales.view");
  const { id } = await params;
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) notFound();
  const [row] = await deliveryRows(user.companyId, await seenLocations(), [id]);
  if (!row) notFound();
  const items = row.parcel ? undefined : await sql<{ lineId: string; item: string; qty: number; serials: string[] }[]>`
    select dl.id as "lineId", it.name as item, dl.base_qty::float as qty,
           array(select ss.serial_no from stock_movement sm
                   join stock_serial_issue si on si.stock_movement_id = sm.id join stock_serial ss on ss.id = si.serial_id
                  where sm.document_line_id = dl.id and sm.qty < 0 order by ss.serial_no) as serials
      from document_line dl join item it on it.id = dl.item_id where dl.document_id = ${id} order by dl.line_no`;
  return <div className="dispatch-paper"><div className="actions noprint">
    <Link href={`/documents/${row.invoiceId}`}>Back to invoice</Link><PrintButton /></div>
    <CarrierSlip row={row} items={items} standalone /></div>;
}

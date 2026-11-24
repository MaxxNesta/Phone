import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { getCompany } from "@/lib/queries";
import { sql } from "@/lib/db";
import { carriedOne } from "@/lib/delivery-slip";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Delivery slip" };

const shortDate = (v: unknown) =>
  v ? new Date(String(v)).toLocaleDateString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }) : "";

/**
 * The slip that travels with one parcel or delivery (0233): who it is for,
 * what is in it by IMEI, who carries it, and the one instruction that
 * matters at the door, printed largest. The trip sheet's paper, one stop.
 */
export default async function DeliverySlip({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("sales.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [company, c, seen] = await Promise.all([getCompany(), carriedOne(user.companyId, id), seenLocations()]);
  if (!company || !c || (seen && !seen.includes(c.warehouseId))) notFound();

  // What is in it: the parcel's lines, or the delivery's, each with the IMEIs that left on it.
  const items = c.parcel
    ? c.parcel.lines.map((l) => ({ key: l.lineId, item: l.item, qty: l.qty, serials: l.serials }))
    : (await sql`
        select dl.id as key, it.code || ' · ' || it.name as item, dl.base_qty::float as qty,
               coalesce((select json_agg(ss.serial_no order by ss.serial_no) from stock_movement sm
                          join stock_serial_issue si on si.stock_movement_id = sm.id join stock_serial ss on ss.id = si.serial_id
                         where sm.document_line_id = dl.id and sm.qty < 0), '[]'::json) as serials
          from document_line dl join item it on it.id = dl.item_id
         where dl.document_id = ${id} order by dl.line_no`) as unknown as { key: string; item: string; qty: number; serials: string[] }[];

  return (
    <>
      <div className="actions noprint" style={{ marginBottom: "0.5rem" }}>
        <Link href={c.invoiceId ? `/documents/${c.invoiceId}` : `/documents/${c.id}`} className="btn ghost tiny">
          <ArrowLeft size={13} aria-hidden="true" /> Back to {c.invoiceNo ?? c.no}
        </Link>
        <PrintButton />
      </div>

      <div className="sheetwrap">
        <div className="sheet">
          <div className="sheet-head">
            <div><div className="sheet-co">{company.name}</div>{company.name_my && <div className="sheet-co-my">{company.name_my}</div>}</div>
            <div style={{ textAlign: "right" }}>
              <div className="sheet-title">{c.kind === "COD" ? "Cash on delivery slip" : "Delivery slip"}</div>
              <div className="sheet-no">{c.no}</div>
            </div>
          </div>

          <section className="sheet-meta">
            <dl>
              <dt>Deliver to</dt><dd><strong>{c.customer}</strong></dd>
              <dt>Phone</dt><dd>{c.phone ?? "—"}</dd>
            </dl>
            <dl>
              <dt>Address</dt><dd>{c.address ?? "Ask the shop"}</dd>
              <dt>Invoice</dt><dd>{c.invoiceNo ?? "—"}</dd>
            </dl>
            <dl>
              <dt>Dispatched</dt><dd>{shortDate(c.date)}</dd>
              <dt>Carried by</dt><dd><strong>{c.carrier ?? "—"}</strong></dd>
            </dl>
          </section>

          <div className="slip-instruction">{c.instruction}</div>
          {c.parcel && c.state !== "REFUSED" && c.state !== "DONE" && (
            <p className="slip-note">Hand the phone over only when this is paid in full. A partial payment stays a deposit and the phone comes back.</p>
          )}

          <table className="sheet-table">
            <thead><tr><th>Item</th><th style={{ textAlign: "right", width: "16mm" }}>Qty</th><th>IMEI</th></tr></thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.key}>
                  <td>{l.item}</td>
                  <td style={{ textAlign: "right" }}>{l.qty}</td>
                  <td className="sheet-code sheet-wrap">{l.serials.length ? l.serials.join(", ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="sheet-sign">
            <div><div className="sheet-rule" />{c.carrier ? `Carried by ${c.carrier}` : "Carried by"}</div>
            <div><div className="sheet-rule" />{c.signer}</div>
          </div>
        </div>
      </div>
    </>
  );
}

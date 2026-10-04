import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { serialDetail } from "@/lib/phone";
import { money, shortDate, dateTime } from "@/lib/format";
import { SerialHoldForm } from "@/components/serial-hold-form";

export const metadata = { title: "Handset" };

const EVENT: Record<string, string> = {
  RECEIVED: "Received", SOLD: "Sold", CUSTOMER_RETURN: "Returned by customer",
  SUPPLIER_RETURN: "Returned to supplier", TRANSFER: "Transferred", RESTORED: "Sale voided — back in stock",
  WRITTEN_OFF: "Written off", HOLD: "Held", RELEASE: "Released",
};

export default async function Handset({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("inventory.view");
  const { id } = await params;
  const d = await serialDetail(user.companyId, id);
  if (!d) notFound();
  const { unit: u, events, holds } = d;
  const docLink = (docId: string | null, no: string | null) =>
    docId ? <Link href={`/documents/${docId}`}>{no}</Link> : "—";

  return (
    <>
      <div className="page-head">
        <span className="eyebrow"><Link href="/inventory/phones">Phone stock</Link></span>
        <h1 className="m">{u.imei}</h1>
        <p className="page-sub">{u.item_name} · {u.status.replace(/_/g, " ").toLowerCase()} · {u.location_name}</p>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="card-head"><h2>The unit</h2></div>
          <div className="card-body">
            <dl className="facts">
              <dt>Model</dt><dd>{u.model_name}{u.brand_name ? ` (${u.brand_name})` : ""}</dd>
              <dt>Variant</dt><dd>{[u.storage, u.colour].filter(Boolean).join(" / ") || u.item_name}</dd>
              <dt>IMEI 2</dt><dd className="m">{u.imei2 ?? "—"}</dd>
              <dt>Maker's serial</dt><dd className="m">{u.device_serial ?? "—"}</dd>
              {can(user, "cost.view") && <><dt>Cost</dt><dd className="num">{money(u.unit_cost)}</dd></>}
              <dt>Notes</dt><dd>{u.notes ?? "—"}</dd>
            </dl>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Where it came from, where it went</h2></div>
          <div className="card-body">
            <dl className="facts">
              <dt>Supplier</dt><dd>{u.supplier_name ?? "—"}</dd>
              <dt>Goods receipt</dt><dd>{docLink(u.received_document_id, u.received_on)} · {u.received_date ? shortDate(u.received_date) : ""}</dd>
              <dt>Supplier warranty</dt>
              <dd>{u.supplier_warranty_months ? `${u.supplier_warranty_months} months, to ${shortDate(u.supplier_warranty_expiry)}` : "—"}</dd>
              <dt>Sale</dt><dd>{docLink(u.out_document_id, u.out_doc_no)}{u.out_date ? ` · ${shortDate(u.out_date)}` : ""}</dd>
              <dt>Customer</dt><dd>{u.customer_name ?? "—"}</dd>
              <dt>Customer warranty</dt>
              <dd>{u.warranty_expiry ? `${u.warranty_months} months, to ${shortDate(u.warranty_expiry)}` : "—"}</dd>
            </dl>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>History</h2></div>
        <table>
          <thead><tr><th>When</th><th>What</th><th>Document</th><th>Party</th><th>From → to</th></tr></thead>
          <tbody>
            {events.map((e: any, i: number) => (
              <tr key={i}>
                <td>{dateTime(e.created_at)}</td>
                <td>{EVENT[e.event] ?? e.event}{e.status === "REVERSED" && " (voided)"}</td>
                <td>{docLink(e.document_id, e.doc_no)}</td>
                <td>{e.partner_name ?? "—"}</td>
                <td>{[e.from_location, e.to_location].filter(Boolean).join(" → ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {can(user, "inventory.manage") && (u.status === "IN_STOCK" || u.hold_kind) && (
        <SerialHoldForm serialId={u.serial_id} held={u.hold_kind} />
      )}
      {holds.length > 0 && (
        <p className="page-sub">
          Holds: {holds.map((h: any) => `${h.kind.toLowerCase()} ${shortDate(h.created_at)}${h.released_at ? `–${shortDate(h.released_at)}` : " (open)"}`).join(", ")}
        </p>
      )}
    </>
  );
}

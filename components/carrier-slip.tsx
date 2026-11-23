import Link from "next/link";
import type { DeliveryRow } from "@/lib/delivery-worklist";
import { money, shortDate } from "@/lib/format";

type SlipItem = { lineId: string; item: string; qty: number; serials: string[] };

export function CarrierSlip({ row, standalone = false, items }: { row: DeliveryRow; standalone?: boolean; items?: SlipItem[] }) {
  const p = row.parcel;
  const open = row.state === "OUT" || row.state === "NOT_HOME";
  return <article className="carrier-slip" aria-label="Delivery slip">
    <header><span>Delivery slip</span><strong>{row.no}</strong></header>
    <h2>{row.customer}</h2>
    <p>{[row.address, row.phone].filter(Boolean).join(" · ") || "Contact the shop for delivery details."}</p>
    <dl><div><dt>Invoice</dt><dd>{row.invoiceNo}</dd></div>
      <div><dt>Dispatched</dt><dd>{shortDate(row.date)}</dd></div>
      <div><dt>Delivered by</dt><dd>{row.carrier || "Unassigned"}</dd></div></dl>
    {(p?.lines ?? items)?.map(l => <p key={l.lineId}>{l.item} × {l.qty}{l.serials.length > 0 && <small>{l.serials.join(", ")}</small>}</p>)}
    <section><h3>{row.instruction}</h3>
      {open && p && !p.sharedAmount && <dl><div><dt>Goods</dt><dd>{money(p.goods)}</dd></div>
        {p.extras > 0 && <div><dt>Delivery &amp; services</dt><dd>{money(p.extras)}</dd></div>}
        {p.availableDeposit > 0 && <div><dt>Deposit applied at handover</dt><dd>−{money(Math.min(p.due, p.availableDeposit))}</dd></div>}</dl>}
      {open && <p>{p ? "Confirm payment before releasing the goods." : "Ask the recipient to acknowledge delivery."}</p>}
    </section>
    {p?.retryOn && row.state === "NOT_HOME" && <p>Retry on {shortDate(p.retryOn)}</p>}
    {standalone ? <footer>Received by ____________________</footer> :
      <Link href={`/sales/deliver/dispatch/${row.id}`} className="dispatch-button">View printable slip</Link>}
  </article>;
}

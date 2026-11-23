import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { deliveryRows } from "@/lib/delivery-worklist";
import { waitingCodInvoices } from "@/lib/cod";
import { getPendingDeliveries } from "@/lib/queries";
import { CarrierSlip } from "@/components/carrier-slip";

const tabs = { OUT: "Out for delivery", WAIT: "Awaiting dispatch", NOT_HOME: "Retry", REFUSED: "Returning" } as const;
export default async function DispatchQueue({ searchParams }: { searchParams: Promise<{ tab?: string; parcel?: string }> }) {
  const user = await requirePermission("sales.view");
  const { tab, parcel } = await searchParams;
  const active = tab && Object.hasOwn(tabs, tab) ? tab as keyof typeof tabs : "OUT";
  const locations = await seenLocations();
  const rows = active === "WAIT" ? [] : (await deliveryRows(user.companyId, locations)).filter(r => r.state === active);
  const selected = rows.find(r => r.id === parcel) ?? rows[0];
  const [cod, pending] = active === "WAIT" ? await Promise.all([waitingCodInvoices(user.companyId, locations),
    getPendingDeliveries(user.companyId)]) : [[], []];
  const waiting = [...cod.map(d => ({ id: String(d.id), no: String(d.doc_no), name: String(d.partner_name), terms: "COD" })),
    ...pending.filter(d => d.payment_type === "CREDIT" && (!locations || locations.includes(d.location_id)))
      .map(d => ({ id: d.id, no: d.doc_no, name: d.partner_name, terms: "Credit" }))];
  return <div className="dispatch-queue"><Link href="/sales/deliver">Sales / Deliveries</Link><h1>Dispatch worklist</h1>
    <nav aria-label="Parcel status">{Object.entries(tabs).map(([key,label]) =>
      <Link key={key} href={`?tab=${key}`} aria-current={active === key ? "page" : undefined}>{label}</Link>)}</nav>
    {active === "WAIT" ? <section>{waiting.map(r => <Link className="dispatch-entry" key={r.id} href={`/documents/${r.id}`}>
      <strong>{r.name}</strong><span>{r.no} · {r.terms}</span><span>Open invoice →</span></Link>)}
      {!waiting.length && <p>No invoices waiting for dispatch.</p>}</section> :
    selected ? <div className="dispatch-split"><section aria-label="Parcels">{rows.map(r =>
      <Link className="dispatch-entry" key={r.id} href={`?tab=${active}&parcel=${r.id}`} aria-current={r.id === selected.id ? "true" : undefined}>
        <strong>{r.customer}</strong><span>{r.no} · {r.carrier || "Unassigned"}</span><span>{r.instruction}</span></Link>)}</section>
      <aside><CarrierSlip row={selected} /><Link className="dispatch-invoice" href={`/documents/${selected.invoiceId}`}>Open invoice and actions →</Link></aside></div> :
    <p>No parcels in this stage.</p>}</div>;
}

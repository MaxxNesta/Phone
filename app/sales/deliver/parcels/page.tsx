import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { getPendingDeliveries } from "@/lib/queries";
import { codAwaitingDispatch } from "@/lib/cod";
import { carriedOut, type Carried } from "@/lib/delivery-slip";
import { ErpPageHead, ErpSection } from "@/components/erp-worklist";
import { DataTable, type DataRow } from "@/components/data-table";

export const metadata = { title: "Parcels out" };

const TABS = [
  ["out", "Out for delivery"],
  ["waiting", "Waiting to dispatch"],
  ["retry", "Retry"],
  ["returning", "Returning"],
] as const;
type Tab = (typeof TABS)[number][0];

const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
const STATE: Record<Carried["state"], [string, string]> = {
  OUT: ["Out for delivery", "info"], NOT_HOME: ["Not home · retry", "warn"], REFUSED: ["Refused · coming back", "warn"], DONE: ["Done", "ok"],
};

/**
 * Every parcel and delivery not yet in the customer's hands or back on the
 * shelf (0233), with what the carrier is to do at the door, and the
 * invoices still waiting to go out. Each row opens the invoice, where the
 * actions are, and the slip to print.
 */
export default async function ParcelsOut({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePermission("sales.view");
  const asked = (await searchParams).tab;
  const tab: Tab = TABS.some(([k]) => k === asked) ? asked as Tab : "out";
  const seen = await seenLocations();
  const mine = (loc: string | null) => !seen || (!!loc && seen.includes(loc));
  const [carried, codWaiting, pending] = await Promise.all([
    carriedOut(user.companyId), codAwaitingDispatch(user.companyId), getPendingDeliveries(user.companyId),
  ]);
  const out = carried.filter((c) => mine(c.warehouseId));
  const byTab = {
    out: out.filter((c) => c.state === "OUT"),
    retry: out.filter((c) => c.state === "NOT_HOME"),
    returning: out.filter((c) => c.state === "REFUSED"),
  };
  const waiting = [
    ...codWaiting.filter((w) => mine(w.warehouseId)).map((w) => ({ id: w.id, no: w.no, date: w.date, customer: w.customer, qty: w.qty, terms: "Cash on delivery", carrier: w.carrier })),
    ...(pending as { id: string; doc_no: string; doc_date: string; partner_name: string; total_qty: number; location_id: string; ar_on_handover: boolean }[])
      .filter((p) => !p.ar_on_handover && mine(p.location_id))
      .map((p) => ({ id: p.id, no: p.doc_no, date: String(p.doc_date), customer: p.partner_name, qty: p.total_qty, terms: "Credit", carrier: null })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const count: Record<Tab, number> = { out: byTab.out.length, waiting: waiting.length, retry: byTab.retry.length, returning: byTab.returning.length };

  const carriedRows: DataRow[] = tab === "waiting" ? [] : byTab[tab].map((c) => ({
    key: c.id,
    searchText: [c.no, c.invoiceNo, c.customer, c.carrier, c.parcel?.lines.flatMap((l) => l.serials).join(" ")].filter(Boolean).join(" "),
    sort: { date: c.date, customer: c.customer, carrier: c.carrier ?? "" },
    node: (
      <tr>
        <td className="code">{c.no}<div className="subline">{day(c.date)}</div></td>
        <td>{c.customer}{c.phone && <div className="subline">{c.phone}</div>}</td>
        <td className="code">{c.invoiceId ? <Link href={`/documents/${c.invoiceId}`} style={{ color: "var(--link)" }}>{c.invoiceNo}</Link> : "—"}</td>
        <td>{c.carrier ?? <span className="subline">Not assigned</span>}</td>
        <td><span className={`pill ${STATE[c.state][1]}`}>{STATE[c.state][0]}</span>
          {c.parcel?.lastReason && <div className="subline">{c.parcel.lastReason}{c.parcel.retryOn ? ` · retry ${c.parcel.retryOn}` : ""}</div>}</td>
        <td className="wrap"><strong>{c.instruction}</strong></td>
        <td className="tight">
          <Link href={`/sales/deliver/slip/${c.id}`} className="btn tiny ghost">Slip</Link>{" "}
          <Link href={`/documents/${c.invoiceId ?? c.id}`} className="btn tiny">Open</Link>
        </td>
      </tr>
    ),
  }));
  const waitingRows: DataRow[] = waiting.map((w) => ({
    key: w.id,
    searchText: [w.no, w.customer, w.terms, w.carrier].filter(Boolean).join(" "),
    sort: { date: w.date, customer: w.customer },
    node: (
      <tr>
        <td className="code"><Link href={`/documents/${w.id}`} style={{ color: "var(--link)" }}>{w.no}</Link><div className="subline">{day(w.date)}</div></td>
        <td>{w.customer}</td>
        <td><span className="pill">{w.terms}</span></td>
        <td className="r">{w.qty}</td>
        <td>{w.carrier ?? <span className="subline">Choose at dispatch</span>}</td>
        <td className="tight"><Link href={w.terms === "Credit" ? "/sales/deliver?only=undelivered" : `/documents/${w.id}`} className="btn tiny">Dispatch</Link></td>
      </tr>
    ),
  }));

  return (
    <div className="erp-page">
      <ErpPageHead eyebrow="Delivery" title="Parcels out"
        lead="What is with a driver or courier, what each is to collect at the door, and what is still waiting to go."
        action={<Link href="/sales/deliver" className="erp-hbtn">Deliveries</Link>} />
      <nav className="vtabs pay-tabs" aria-label="Parcels">
        {TABS.map(([k, label]) => (
          <Link key={k} href={k === "out" ? "/sales/deliver/parcels" : `/sales/deliver/parcels?tab=${k}`}
            aria-current={k === tab ? "page" : undefined} className={k === tab ? "on" : undefined}>
            {label}{count[k] > 0 ? ` · ${count[k]}` : ""}
          </Link>
        ))}
      </nav>
      {tab === "waiting" ? (
        <ErpSection title="Waiting to dispatch" count={waiting.length} lead="Invoiced with the goods still in the warehouse. Cash on delivery is dispatched from its invoice.">
          <DataTable rows={waitingRows} emptyLabel="Nothing is waiting to go out." searchPlaceholder="Search invoices, customers…"
            defaultSort={{ key: "date", dir: "asc" }}
            columns={[{ key: "date", label: "Invoice", sortable: true }, { key: "customer", label: "Customer", sortable: true },
              { key: "terms", label: "Payment" }, { key: "qty", label: "To go", align: "r" }, { key: "carrier", label: "Carried by" }, { key: "a", label: "" }]} />
        </ErpSection>
      ) : (
        <ErpSection title={TABS.find(([k]) => k === tab)![1]} count={count[tab]}
          lead={tab === "returning" ? "Refused at the door. Each comes back into stock only when the same IMEIs are scanned in at the shop."
            : tab === "retry" ? "Nobody was home. Each stays with its carrier for another try, or comes back to the shop."
            : "With a driver or courier now. Print the slip; the instruction is what to do at the door."}>
          <DataTable rows={carriedRows} emptyLabel="Nothing here." searchPlaceholder="Search parcels, customers, IMEIs…"
            defaultSort={{ key: "date", dir: "asc" }}
            columns={[{ key: "date", label: "Parcel", sortable: true }, { key: "customer", label: "Customer", sortable: true },
              { key: "invoice", label: "Invoice" }, { key: "carrier", label: "Carried by", sortable: true }, { key: "state", label: "Status" },
              { key: "do", label: "At the door" }, { key: "a", label: "" }]} />
        </ErpSection>
      )}
    </div>
  );
}

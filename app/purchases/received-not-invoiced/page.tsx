import Link from "next/link";
import { FileText, Clock, Truck } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { money, shortDate } from "@/lib/format";
import { unbilledReceipts, unbilledBySupplier } from "@/lib/unbilled";
import { Stat } from "@/components/stat";

export const metadata = { title: "Received not invoiced" };

/**
 * Goods in, bill not yet entered. Not owed in the books until the supplier's
 * invoice is posted — the value waits in GR/IR clearing — but owed all the
 * same, so it is listed per supplier with the receipt each amount came from.
 */
export default async function ReceivedNotInvoiced() {
  const user = await requirePermission("purchase.view");
  const rows = await unbilledReceipts(user.companyId);
  const suppliers = unbilledBySupplier(rows);
  const total = rows.reduce((s, r) => s + r.value, 0);
  const oldest = rows.reduce((m, r) => Math.max(m, r.days), 0);

  return (
    <>
      <div className="page-head hero">
        <span className="eyebrow">Purchases</span>
        <h1>Received not invoiced</h1>
        <p className="page-sub">Goods that arrived with no supplier invoice entered yet. Each becomes a payable when its bill is posted.</p>
      </div>

      <div className="stats">
        <Stat icon={<FileText size={20} />} label="Awaiting invoice" value={`${money(total)} MMK`}
          note={`${rows.length} receipt${rows.length === 1 ? "" : "s"}`} />
        <Stat icon={<Truck size={20} />} tone="slate" label="Suppliers" value={suppliers.length} note="with goods unbilled" />
        <Stat icon={<Clock size={20} />} tone="amber" label="Oldest" value={`${oldest} days`}
          note={oldest > 30 ? "ask the supplier for the bill" : "since the goods arrived"} noteTone={oldest > 30 ? "warn" : undefined} />
      </div>

      <div className="card">
        <div className="card-head"><h2>By supplier</h2><span className="page-sub">Valued at what each receipt booked</span></div>
        {rows.length === 0 ? (
          <div className="empty">Every receipt has its supplier invoice.</div>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Receipt</th><th>Received</th><th className="r">Waiting</th><th className="r">Lines</th>
                  <th className="r">Value (MMK)</th><th /></tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <SupplierRows key={s.partnerId} supplier={s}
                    receipts={rows.filter((r) => r.partnerId === s.partnerId)} />
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={4}>Total awaiting invoice</td><td className="r"><strong>{money(total)}</strong></td><td /></tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function SupplierRows({ supplier, receipts }: {
  supplier: ReturnType<typeof unbilledBySupplier>[number];
  receipts: Awaited<ReturnType<typeof unbilledReceipts>>;
}) {
  return (
    <>
      <tr className="grouprow">
        <td colSpan={4}>
          <strong>{supplier.partnerName}</strong>
          <span className="page-sub"> · {supplier.partnerCode} · {supplier.receipts} receipt{supplier.receipts === 1 ? "" : "s"}</span>
        </td>
        <td className="r"><strong>{money(supplier.value)}</strong></td>
        <td />
      </tr>
      {receipts.map((r) => (
        <tr key={r.id}>
          <td className="m"><Link href={`/documents/${r.id}`}>{r.docNo}</Link></td>
          <td>{shortDate(r.docDate)}</td>
          <td className="r" style={{ color: r.days > 30 ? "var(--warn)" : undefined }}>{r.days} day{r.days === 1 ? "" : "s"}</td>
          <td className="r">{r.lines}</td>
          <td className="r">{money(r.value)}</td>
          <td className="tight">
            <Link className="btn ghost tiny" href={`/purchases/new?goods_receipt_id=${r.id}`}>Create invoice</Link>
          </td>
        </tr>
      ))}
    </>
  );
}

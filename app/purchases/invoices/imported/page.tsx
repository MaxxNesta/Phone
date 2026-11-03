import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { HelpHint } from "@/components/help-hint";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { listHistoricalPurchases } from "@/lib/historical-purchases";
import { money, shortDate } from "@/lib/format";

export const metadata = { title: "Imported purchase invoices" };

/** Invoices brought over from the old system: a record only, searchable by old ID, new number, supplier or IMEI. */
export default async function ImportedPurchaseInvoices({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const q = ((await searchParams).q ?? "").trim();
  const rows = await listHistoricalPurchases(user.companyId, q);
  return (
    <>
      <Breadcrumbs trail={[{ label: "Purchase invoices", href: "/purchases/invoices" }, { label: "Imported" }]} />
      <div className="page-head">
        <span className="eyebrow">Purchases</span>
        <h1>Imported invoices</h1>
        <HelpHint>Purchase invoices from the old system — a record only. No stock, journal or payable.</HelpHint>
      </div>
      <div className="actions">
        <Link href="/purchases/invoices/import" className="btn">Import invoices</Link>
      </div>
      <form className="pimp-search">
        <input type="search" name="q" defaultValue={q} placeholder="Old ID, new number, supplier or IMEI" aria-label="Search imported invoices" />
      </form>
      {rows.length === 0 ? (
        <div className="card"><div className="empty">{q ? "Nothing matches." : "Nothing imported yet."}</div></div>
      ) : (
        <div className="pimp-list">
          {rows.map((h) => (
            <details key={h.id} className="pimp-inv" open={rows.length === 1}>
              <summary className="pimp-head">
                <span className="pimp-title"><span className="code">{h.invoice_no}</span> · {h.old_ref} · {h.supplier} · {shortDate(h.doc_date)}</span>
                <span className="subline">{h.location}</span>
                <span className="pimp-total">{money(h.net_total)}</span>
              </summary>
              <div className="pimp-body">
                {h.remark && <p className="page-sub">{h.remark}</p>}
                <div className="tablewrap">
                  <table className="pimp-lines">
                    <thead><tr><th>#</th><th>Code</th><th>Item</th><th className="r">Qty</th><th className="r">Unit price</th><th className="r">Amount</th></tr></thead>
                    <tbody>
                      {(h.lines ?? []).map((l) => (
                        <tr key={l.line_no}>
                          <td>{l.line_no}</td><td className="code">{l.item_code}</td>
                          <td>{l.description}{l.serials.length > 0 && <div className="pimp-chips">{l.serials.map((s) => <span key={s} className="code">{s}</span>)}</div>}</td>
                          <td className="r">{money(l.qty)}</td><td className="r">{money(l.unit_price)}</td><td className="r">{money(l.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="subline">{h.payment ?? ""} · batch {h.batch_ref}</p>
              </div>
            </details>
          ))}
        </div>
      )}
    </>
  );
}

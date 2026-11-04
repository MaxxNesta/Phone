import Link from "next/link";
import { getCompany } from "@/lib/queries";
import { money, shortDate, sql } from "@/lib/db";
import { getSupplierLedger } from "@/lib/supplier-ledger";
import { HelpHint } from "@/components/help-hint";
import { ExportCsvButton } from "@/components/export-csv";

export const metadata = { title: "Supplier ledger" };

/**
 * Each supplier's purchases and payments with a running balance, as the old
 * system printed them. A payment made ahead of the bill is a supplier advance:
 * it shows on the day it was paid and the balance goes below zero until the
 * bill arrives; applying it moves nothing here.
 */
export default async function SupplierLedgerPage({ searchParams }: { searchParams: Promise<{ supplier?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;
  const [suppliers, ledger] = await Promise.all([
    sql`select id, code, name from business_partner where company_id = ${company.id} and is_supplier order by code`,
    getSupplierLedger(company.id, { partnerId: sp.supplier || null, from: sp.from || null, to: sp.to || null }),
  ]);
  const neg = (n: number) => (n < 0 ? { color: "var(--bad)" } : undefined);
  const csv: (string | number)[][] = [["Supplier code", "Supplier", "Date", "Type", "Document", "Old ref", "Description", "Purchase", "Payment", "Balance"]];
  for (const g of ledger) {
    csv.push([g.code, g.name, "", "Opening", "", "", "", "", "", g.opening]);
    for (const r of g.rows) csv.push([g.code, g.name, r.date, r.kind, r.docNo ?? r.entryNo, r.oldRef ?? "", r.description, r.purchase || "", r.payment || "", r.balance]);
    csv.push([g.code, g.name, "", "Total", "", "", "", g.purchases, g.payments, g.closing]);
  }

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">Purchases</span>
        <h1>Supplier ledger</h1>
        <HelpHint>
          Purchases and payments per supplier, with the running balance. A payment made before the bill is a supplier
          advance (Purchase Advance): it shows on the day it was paid, and the balance stays below zero until the bill it
          is applied to arrives.
        </HelpHint>
      </div>
      <div className="vtabs pay-tabs" role="tablist" aria-label="Payables">
        <Link href="/payables" role="tab" aria-selected={false}>Suppliers</Link>
        <Link href="/payables/ledger" role="tab" aria-selected className="on">Supplier ledger</Link>
      </div>

      <form className="sl-filter card">
        <div className="field">
          <label htmlFor="supplier">Supplier</label>
          <select id="supplier" name="supplier" defaultValue={sp.supplier ?? ""}>
            <option value="">All suppliers</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="from">From</label><input id="from" name="from" type="date" defaultValue={sp.from ?? ""} /></div>
        <div className="field"><label htmlFor="to">To</label><input id="to" name="to" type="date" defaultValue={sp.to ?? ""} /></div>
        <div className="actions">
          <button type="submit">Show</button>
          <ExportCsvButton name="supplier-ledger" rows={csv} />
        </div>
      </form>

      {ledger.length === 0 ? (
        <div className="card"><div className="empty">Nothing in this period.</div></div>
      ) : (
        <div className="card">
          <div className="tablewrap">
            <table className="sl-table">
              <thead>
                <tr><th>Date</th><th>Type</th><th>Document</th><th>Old ref</th><th>Description</th><th className="r">Purchase</th><th className="r">Payment</th><th className="r">Balance</th></tr>
              </thead>
              {ledger.map((g) => (
                <tbody key={g.partnerId}>
                  <tr className="sl-head"><td className="code">{g.code}</td><td colSpan={7}><strong>{g.name}</strong></td></tr>
                  <tr className="sl-open"><td /><td><strong>Opening</strong></td><td colSpan={5} /><td className="r" style={neg(g.opening)}>{money(g.opening)}</td></tr>
                  {g.rows.map((r) => (
                    <tr key={`${r.entryNo}-${r.partnerId}`}>
                      <td className="code">{shortDate(r.date)}</td>
                      <td>{r.kind}</td>
                      <td className="code narrow">{r.docId ? <Link href={`/documents/${r.docId}`}>{r.docNo}</Link> : r.entryNo}</td>
                      <td className="code narrow">{r.oldRef ?? ""}</td>
                      <td className="sl-desc" title={r.description}>{r.description}</td>
                      <td className="r">{r.purchase ? money(r.purchase) : ""}</td>
                      <td className="r">{r.payment ? money(r.payment) : ""}</td>
                      <td className="r" style={neg(r.balance)}>{money(r.balance)}</td>
                    </tr>
                  ))}
                  <tr className="sl-total">
                    <td colSpan={5} className="r"><strong>Total {g.name}</strong></td>
                    <td className="r"><strong>{money(g.purchases)}</strong></td>
                    <td className="r"><strong>{money(g.payments)}</strong></td>
                    <td className="r" style={neg(g.closing)}><strong>{money(g.closing)}</strong></td>
                  </tr>
                </tbody>
              ))}
            </table>
          </div>
        </div>
      )}
    </>
  );
}

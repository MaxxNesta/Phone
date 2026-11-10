import Link from "next/link";
import { money, shortDate } from "@/lib/format";
import type { AdvanceRow, OpenBill } from "@/lib/queries";

/**
 * Who has money on account, and what it could settle. One line per supplier
 * or customer: every advance taken, how much has gone onto bills, what is
 * left, and what they still owe — and when both are above zero, the button
 * that puts the one against the other.
 */
export function AdvanceSummary({ side, advances, bills }: {
  side: "CUSTOMER" | "SUPPLIER"; advances: AdvanceRow[]; bills: Map<string, OpenBill[]>;
}) {
  const sales = side === "CUSTOMER";
  const by = new Map<string, { id: string; code: string; name: string; count: number; taken: number; applied: number; left: number; last: string }>();
  for (const a of advances) {
    const g = by.get(a.partner_id) ?? { id: a.partner_id, code: a.partner_code, name: a.partner_name, count: 0, taken: 0, applied: 0, left: 0, last: a.doc_date };
    g.count++; g.taken += a.taken; g.applied += a.applied; g.left += a.remaining;
    if (a.doc_date > g.last) g.last = a.doc_date;
    by.set(a.partner_id, g);
  }
  const rows = [...by.values()].sort((a, b) => b.left - a.left || b.taken - a.taken);
  if (rows.length === 0) return null;
  const owed = (id: string) => (bills.get(id) ?? []).reduce((t, b) => t + b.outstanding, 0);
  const base = sales ? "/receivables/receive" : "/payables/pay";
  const tot = rows.reduce((t, r) => ({ taken: t.taken + r.taken, applied: t.applied + r.applied, left: t.left + r.left }), { taken: 0, applied: 0, left: 0 });
  return (
    <div className="card adv-sum">
      <div className="card-head">
        <h2>By {sales ? "customer" : "supplier"}</h2>
        <span className="page-sub">{rows.length} with advances · {money(tot.left)} MMK left on account</span>
      </div>
      <div className="tablewrap">
        <table className="bal-bills adv-sum-table">
          <thead>
            <tr>
              <th>{sales ? "Customer" : "Supplier"}</th><th className="r">Advances</th><th>Last</th>
              <th className="r">{sales ? "Received" : "Paid"} ahead</th><th className="r">Applied</th>
              <th className="r">Left on account</th><th className="r">Open {sales ? "invoices" : "bills"}</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const due = owed(r.id);
              const usable = Math.min(r.left, due);
              return (
                <tr key={r.id}>
                  <td><strong>{r.name}</strong><div className="subline">{r.code}</div></td>
                  <td className="r">{r.count}</td>
                  <td className="m">{shortDate(r.last)}</td>
                  <td className="r">{money(r.taken)}</td>
                  <td className="r">{r.applied > 0.005 ? money(r.applied) : "—"}</td>
                  <td className="r">{r.left > 0.005 ? <strong className="bal-adv">{money(r.left)}</strong> : "0"}</td>
                  <td className="r">{due > 0.005 ? money(due) : "—"}</td>
                  <td className="tight">
                    {usable > 0.005
                      ? <Link href={`${base}?partner=${r.id}&advance=1`} className="btn tiny">Use {money(usable)} on {sales ? "invoices" : "bills"}</Link>
                      : r.left > 0.005 ? <span className="page-sub">Waiting for a {sales ? "invoice" : "bill"}</span> : <span className="page-sub">Fully applied</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 1 && (
            <tfoot><tr><td colSpan={3}>Total</td><td className="r">{money(tot.taken)}</td><td className="r">{money(tot.applied)}</td><td className="r">{money(tot.left)}</td><td colSpan={2} /></tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

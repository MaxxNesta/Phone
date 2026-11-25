import { money } from "@/lib/db";
import type { Side, SummaryRow } from "@/lib/partner-ledger";
import { ExportCsvButton } from "./export-csv";
import { AutoSubmit } from "./auto-submit";

type Sum = Omit<SummaryRow, "partnerId" | "code" | "name" | "township">;
const KEYS = ["opening", "sale", "returned", "discount", "payment", "other", "prepaid", "balance"] as const;
const add = (rows: Sum[]): Sum => Object.fromEntries(KEYS.map((k) => [k, rows.reduce((t, r) => t + r[k], 0)])) as Sum;

/**
 * The Outstanding Summary, as the old report printed it (2026-11-25): a line
 * a partner, customers under their township with the township's total, and
 * the whole at the foot. Other shows only when something sits in it.
 */
export function OutstandingSummaryView({ side, rows, townships, branches = [], sp, base }: {
  side: Side; rows: SummaryRow[];
  townships?: string[];
  branches?: { id: string; code: string; name: string }[];
  sp: { township?: string; from?: string; to?: string; branch?: string };
  base: string;
}) {
  const cust = side === "CUSTOMER";
  const showOther = rows.some((r) => Math.abs(r.other) >= 0.005);
  const cols: [keyof Sum, string][] = [
    ["opening", "Opening"], ["sale", cust ? "Sale" : "Purchase"], ["returned", "Return"], ["discount", "Disc + FOC"],
    ["payment", "Payment"], ...(showOther ? [["other", "Other"] as [keyof Sum, string]] : []),
    ["prepaid", "Prepaid"], ["balance", "Balance"],
  ];
  const groups = cust
    ? [...new Set(rows.map((r) => r.township ?? ""))].map((t) => ({ township: t, rows: rows.filter((r) => (r.township ?? "") === t) }))
    : [{ township: null as string | null, rows }];
  const all = add(rows);

  const csv: (string | number)[][] = [["Sr", ...(cust ? ["Township"] : []), "Code", cust ? "Customer" : "Supplier", ...cols.map(([, l]) => l)]];
  let n = 0;
  for (const g of groups) {
    for (const r of g.rows) csv.push([++n, ...(cust ? [g.township || "No township"] : []), r.code, r.name, ...cols.map(([k]) => r[k])]);
    if (cust) csv.push(["", g.township ? `${g.township} total` : "No township total", "", "", ...cols.map(([k]) => add(g.rows)[k])]);
  }
  csv.push(["", ...(cust ? [""] : []), "", "Total", ...cols.map(([k]) => all[k])]);

  const cells = (s: Sum, strong = false) => cols.map(([k]) => (
    <td key={k} className={`r${k === "balance" && s.balance > 0.005 ? " os-owed" : ""}${k === "prepaid" && s.prepaid > 0.005 ? " os-pre" : ""}`}>
      {strong ? <strong>{money(s[k])}</strong> : money(s[k])}
    </td>
  ));
  let sr = 0;

  return (
    <>
      <form className="sl-filter card" action={base}>
        <AutoSubmit />
        {branches.length > 1 && (
          <div className="field">
            <label htmlFor="branch">Branch</label>
            <select id="branch" name="branch" defaultValue={sp.branch ?? ""}>
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        {cust && townships && (
          <div className="field">
            <label htmlFor="township">Township</label>
            <select id="township" name="township" defaultValue={sp.township ?? ""}>
              <option value="">All townships</option>
              {townships.map((t) => <option key={t} value={t}>{t}</option>)}
              <option value="-">No township</option>
            </select>
          </div>
        )}
        <div className="field"><label htmlFor="from">From</label><input id="from" name="from" type="date" defaultValue={sp.from ?? ""} /></div>
        <div className="field"><label htmlFor="to">To</label><input id="to" name="to" type="date" defaultValue={sp.to ?? ""} /></div>
        <div className="actions">
          <ExportCsvButton name={cust ? "customer-outstanding-summary" : "supplier-outstanding-summary"} rows={csv} />
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="card"><div className="empty">Nothing in this period.</div></div>
      ) : (
        <div className="card">
          <div className="tablewrap">
            <table className="sl-table os-table">
              <thead>
                <tr><th className="narrow">Sr.</th><th>Code</th><th>{cust ? "Customer" : "Supplier"}</th>
                  {cols.map(([k, l]) => <th key={k} className="r">{l}</th>)}</tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.township ?? "all"}>
                  {cust && <tr className="sl-town"><td colSpan={3 + cols.length}>Township: <strong>{g.township || "No township"}</strong></td></tr>}
                  {g.rows.map((r) => (
                    <tr key={r.partnerId}>
                      <td className="narrow page-sub">{++sr}</td>
                      <td className="code">{r.code}</td>
                      <td className="wrap">{r.name}</td>
                      {cells(r)}
                    </tr>
                  ))}
                  {cust && (
                    <tr className="sl-towntotal">
                      <td colSpan={3}><strong>{g.township || "No township"} total</strong></td>
                      {cells(add(g.rows), true)}
                    </tr>
                  )}
                </tbody>
              ))}
              <tfoot>
                <tr className="os-grand"><td colSpan={3}><strong>Total</strong></td>{cells(all, true)}</tr>
              </tfoot>
            </table>
          </div>
          <p className="hint os-note">
            Opening + {cust ? "sale" : "purchase"} − return − discount − payment{showOther ? " + other" : ""} = balance − prepaid.
            Prepaid is money {cust ? "received" : "paid"} ahead and not yet set against {cust ? "an invoice" : "a bill"}; balance is what {cust ? "invoices" : "bills"} still owe.
          </p>
        </div>
      )}
    </>
  );
}

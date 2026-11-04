import Link from "next/link";
import { money, shortDate } from "@/lib/db";
import type { PartnerLedger, Side } from "@/lib/partner-ledger";
import { ExportCsvButton } from "./export-csv";
import { AutoSubmit } from "./auto-submit";

/**
 * The supplier or customer ledger, as the old reports printed it: a band per
 * partner — and, for customers, per township above them, with the township's
 * total — then opening, each document with the running balance, and the total.
 */
export function PartnerLedgerView({ side, ledger, partners, townships, sp, base }: {
  side: Side; ledger: PartnerLedger;
  partners: { id: string; code: string; name: string }[];
  townships?: string[];
  sp: { partner?: string; township?: string; from?: string; to?: string };
  base: string;
}) {
  const cust = side === "CUSTOMER";
  const [chargeLabel, settleLabel] = cust ? ["Sales", "Payment"] : ["Purchase", "Payment"];
  const neg = (n: number) => (n < 0 ? { color: "var(--bad)" } : undefined);
  // Customers fall under their township, as the old report grouped them.
  const groups = cust
    ? [...new Set(ledger.map((g) => g.township ?? ""))].map((t) => ({ township: t, partners: ledger.filter((g) => (g.township ?? "") === t) }))
    : [{ township: null as string | null, partners: ledger }];

  const csv: (string | number)[][] = [[...(cust ? ["Township"] : []), "Code", cust ? "Customer" : "Supplier", "Date", "Type", "Document", "Old ref", "Description", chargeLabel, settleLabel, "Balance"]];
  for (const grp of groups) for (const g of grp.partners) {
    const lead = [...(cust ? [g.township ?? "No township"] : []), g.code, g.name];
    csv.push([...lead, "", "Opening", "", "", "", "", "", g.opening]);
    for (const r of g.rows) csv.push([...lead, r.date, r.kind, r.docNo ?? r.entryNo, r.oldRef ?? "", r.description, r.charge || "", r.settle || "", r.balance]);
    csv.push([...lead, "", "Total", "", "", "", g.charges, g.settles, g.closing]);
  }

  return (
    <>
      <form className="sl-filter card" action={base}>
        <AutoSubmit />
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
        <div className="field">
          <label htmlFor="partner">{cust ? "Customer" : "Supplier"}</label>
          <select id="partner" name="partner" defaultValue={sp.partner ?? ""}>
            <option value="">{cust ? "All customers" : "All suppliers"}</option>
            {partners.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="from">From</label><input id="from" name="from" type="date" defaultValue={sp.from ?? ""} /></div>
        <div className="field"><label htmlFor="to">To</label><input id="to" name="to" type="date" defaultValue={sp.to ?? ""} /></div>
        <div className="actions">
          <ExportCsvButton name={cust ? "customer-ledger" : "supplier-ledger"} rows={csv} />
        </div>
      </form>

      {ledger.length === 0 ? (
        <div className="card"><div className="empty">Nothing in this period.</div></div>
      ) : (
        <div className="card">
          <div className="tablewrap">
            <table className="sl-table">
              <thead>
                <tr><th>Date</th><th>Type</th><th>Document</th><th>Old ref</th><th>Description</th>
                  <th className="r">{chargeLabel}</th><th className="r">{settleLabel}</th><th className="r">Balance</th></tr>
              </thead>
              {groups.map((grp) => {
                const t = grp.partners.reduce((a, g) => ({ c: a.c + g.charges, s: a.s + g.settles, b: a.b + g.closing }), { c: 0, s: 0, b: 0 });
                return (
                  <tbody key={grp.township ?? "all"}>
                    {cust && <tr className="sl-town"><td colSpan={8}>Township: <strong>{grp.township || "No township"}</strong></td></tr>}
                    {grp.partners.map((g) => [
                      <tr key={`${g.partnerId}-h`} className="sl-head"><td className="code">{g.code}</td><td colSpan={7}><strong>{g.name}</strong></td></tr>,
                      <tr key={`${g.partnerId}-o`} className="sl-open"><td /><td><strong>Opening</strong></td><td colSpan={5} /><td className="r" style={neg(g.opening)}>{money(g.opening)}</td></tr>,
                      ...g.rows.map((r) => (
                        <tr key={`${r.entryNo}-${r.partnerId}`}>
                          <td className="code">{shortDate(r.date)}</td>
                          <td>{r.kind}</td>
                          <td className="code narrow">{r.docId ? <Link href={`/documents/${r.docId}`}>{r.docNo}</Link> : r.entryNo}</td>
                          <td className="code narrow">{r.oldRef ?? ""}</td>
                          <td className="sl-desc" title={r.description}>{r.description}</td>
                          <td className="r">{r.charge ? money(r.charge) : ""}</td>
                          <td className="r">{r.settle ? money(r.settle) : ""}</td>
                          <td className="r" style={neg(r.balance)}>{money(r.balance)}</td>
                        </tr>
                      )),
                      <tr key={`${g.partnerId}-t`} className="sl-total">
                        <td colSpan={5} className="r"><strong>Total {g.name}</strong></td>
                        <td className="r"><strong>{money(g.charges)}</strong></td>
                        <td className="r"><strong>{money(g.settles)}</strong></td>
                        <td className="r" style={neg(g.closing)}><strong>{money(g.closing)}</strong></td>
                      </tr>,
                    ])}
                    {cust && (
                      <tr className="sl-towntotal">
                        <td colSpan={5} className="r"><strong>Total {grp.township || "No township"}</strong></td>
                        <td className="r"><strong>{money(t.c)}</strong></td>
                        <td className="r"><strong>{money(t.s)}</strong></td>
                        <td className="r" style={neg(t.b)}><strong>{money(t.b)}</strong></td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
            </table>
          </div>
        </div>
      )}
    </>
  );
}

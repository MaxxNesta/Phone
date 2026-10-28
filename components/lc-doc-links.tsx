import Link from "next/link";
import { sql } from "@/lib/db";

const money = (v: string | number) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
const SPREAD: Record<string, string> = { VALUE: "by purchase value", EQUAL: "equal per phone", MANUAL: "manual by variant" };
const STATUS: Record<string, string> = { DRAFT: "Draft", CALCULATED: "Calculated", POSTED: "Posted", REVERSED: "Reversed" };

/**
 * From a bill back to the phones it costed: on the page of a payment, voucher
 * or invoice whose journal debited a landed-cost clearing account, which
 * landed cost spread that line, as what charge, and onto which IMEIs. A line
 * no landed cost has taken yet says so, with the way to spread it.
 */
export async function LcDocLinks({ journalEntryId }: { journalEntryId: string | null }) {
  if (!journalEntryId) return null;
  const lines = (await sql`
    select jl.id, jl.base_amount::text as amount, a.code as account, a.name as account_name,
           c.id as charge_id, c.method, t.name as cost_type, lc.id as lc_id, lc.doc_no as lc_no, lc.status,
           (select string_agg(r.doc_no, ', ' order by r.doc_no) from landed_cost_receipt x
              join document r on r.id = x.receipt_id where x.landed_cost_id = lc.id) as receipts
      from journal_line jl
      join account a on a.id = jl.account_id
      left join landed_cost_charge c on c.source_journal_line_id = jl.id and c.is_active
      left join landed_cost_type t on t.id = c.cost_type_id
      left join document lc on lc.id = c.landed_cost_id
     where jl.journal_entry_id = ${journalEntryId} and jl.base_amount > 0
       and (c.id is not null
            or jl.account_id in (select account_id from system_account s where s.company_id = jl.company_id and s.role = 'LANDED_COST_CLEARING'
                                 union select clearing_account_id from landed_cost_type y where y.company_id = jl.company_id and y.clearing_account_id is not null))
     order by jl.base_amount desc`) as unknown as {
       id: string; amount: string; account: string; account_name: string; charge_id: string | null; method: string | null;
       cost_type: string | null; lc_id: string | null; lc_no: string | null; status: string | null; receipts: string | null }[];
  if (lines.length === 0) return null;

  const chargeIds = lines.map((l) => l.charge_id).filter(Boolean) as string[];
  const phones = chargeIds.length === 0 ? [] : (await sql`
    select a.charge_id, s.id as serial_id, s.serial_no, i.code as item_code, a.original_cost::text as original, a.amount::text as amount
      from landed_cost_allocation a
      join stock_serial s on s.id = a.serial_id
      join item i on i.id = a.item_id
     where a.charge_id = any(${chargeIds}::uuid[])
     order by i.code, s.serial_no`) as unknown as {
       charge_id: string; serial_id: string; serial_no: string; item_code: string; original: string; amount: string }[];

  return (
    <section>
      <div className="card">
        <div className="card-head">
          <h2>Landed cost</h2>
          <span className="page-sub">Where this bill went onto the phones</span>
        </div>
        <div className="card-body" style={{ display: "grid", gap: 14 }}>
          {lines.map((l) => {
            const mine = phones.filter((p) => p.charge_id === l.charge_id);
            return (
              <div key={l.id} style={{ display: "grid", gap: 8 }}>
                {l.lc_id ? (
                  <p style={{ margin: 0 }}>
                    <strong>{l.cost_type ?? "Landed cost charge"}</strong> of {money(l.amount)}, spread {SPREAD[l.method ?? ""] ?? ""} on{" "}
                    <Link href={`/purchases/landed-costs/${l.lc_id}`} style={{ color: "var(--link)" }}>{l.lc_no}</Link>
                    <span className="page-sub"> · {STATUS[l.status ?? ""] ?? l.status}{l.receipts ? ` · goods receipt ${l.receipts}` : ""}</span>
                  </p>
                ) : (
                  <p style={{ margin: 0 }}>
                    <strong>{money(l.amount)}</strong> waits in <span className="code">{l.account}</span> {l.account_name}; no landed cost has spread it yet.{" "}
                    <Link href="/purchases/landed-costs/new" style={{ color: "var(--link)" }}>Spread it onto a receipt</Link>
                  </p>
                )}
                {mine.length > 0 && (
                  <div className="tablewrap">
                    <table>
                      <thead><tr><th>IMEI</th><th>Item</th><th className="r">Purchase cost</th><th className="r">This charge</th><th className="r">Together</th></tr></thead>
                      <tbody>{mine.map((p) => (
                        <tr key={p.serial_id}>
                          <td className="code"><Link href={`/inventory/phones/${p.serial_id}`} style={{ color: "var(--link)" }}>{p.serial_no}</Link></td>
                          <td className="code">{p.item_code}</td>
                          <td className="r">{money(p.original)}</td>
                          <td className="r">{money(p.amount)}</td>
                          <td className="r">{money(Number(p.original) + Number(p.amount))}</td>
                        </tr>))}
                      </tbody>
                      <tfoot><tr><td colSpan={3}>{mine.length} phone{mine.length === 1 ? "" : "s"}</td>
                        <td className="r">{money(mine.reduce((s, p) => s + Number(p.amount), 0))}</td><td /></tr></tfoot>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

import Link from "next/link";
import { sql } from "@/lib/db";

const money = (s: string) => Number(s).toLocaleString("en-US", { maximumFractionDigits: 0 });
const KIND: Record<string, string> = {
  RUN: "Depreciation", OPENING: "Opening accumulated (to)", HISTORICAL: "Depreciation (history)", CORRECTION: "Correction", ACQUISITION: "Acquisition", DISPOSAL: "Disposal", OTHER: "Linked",
};

/**
 * From the ledger back to the asset subledger: on a journal's own page, the
 * assets and months its lines carry. Shown only when it carries any.
 */
export async function FaDocLinks({ journalEntryId }: { journalEntryId: string | null }) {
  if (!journalEntryId) return null;
  const rows = (await sql`
    select f.id, f.code, f.name, a.code as account, x.source as kind, to_char(x.period_month, 'YYYY-MM') as month, x.amount::text as amount
      from fa_depreciation x join journal_line jl on jl.id = x.journal_line_id
      join fixed_asset f on f.id = x.asset_id join account a on a.id = jl.account_id
     where jl.journal_entry_id = ${journalEntryId}
    union all
    select f.id, f.code, f.name, a.code, k.kind, null, k.amount::text
      from fa_journal_link k join journal_line jl on jl.id = k.journal_line_id
      join fixed_asset f on f.id = k.asset_id join account a on a.id = jl.account_id
     where jl.journal_entry_id = ${journalEntryId}
     order by 2, 6`) as unknown as { id: string; code: string; name: string; account: string; kind: string; month: string | null; amount: string }[];
  if (rows.length === 0) return null;
  return (
    <section>
      <div className="card">
        <div className="card-head">
          <h2>Fixed assets</h2>
          <span className="page-sub">What this journal carries in the asset register</span>
        </div>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Asset</th><th>Account</th><th>Carries</th><th>Month</th><th className="r">Amount</th></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i}>
                <td><Link href={`/fixed-assets/${r.id}`} style={{ color: "var(--link)" }}>{r.code}</Link> {r.name}</td>
                <td className="code">{r.account}</td>
                <td>{KIND[r.kind] ?? r.kind}</td>
                <td>{r.month ? <Link href={`/fixed-assets/calendar?year=${r.month.slice(0, 4)}&month=${r.month}`} style={{ color: "var(--link)" }}>{r.month}</Link> : "—"}</td>
                <td className="r">{money(r.amount)}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

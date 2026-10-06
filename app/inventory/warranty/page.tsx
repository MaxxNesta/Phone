import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { warrantyLookup, warrantiesEnding } from "@/lib/phone";
import { shortDate } from "@/lib/format";
import { paginate } from "@/lib/paging";
import { Pager } from "@/components/pager";

export const metadata = { title: "Warranty" };

const STATE: Record<string, [string, string]> = {
  ACTIVE: ["Active", "ok"], ENDING: ["Ending soon", "warn"], EXPIRED: ["Expired", "reversed"],
};

export default async function Warranty({ searchParams }: { searchParams: Promise<{ q?: string; ending?: string; page?: string }> }) {
  const user = await requirePermission("inventory.view");
  const sp = await searchParams;
  const { q, ending } = sp;
  const rows = q ? await warrantyLookup(user.companyId, q)
    : await warrantiesEnding(user.companyId, Number(ending) || 30);

  const pg = paginate(rows, sp.page);
  return (
    <>
      <div className="page-head hero">
        <h1>Warranty lookup</h1>
        <p className="page-sub">By IMEI, maker&apos;s serial, invoice number or customer name</p>
      </div>
      <form className="card filters" method="get">
        <div className="card-body filter-row">
          <div className="field">
            <label htmlFor="wq">IMEI, serial, invoice or customer</label>
            <input id="wq" name="q" defaultValue={q ?? ""} autoFocus placeholder="Scan the IMEI" />
          </div>
          <button className="btn">Look up</button>
        </div>
      </form>

      <div className="card" style={{ overflowX: "auto" }}>
        <div className="card-head">
          <h2>{q ? `Results for “${q}”` : `Customer warranties ending in ${Number(ending) || 30} days`}</h2>
        </div>
        <table>
          <thead>
            <tr><th>IMEI</th><th>Model</th><th>Customer</th><th>Invoice</th><th>Sold</th><th>Warranty</th><th>Expires</th><th>Status</th></tr>
          </thead>
          <tbody>
            {pg.rows.map((r: any) => {
              const st = r.warranty_state ? STATE[r.warranty_state] : null;
              return (
                <tr key={r.serial_id}>
                  <td className="m"><Link href={`/inventory/phones/${r.serial_id}`}>{r.imei}</Link></td>
                  <td>{r.item_name}</td>
                  <td>{r.customer_name ?? "—"}</td>
                  <td>{r.out_document_id ? <Link href={`/documents/${r.out_document_id}`}>{r.out_doc_no}</Link> : "—"}</td>
                  <td>{r.out_date ? shortDate(r.out_date) : "—"}</td>
                  <td>{r.warranty_months ? `${r.warranty_months} months` : "—"}</td>
                  <td>{r.warranty_expiry ? shortDate(r.warranty_expiry) : "—"}</td>
                  <td>{st ? <span className={`pill ${st[1]}`}>{st[0]}</span> : (r.status ?? "").replace(/_/g, " ").toLowerCase() || "—"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={8} className="page-sub">{q ? "Nothing found." : "None ending soon."}</td></tr>}
          </tbody>
        </table>
        <Pager p={pg} params={sp} />
      </div>
      <p className="page-sub">
        Repairs and warranty claims are not built yet. A unit sent for repair is marked from its own page (Hold → Send to repair).
      </p>
    </>
  );
}

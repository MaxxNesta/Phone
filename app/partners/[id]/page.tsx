import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { sql } from "@/lib/db";
import { money, shortDate } from "@/lib/format";
import { paginate } from "@/lib/paging";
import { Pager } from "@/components/pager";

export const metadata = { title: "Partner" };

const EVENT: Record<string, string> = {
  RECEIVED: "Supplied", SOLD: "Bought", CUSTOMER_RETURN: "Returned",
  SUPPLIER_RETURN: "Sent back", TRANSFER: "Transferred", RESTORED: "Sale voided",
  WRITTEN_OFF: "Written off",
};

/** One customer or supplier: their documents, and every phone that passed between us. */
export default async function Partner({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const user = await requirePermission("sales.view");
  const { id } = await params;
  const [p] = await sql`
    select id, code, name, is_customer, is_supplier, phone, address
      from business_partner where id = ${id} and company_id = ${user.companyId}`;
  if (!p) notFound();

  const [phones, docs] = await Promise.all([
    sql`
      select s.id as serial_id, s.serial_no as imei, i.name as item_name, e.event,
             d.id as document_id, d.doc_no, d.posting_date, v.status
        from stock_serial_event e
        join document d on d.id = e.document_id and d.partner_id = ${id}
        join stock_serial s on s.id = e.serial_id
        join item i on i.id = s.item_id
        join v_stock_serial v on v.serial_id = s.id
       where e.company_id = ${user.companyId}
       order by e.created_at desc limit 300`,
    sql`
      select id, doc_no, doc_type, status, posting_date, gross_total
        from document where partner_id = ${id} and company_id = ${user.companyId}
       order by posting_date desc nulls last, created_at desc limit 100`,
  ]);

  const pgUnits = paginate((phones as any[]), sp.units);
  const pgDocs = paginate((docs as any[]), sp.docs);
  return (
    <>
      <div className="page-head">
        <span className="eyebrow"><Link href="/partners">Partners</Link></span>
        <h1>{p.name}</h1>
        <p className="page-sub">
          {[p.code, p.is_customer && "customer", p.is_supplier && "supplier", p.phone, p.address]
            .filter(Boolean).join(" · ")}
        </p>
      </div>

      <div className="card">
        <div className="card-head"><h2>Phones</h2><span className="page-sub">{phones.length}</span></div>
        <div className="tablewrap">
          <table>
            <thead><tr><th>IMEI</th><th>Model</th><th>What</th><th>Document</th><th>Date</th><th>Now</th></tr></thead>
            <tbody>
              {pgUnits.rows.map((r, i) => (
                <tr key={i}>
                  <td className="m"><Link href={`/inventory/phones/${r.serial_id}`}>{r.imei}</Link></td>
                  <td>{r.item_name}</td>
                  <td>{EVENT[r.event] ?? r.event}</td>
                  <td><Link href={`/documents/${r.document_id}`}>{r.doc_no ?? "—"}</Link></td>
                  <td>{r.posting_date ? shortDate(r.posting_date) : "—"}</td>
                  <td>{String(r.status).replace(/_/g, " ").toLowerCase()}</td>
                </tr>
              ))}
              {phones.length === 0 && <tr><td colSpan={6} className="page-sub">No phones yet.</td></tr>}
            </tbody>
          </table>
          <Pager p={pgUnits} params={sp} name="units" />
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Documents</h2></div>
        <div className="tablewrap">
          <table>
            <thead><tr><th>No.</th><th>Type</th><th>Date</th><th>Status</th><th className="r">Total</th></tr></thead>
            <tbody>
              {pgDocs.rows.map((d) => (
                <tr key={d.id}>
                  <td><Link href={`/documents/${d.id}`}>{d.doc_no ?? "draft"}</Link></td>
                  <td>{String(d.doc_type).replace(/_/g, " ").toLowerCase()}</td>
                  <td>{d.posting_date ? shortDate(d.posting_date) : "—"}</td>
                  <td>{String(d.status).toLowerCase()}</td>
                  <td className="r">{money(d.gross_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager p={pgDocs} params={sp} name="docs" />
        </div>
      </div>
    </>
  );
}

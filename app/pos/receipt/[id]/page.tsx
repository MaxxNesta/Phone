import { Fragment } from "react";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { money, shortDate } from "@/lib/format";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Receipt" };

export default async function Receipt({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("sales.view");
  const { id } = await params;
  const [doc] = await sql`
    select d.id, d.doc_no, d.version, d.posting_date, d.net_total, d.tax_total, d.gross_total,
           d.status, bp.name as customer, sm.name as salesman, c.name as company,
           l.name as location, u.name as cashier
      from document d
      join company c on c.id = d.company_id
      left join business_partner bp on bp.id = d.partner_id
      left join salesman sm on sm.id = d.salesman_id
      left join location l on l.id = d.location_id
      left join app_user u on u.id = d.posted_by_id
     where d.id = ${id} and d.company_id = ${user.companyId} and d.doc_type = 'SALES_INVOICE'`;
  if (!doc) notFound();

  const [lines, paid] = await Promise.all([
    sql`
      select dl.line_no, i.name, dl.entered_qty::float as qty, dl.unit_price::float as price,
             dl.net_amount::float + dl.tax_amount::float as amount, dl.warranty_months,
             (select string_agg(s.serial_no, ', ') from stock_movement sm
                join stock_serial_issue si on si.stock_movement_id = sm.id
                join stock_serial s on s.id = si.serial_id
               where sm.document_line_id = dl.id) as imeis
        from document_line dl join item i on i.id = dl.item_id
       where dl.document_id = ${id} order by dl.line_no`,
    sql`
      select a.name, pa.amount::float as amount
        from payment_allocation pa
        join document r on r.id = pa.payment_id and r.status = 'POSTED'
        join journal_line jl on jl.journal_entry_id = r.journal_entry_id and jl.base_amount > 0
        join account a on a.id = jl.account_id
       where pa.invoice_id = ${id}`,
  ]);
  const paidTotal = paid.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div className="receipt">
      <div className="noprint" style={{ marginBottom: "1rem" }}><PrintButton /></div>
      <h1>{doc.company}</h1>
      <p>{doc.location} · {shortDate(doc.posting_date)}</p>
      <p>
        Receipt <strong>{doc.doc_no}{doc.version > 1 ? ` v${doc.version}` : ""}</strong>
        {doc.status === "REVERSED" && " — VOIDED"}
      </p>
      <p>Customer: {doc.customer}{doc.salesman ? ` · Sold by ${doc.salesman}` : ""}</p>
      <table>
        <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.line_no}>
              <td>
                {l.name}
                {l.imeis && <div className="m">IMEI {l.imeis}</div>}
                {l.warranty_months ? <div>Warranty {l.warranty_months} months</div> : null}
              </td>
              <td className="num">{l.qty}</td>
              <td className="num">{money(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="pos-totals">
        <dt>Net</dt><dd className="num">{money(doc.net_total)}</dd>
        <dt>Tax</dt><dd className="num">{money(doc.tax_total)}</dd>
        <dt className="pos-grand">Total</dt><dd className="num pos-grand">{money(doc.gross_total)}</dd>
        {paid.map((p, i) => <Fragment key={i}><dt>Paid · {p.name}</dt><dd className="num">{money(p.amount)}</dd></Fragment>)}
        {Number(doc.gross_total) - paidTotal > 0.005 && (
          <><dt>On account</dt><dd className="num">{money(Number(doc.gross_total) - paidTotal)}</dd></>
        )}
      </dl>
      {doc.cashier && <p>Served by {doc.cashier}</p>}
    </div>
  );
}

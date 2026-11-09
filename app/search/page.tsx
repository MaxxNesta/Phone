import { seenLocations } from "@/lib/branch-scope";
import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { requireUser, can, canSeeDocument } from "@/lib/auth";
import { money, shortDate } from "@/lib/format";

export const metadata = { title: "Search" };

/**
 * The top bar's search. An exact IMEI or document number goes straight to
 * it; anything else lists handsets, documents and customers that match.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const q = ((await searchParams).q ?? "").trim();
  const co = user.companyId;
  if (!q) redirect("/");
  const like = `%${q}%`;

  // Phones and documents of other branches stay out of a search by someone who sees only their own.
  const locs = await seenLocations();
  const [units, allDocs, partners, oldPurchases] = await Promise.all([
    sql`select serial_id, imei, item_name, status, customer_name from v_stock_serial
         where company_id = ${co} and (imei = ${q} or imei2 = ${q} or device_serial = ${q}
               or imei ilike ${like}) ${locs ? sql`and location_id = any(${locs})` : sql``} limit 20`,
    sql`select id, doc_no, doc_type, posting_date, gross_total::float as total from document
         where company_id = ${co} and (doc_no ilike ${like} or source_ref ilike ${like}) and status <> 'DRAFT' ${locs ? sql`and location_id = any(${locs})` : sql``}
         order by posting_date desc limit 20`,
    sql`select id, name, code, is_customer from business_partner
         where company_id = ${co} and (name ilike ${like} or code ilike ${like}) limit 20`,
    // Purchases from the old system: by old ID, new number or an IMEI on them.
    sql`select h.invoice_no, h.old_ref, h.doc_date, h.net_total::float as total, p.name as supplier
          from historical_purchase_invoice h join business_partner p on p.id = h.partner_id
         where h.company_id = ${co} and (h.old_ref ilike ${like} or h.invoice_no ilike ${like}
               or exists (select 1 from historical_purchase_invoice_line l where l.invoice_id = h.id and ${q} = any(l.serials)))
         order by h.doc_date desc limit 20`,
  ]);

  // Only document types this person may open, and old purchases only for those who may see purchases.
  const docs = allDocs.filter((d) => canSeeDocument(user, d.doc_type as string));
  const imported = can(user, "purchase.view") ? oldPurchases : ([] as unknown as typeof oldPurchases);
  const exactUnit = units.find((u: any) => u.imei === q);
  if (exactUnit) redirect(`/imei/${exactUnit.serial_id}`);
  const exactDoc = docs.find((d: any) => d.doc_no.toLowerCase() === q.toLowerCase());
  if (exactDoc) redirect(`/documents/${exactDoc.id}`);

  return (
    <>
      <div className="page-head hero"><h1>Search</h1><p className="page-sub">“{q}”</p></div>
      {units.length + docs.length + partners.length + imported.length === 0 && <p className="page-sub">Nothing matches.</p>}
      {units.length > 0 && (
        <div className="card" style={{ marginBottom: "var(--s3)" }}>
          <div className="card-head"><h2>Handsets</h2></div>
          <table><tbody>
            {units.map((u: any) => (
              <tr key={u.serial_id}>
                <td className="m"><Link href={`/imei/${u.serial_id}`}>{u.imei}</Link></td>
                <td>{u.item_name}</td><td>{u.status.replace(/_/g, " ").toLowerCase()}</td><td>{u.customer_name ?? ""}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
      {docs.length > 0 && (
        <div className="card" style={{ marginBottom: "var(--s3)" }}>
          <div className="card-head"><h2>Documents</h2></div>
          <table><tbody>
            {docs.map((d: any) => (
              <tr key={d.id}>
                <td className="m"><Link href={`/documents/${d.id}`}>{d.doc_no}</Link></td>
                <td>{d.doc_type.replace(/_/g, " ").toLowerCase()}</td>
                <td>{shortDate(d.posting_date)}</td><td className="num">{money(d.total)}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
      {imported.length > 0 && (
        <div className="card" style={{ marginBottom: "var(--s3)" }}>
          <div className="card-head"><h2>Imported purchase invoices</h2></div>
          <table><tbody>
            {imported.map((h: any) => (
              <tr key={h.invoice_no}>
                <td className="m"><Link href={`/purchases/invoices/imported?q=${encodeURIComponent(h.invoice_no)}`}>{h.invoice_no}</Link></td>
                <td className="m">{h.old_ref}</td><td>{h.supplier}</td>
                <td>{shortDate(h.doc_date)}</td><td className="num">{money(h.total)}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
      {partners.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>Customers &amp; suppliers</h2></div>
          <table><tbody>
            {partners.map((p: any) => (
              <tr key={p.id}>
                <td><Link href={`/partners/${p.id}`}>{p.name}</Link></td>
                <td className="m">{p.code}</td>
                <td>{p.is_customer ? "Customer" : "Supplier"}</td>
                <td><Link href={`/inventory/warranty?q=${encodeURIComponent(p.name)}`}>Warranties</Link></td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
    </>
  );
}

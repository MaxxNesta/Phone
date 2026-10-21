import Link from "next/link";
import { sql, money } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { seenLocations, scopedBranch, seenBranches } from "@/lib/branch-scope";
import { HelpHint } from "@/components/help-hint";

export const metadata = { title: "Payments received" };

/**
 * Every payment taken from customers, by how it was paid (0141): what a
 * cashier checks the KBZPay or AYA Pay app against at the end of the day,
 * reference by reference. Each row is a CUSTOMER_RECEIPT document; a voided
 * one stays listed, marked, with what reversed it.
 */
export default async function PaymentsReceived({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; channel?: string; branch?: string; status?: string; dir?: string }>;
}) {
  const user = await requirePermission("accounting.view");
  const co = user.companyId;
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : today.slice(0, 8) + "01";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : today;
  const status = sp.status === "all" || sp.status === "REVERSED" ? sp.status : "POSTED";
  const channel = sp.channel || "";
  // Money in (receipts, less refunds) or money out (payments to suppliers).
  const out = sp.dir === "out";
  const types = out ? ["SUPPLIER_PAYMENT"] : ["CUSTOMER_RECEIPT", "CUSTOMER_REFUND"];
  const locs = await seenLocations();
  const branch = await scopedBranch(sp.branch);

  const where = sql`
        d.company_id = ${co} and d.doc_type = any(${types})
    and d.posting_date between ${from}::date and ${to}::date
    ${status === "all" ? sql`and d.status in ('POSTED', 'REVERSED')` : sql`and d.status = ${status}`}
    ${channel === "none" ? sql`and d.payment_channel_id is null` : channel ? sql`and d.payment_channel_id = ${channel}` : sql``}
    ${locs ? sql`and d.location_id = any(${locs})` : sql``}
    ${branch ? sql`and fn_location_branch(d.location_id) = ${branch}` : sql``}`;

  const [rows, summary, channels, branches] = await Promise.all([
    sql`
      select d.id, d.doc_no, d.doc_type, d.posting_date, d.posted_at, d.status, d.currency,
             -- A refund is money going back out: it counts against its method.
             (case when d.doc_type = 'CUSTOMER_REFUND' then -d.gross_total else d.gross_total end)::float as amount,
             d.payment_reference, coalesce(pc.name, '—') as channel, pc.kind,
             a.code || ' · ' || a.name as account, p.name as customer, l.name as location,
             u.name as created_by, rv.doc_no as reversed_by,
             (select string_agg(i.doc_no, ', ' order by i.doc_no) from payment_allocation pa
                join document i on i.id = pa.invoice_id where pa.payment_id = d.id) as invoices,
             o.id as sale_id, o.doc_no as sale_no, src.id as return_id, src.doc_no as return_no
        from document d
        left join payment_channel pc on pc.id = d.payment_channel_id
        left join lateral (select l.account_id from journal_line l join account x on x.id = l.account_id and x.is_cash_account
                            where l.journal_entry_id = d.journal_entry_id limit 1) jl on true
        left join account a on a.id = jl.account_id
        left join business_partner p on p.id = d.partner_id
        left join location l on l.id = d.location_id
        left join app_user u on u.id = d.created_by_id
        left join document rv on rv.id = d.reversed_by_document_id
        left join document o on o.id = d.lifecycle_owner_id
        left join document src on src.id = d.source_document_id and d.doc_type = 'CUSTOMER_REFUND'
       where ${where} and a.id is not null
       order by d.posting_date desc, d.posted_at desc nulls last
       limit 1000`,
    sql`
      select coalesce(pc.name, 'Not labelled') as channel, pc.kind,
             count(*)::int as n,
             sum(case when d.doc_type = 'CUSTOMER_REFUND' then -d.gross_total else d.gross_total end)::float as amount
        from document d left join payment_channel pc on pc.id = d.payment_channel_id
       where ${where}
       group by 1, 2 order by amount desc`,
    sql`select id, name from payment_channel where company_id = ${co} order by sort_order, name`,
    sql`select id, code, name from location where company_id = ${co} and parent_id is null and is_active order by code`,
  ]);
  const myBranches = await seenBranches(branches as unknown as { id: string; name: string }[]);
  const total = (summary as any[]).reduce((s, r) => s + Number(r.amount), 0);

  return (
    <>
      <div className="page-head hero">
        <span className="eyebrow">Accounting · Cash & bank</span>
        <h1>{out ? "Payments made" : "Payments received"}</h1>
        <HelpHint>
          Every payment taken from customers, at the till or on a receipt, by how it was paid. Check a
          wallet&rsquo;s own statement against the transaction IDs here; the account itself is matched in
          Bank reconciliation. Voided payments are kept and marked.
        </HelpHint>
      </div>

      <div className="segmented" style={{ marginBottom: "var(--s3)" }}>
        <Link className={`seg${out ? "" : " on"}`} href="/finance/payments">Received</Link>
        <Link className={`seg${out ? " on" : ""}`} href="/finance/payments?dir=out">Paid out</Link>
      </div>

      <form className="filterbar" method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", marginBottom: "var(--s3)" }}>
        {out && <input type="hidden" name="dir" value="out" />}
        <div className="field"><label htmlFor="from">From</label><input id="from" name="from" type="date" defaultValue={from} /></div>
        <div className="field"><label htmlFor="to">To</label><input id="to" name="to" type="date" defaultValue={to} /></div>
        <div className="field">
          <label htmlFor="channel">Method</label>
          <select id="channel" name="channel" defaultValue={channel}>
            <option value="">All methods</option>
            {(channels as any[]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="none">Not labelled</option>
          </select>
        </div>
        {myBranches.length > 1 && (
          <div className="field">
            <label htmlFor="branch">Branch</label>
            <select id="branch" name="branch" defaultValue={branch ?? ""}>
              <option value="">All branches</option>
              {myBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={status}>
            <option value="POSTED">Posted</option>
            <option value="REVERSED">Voided</option>
            <option value="all">All</option>
          </select>
        </div>
        <button type="submit" className="btn">Show</button>
      </form>

      <section>
        <div className="card">
          <div className="card-head"><h2>By method</h2><span className="page-sub">{money(total)} MMK</span></div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Method</th><th className="r">Payments</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {(summary as any[]).map((r) => (
                  <tr key={r.channel}><td>{r.channel}</td><td className="r">{r.n}</td><td className="r">{money(r.amount)}</td></tr>
                ))}
                {summary.length === 0 && <tr><td colSpan={3} className="empty">No payments in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section>
        <div className="card">
          <div className="card-head"><h2>Payments</h2><span className="page-sub">{rows.length}{rows.length === 1000 ? "+ (first 1,000)" : ""}</span></div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Receipt</th><th>Method</th><th>Transaction ID</th><th className="r">Amount</th>
                  <th>{out ? "From" : "Into"}</th><th>{out ? "Supplier" : "Customer"}</th><th>For</th><th>Branch</th><th>By</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(rows as any[]).map((r) => (
                  <tr key={r.id} className={r.status === "REVERSED" ? "muted" : ""}>
                    <td>{String(r.posting_date instanceof Date ? r.posting_date.toISOString().slice(0, 10) : r.posting_date)}</td>
                    <td><Link href={`/documents/${r.id}`}>{r.doc_no}</Link></td>
                    <td>{r.channel}</td>
                    <td className="m">{r.payment_reference ?? "—"}</td>
                    <td className={`r ${r.amount < 0 ? "neg" : ""}`}>{money(r.amount)}</td>
                    <td>{r.account}</td>
                    <td>{r.customer}</td>
                    <td>{r.return_id ? <>Refund · <Link href={`/documents/${r.return_id}`}>{r.return_no}</Link></>
                      : r.sale_id ? <Link href={`/documents/${r.sale_id}`}>{r.sale_no}</Link> : r.invoices ?? "Advance"}</td>
                    <td>{r.location}</td>
                    <td>{r.created_by ?? "—"}</td>
                    <td>{r.status === "REVERSED" ? <span className="pill reversed">Voided{r.reversed_by ? ` · ${r.reversed_by}` : ""}</span> : "Posted"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

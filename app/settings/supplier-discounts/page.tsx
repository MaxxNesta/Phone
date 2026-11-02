import { requirePermission } from "@/lib/auth";
import { sql } from "@/lib/db";
import { HelpHint } from "@/components/help-hint";

export const metadata = { title: "Supplier discounts" };

/**
 * How a supplier's discount on a purchase bill reaches the books. Read-only
 * while only one method can post: the choice is stored per company
 * (company.purchase_discount_policy) so a later company can take the other.
 */
export default async function SupplierDiscounts() {
  const user = await requirePermission("settings.manage");
  const [[co], [acct], [{ n }]] = await Promise.all([
    sql`select purchase_discount_policy as policy from company where id = ${user.companyId}`,
    sql`select a.code, a.name from system_account r join account a on a.id = r.account_id
         where r.company_id = ${user.companyId} and r.role = 'PURCHASE_DISCOUNT_RECEIVED'`,
    sql`select count(*)::int as n from document_line dl join document d on d.id = dl.document_id
         where d.company_id = ${user.companyId} and d.doc_type = 'PURCHASE_INVOICE' and d.status = 'POSTED'
           and (coalesce(dl.discount_amount, 0) <> 0 or coalesce(dl.invoice_discount_amount, 0) <> 0)`,
  ]) as [any[], any[], any[]];

  const options = [
    { key: "GROSS", title: "Gross cost + Purchase Discounts",
      lead: `Each phone keeps the price it was bought at (its FIFO cost). The supplier is owed the discounted amount, and the discount is credited to ${acct ? `${acct.code} ${acct.name}` : "the Purchase discount received account"}, shown on the P&L as its own deduction.`,
      available: true },
    { key: "NET", title: "Net cost",
      lead: "The discount lowers what the phones cost. Not available yet.",
      available: false },
  ];

  return (
    <div className="ie">
      <header className="ie-title">
        <h1>Supplier discounts <HelpHint label="About supplier discounts">A discount the supplier gives on a purchase bill, on a line or on the whole bill. The method is set per company and is never re-applied to bills already posted.</HelpHint></h1>
      </header>
      <section className="card">
        <div className="card-head"><h2>Accounting method</h2>
          <span className="page-sub">{n > 0 ? `${n} posted bill line${n === 1 ? "" : "s"} carry a discount — the method stays as it is` : "No discounted bill posted yet"}</span>
        </div>
        <div className="card-body" role="radiogroup" aria-label="Supplier discount accounting">
          {options.map((o) => (
            <label key={o.key} className="policy-opt" data-on={co?.policy === o.key || undefined} aria-disabled={!o.available || undefined}>
              <input type="radio" name="policy" checked={co?.policy === o.key} disabled readOnly />
              <span><strong>{o.title}</strong><span className="subline">{o.lead}</span></span>
            </label>
          ))}
          {!acct && <div className="alert" style={{ marginTop: 12 }}>No account is set for Purchase discount received. Point it at 51201 Purchase Discounts in the chart of accounts before posting a discounted bill.</div>}
        </div>
      </section>
    </div>
  );
}

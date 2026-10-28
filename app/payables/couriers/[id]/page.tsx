import Link from "next/link";
import { notFound } from "next/navigation";
import { sql, money } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { courierCharges, courierPayments } from "@/lib/courier-payables";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { HelpHint } from "@/components/help-hint";

export const metadata = { title: "Courier" };

const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/** One courier: every charge they were owed, what each has been paid, and the payments. */
export default async function CourierPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("accounting.view");
  const { id } = await params;
  const [partner] = await sql`
    select id, code, name, phone from business_partner where id = ${id} and company_id = ${user.companyId}`;
  if (!partner) notFound();
  const [charges, payments] = await Promise.all([
    courierCharges(user.companyId, id, await seenLocations()),
    courierPayments(user.companyId, id),
  ]);
  const owed = charges.reduce((s, c) => s + c.owed, 0);
  const paid = charges.reduce((s, c) => s + c.paid, 0);
  const open = charges.reduce((s, c) => s + c.open, 0);

  return (
    <div className="ie">
      <Breadcrumbs trail={[{ label: "Payables", href: "/payables" }, { label: "Couriers", href: "/payables?view=couriers" }, { label: partner.name }]} />
      <header className="ie-title" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1>{partner.name} <HelpHint label="About courier balances">Charges come from landed costs that named {partner.name} as payee with no bill behind them. Each is owed in Payable (Other) until a courier payment settles it.</HelpHint></h1>
        <span className="page-sub">{[partner.code, partner.phone].filter(Boolean).join(" · ")}</span>
        {open > 0.0001 && <Link href={`/payables/couriers/pay?partner=${partner.id}`} className="btn" style={{ marginLeft: "auto" }}>Pay {partner.name}</Link>}
      </header>

      <div className="kpis">
        <div className="kpi"><span className="kpi-label">Charged</span><span className="kpi-value">{money(owed)}</span><span className="kpi-note">{charges.length} charge{charges.length === 1 ? "" : "s"}</span></div>
        <div className="kpi"><span className="kpi-label">Paid</span><span className="kpi-value">{money(paid)}</span><span className="kpi-note">{payments.filter((p) => p.status === "POSTED").length} payment{payments.length === 1 ? "" : "s"}</span></div>
        <div className="kpi"><span className="kpi-label">Outstanding</span><span className="kpi-value">{money(open)}</span></div>
      </div>

      <section className="card">
        <div className="card-head"><h2>Charges</h2><span className="page-sub">newest first</span></div>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Date</th><th>Landed cost</th><th>Charge</th><th>Goods receipt</th><th className="r">Phones</th><th className="r">Charged</th><th className="r">Paid</th><th className="r">Open</th><th>Status</th></tr></thead>
            <tbody>
              {charges.map((c) => (
                <tr key={c.id}>
                  <td>{day(c.doc_date)}</td>
                  <td className="code"><Link href={`/purchases/landed-costs/${c.lc_id}`} style={{ color: "var(--link)" }}>{c.lc_no}</Link></td>
                  <td>{c.cost_type}{c.reference && <div className="subline">{c.reference}</div>}</td>
                  <td className="code">{c.receipts ?? "—"}</td>
                  <td className="r">{c.phones}</td>
                  <td className="r">{money(c.owed)}</td>
                  <td className="r">{c.paid > 0 ? money(c.paid) : "—"}</td>
                  <td className="r"><strong>{c.open > 0.0001 ? money(c.open) : "—"}</strong></td>
                  <td>{c.open <= 0.0001 ? <span className="pill ok">Paid</span> : c.paid > 0 ? <span className="pill warn">Part paid</span> : <span className="pill">Unpaid</span>}</td>
                </tr>
              ))}
              {charges.length === 0 && <tr><td colSpan={9} className="empty">Nothing has been charged to {partner.name}.</td></tr>}
            </tbody>
            {charges.length > 0 && <tfoot><tr><td colSpan={5}>Total</td><td className="r">{money(owed)}</td><td className="r">{money(paid)}</td><td className="r">{money(open)}</td><td /></tr></tfoot>}
          </table>
        </div>
      </section>

      <section className="card" style={{ marginTop: 12 }}>
        <div className="card-head"><h2>Payments</h2></div>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Date</th><th>Voucher</th><th>Paid from</th><th>Against</th><th className="r">Amount</th><th>Status</th></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{day(p.doc_date)}</td>
                  <td className="code"><Link href={`/documents/${p.id}`} style={{ color: "var(--link)" }}>{p.doc_no}</Link>{p.reference && <div className="subline">{p.reference}</div>}</td>
                  <td>{p.account ?? "—"}</td>
                  <td>{p.lines.map((l) => `${l.lc_no} ${l.cost_type} ${money(l.amount)}`).join(" · ")}</td>
                  <td className="r">{money(p.total)}</td>
                  <td>{p.status === "POSTED" ? <span className="pill ok">Posted</span> : <span className="pill">Voided</span>}</td>
                </tr>
              ))}
              {payments.length === 0 && <tr><td colSpan={6} className="empty">No payments to {partner.name} yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

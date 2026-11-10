import Link from "next/link";
import { hrLinksFor } from "@/lib/hr";

/** From a voucher back to HR & Payroll: which advance or payroll it is. Links only; the HR pages check their own permissions. */
export async function HrDocLinks({ documentId }: { documentId: string }) {
  const rows = await hrLinksFor(documentId);
  if (rows.length === 0) return null;
  return (
    <section>
      <div className="card">
        <div className="card-head"><h2>HR &amp; Payroll</h2></div>
        <div className="card-body">{rows.map((r) => (
          <p key={r.href + r.what}>{r.what} <Link href={r.href} style={{ color: "var(--link)" }}>{r.ref}</Link></p>))}
        </div>
      </div>
    </section>
  );
}

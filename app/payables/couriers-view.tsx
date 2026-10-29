import Link from "next/link";
import { money, moneyOrTrace, sql } from "@/lib/db";
import { seenLocations } from "@/lib/branch-scope";
import { courierCharges } from "@/lib/courier-payables";
import { DataTable, type DataRow } from "@/components/data-table";
import { DocRefs } from "@/components/doc-refs";

const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/**
 * The carriage inward tab: each bill owed for bringing goods in, numbered,
 * with what is paid and what is open. Bills are kept without a courier's
 * name; one that does carry a name shows it.
 */
export async function CouriersView({ companyId }: { companyId: string }) {
  const bills = await courierCharges(companyId, null, await seenLocations());
  const names = new Map((await sql`
    select id, name, code from business_partner where id = any(${[...new Set(bills.map((b) => b.partner_id))]}::uuid[])`)
    .map((p) => [p.id as string, p.code === "COURIER" ? null : (p.name as string)]));
  const named = [...names.values()].some(Boolean);
  const open = bills.filter((b) => b.open > 0.0001);
  const totalOpen = open.reduce((s, b) => s + b.open, 0);
  const totalPaid = bills.reduce((s, b) => s + b.paid, 0);

  // Numbered oldest first, so a bill keeps its number as new ones arrive.
  const order = [...bills].reverse();
  const rows: DataRow[] = bills.map((b) => ({
    key: b.id,
    searchText: [b.lc_no, b.reference, names.get(b.partner_id), ...b.receipts.map((r) => r.no)].filter(Boolean).join(" "),
    sort: { n: order.indexOf(b) + 1, date: b.doc_date, owed: b.owed, paid: b.paid, open: b.open },
    node: (
      <tr>
        <td className="r subline">{order.indexOf(b) + 1}</td>
        <td>{day(b.doc_date)}</td>
        <td className="code">
          <Link href={`/purchases/landed-costs/${b.lc_id}`} style={{ color: "var(--link)" }}>{b.lc_no}</Link>
          {b.reference && <div className="subline">{b.reference}</div>}
        </td>
        <td className="code"><DocRefs refs={b.receipts} /></td>
        {named && <td>{names.get(b.partner_id) ?? "—"}</td>}
        <td className="r">{b.phones}</td>
        <td className="r">{money(b.owed)}</td>
        <td className="r">{b.paid > 0 ? money(b.paid) : "—"}</td>
        <td className="r"><strong>{b.open > 0.0001 ? money(b.open) : "—"}</strong></td>
        <td>{b.open <= 0.0001 ? <span className="pill ok">Paid</span> : b.paid > 0 ? <span className="pill warn">Part paid</span> : <span className="pill">Unpaid</span>}</td>
        <td className="tight">
          {b.open > 0.0001 && <Link href={`/payables/couriers/pay?partner=${b.partner_id}&charge=${b.id}`} className="btn tiny">Pay</Link>}
        </td>
      </tr>
    ),
  }));

  return (
    <>
      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">Carriage inward owed</span>
          <span className="kpi-value">{moneyOrTrace(totalOpen)}</span>
          <span className="kpi-note">in Payable (Other)</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Unpaid bills</span>
          <span className="kpi-value">{open.length}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Paid to date</span>
          <span className="kpi-value">{money(totalPaid)}</span>
        </div>
      </div>

      <section>
        <div className="card">
          <div className="card-head">
            <h2>Carriage inward bills</h2>
            <span className="actions">
              <span className="page-sub">{open.length} unpaid</span>
              <Link href="/payables/couriers/bill" className="btn ghost">Record carriage inward</Link>
              {open.length > 0 && <Link href="/payables/couriers/pay" className="btn">Pay all open</Link>}
            </span>
          </div>
          <DataTable
            rows={rows}
            emptyLabel="Nothing owed for carriage inward. A bill recorded as Pay later shows here until it is paid."
            searchPlaceholder="Search bills, receipts…"
            defaultSort={{ key: "n", dir: "desc" }}
            columns={[
              { key: "n", label: "#", sortable: true, align: "r" },
              { key: "date", label: "Date", sortable: true },
              { key: "lc", label: "Landed cost" },
              { key: "receipts", label: "Goods receipt" },
              ...(named ? [{ key: "courier", label: "Courier" }] : []),
              { key: "phones", label: "Phones", align: "r" as const },
              { key: "owed", label: "Charged", sortable: true, align: "r" as const },
              { key: "paid", label: "Paid", sortable: true, align: "r" as const },
              { key: "open", label: "Open", sortable: true, align: "r" as const },
              { key: "status", label: "Status" },
              { key: "actions", label: "" },
            ]}
            footer={
              <tr>
                <td colSpan={named ? 8 : 7}>Total open</td>
                <td className="r">{moneyOrTrace(totalOpen)}</td>
                <td colSpan={2} />
              </tr>
            }
          />
        </div>
      </section>
    </>
  );
}

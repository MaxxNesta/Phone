import Link from "next/link";
import { money, moneyOrTrace } from "@/lib/db";
import { seenLocations } from "@/lib/branch-scope";
import { courierBalances } from "@/lib/courier-payables";
import { DataTable, type DataRow } from "@/components/data-table";

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/**
 * The couriers tab: who brought goods in for us and has not been paid for it,
 * from the landed-cost charges that named them as payee.
 */
export async function CouriersView({ companyId }: { companyId: string }) {
  const all = await courierBalances(companyId, await seenLocations());
  const owing = all.filter((r) => r.outstanding > 0.0001);
  const totalOwed = owing.reduce((s, r) => s + r.outstanding, 0);
  const openCharges = owing.reduce((s, r) => s + r.open_charges, 0);
  const totalPaid = all.reduce((s, r) => s + r.paid, 0);

  const rows: DataRow[] = all.map((r) => ({
    key: r.partner_id,
    searchText: [r.partner_code, r.partner_name, r.phone].filter(Boolean).join(" "),
    sort: {
      partner_name: r.partner_name, open_charges: r.open_charges, owed: r.owed, paid: r.paid,
      outstanding: r.outstanding, last_charge: r.last_charge ?? "", last_paid: r.last_paid ?? "",
    },
    node: (
      <tr className="link">
        <td className="wrap">
          <Link href={`/payables/couriers/${r.partner_id}`}><strong>{r.partner_name}</strong></Link>
          <div className="m" style={{ color: "var(--muted)" }}>{[r.partner_code, r.phone].filter(Boolean).join(" · ")}</div>
        </td>
        <td className="r">{r.open_charges}</td>
        <td className="r">{money(r.owed)}</td>
        <td className="r">{money(r.paid)}</td>
        <td className="r"><strong>{r.outstanding > 0.0001 ? money(r.outstanding) : "—"}</strong></td>
        <td>{day(r.last_charge)}</td>
        <td>{day(r.last_paid)}</td>
        <td className="tight" style={{ whiteSpace: "nowrap" }}>
          <Link href={`/payables/couriers/${r.partner_id}`} className="btn ghost tiny">History</Link>{" "}
          {r.outstanding > 0.0001 && <Link href={`/payables/couriers/pay?partner=${r.partner_id}`} className="btn tiny">Pay</Link>}
        </td>
      </tr>
    ),
  }));

  return (
    <>
      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">Owed to couriers</span>
          <span className="kpi-value">{moneyOrTrace(totalOwed)}</span>
          <span className="kpi-note">in Payable (Other)</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Unpaid charges</span>
          <span className="kpi-value">{openCharges}</span>
          <span className="kpi-note">across {owing.length} courier{owing.length === 1 ? "" : "s"}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Paid to date</span>
          <span className="kpi-value">{money(totalPaid)}</span>
        </div>
      </div>

      <section>
        <div className="card">
          <div className="card-head">
            <h2>Couriers</h2>
            <span className="actions">
              <span className="page-sub">{owing.length} with a balance</span>
              <Link href="/payables/couriers/bill" className="btn ghost">Record courier bill</Link>
              <Link href="/payables/couriers/pay" className="btn">Pay courier</Link>
            </span>
          </div>
          <DataTable
            rows={rows}
            emptyLabel="No courier is owed anything. A landed-cost charge with a payee and no bill puts its amount here."
            searchPlaceholder="Search couriers…"
            defaultSort={{ key: "outstanding", dir: "desc" }}
            columns={[
              { key: "partner_name", label: "Courier", sortable: true },
              { key: "open_charges", label: "Unpaid", sortable: true, align: "r" },
              { key: "owed", label: "Charged", sortable: true, align: "r" },
              { key: "paid", label: "Paid", sortable: true, align: "r" },
              { key: "outstanding", label: "Outstanding", sortable: true, align: "r" },
              { key: "last_charge", label: "Last charge", sortable: true },
              { key: "last_paid", label: "Last paid", sortable: true },
              { key: "actions", label: "" },
            ]}
            footer={
              <tr>
                <td colSpan={4}>Total outstanding</td>
                <td className="r">{moneyOrTrace(totalOwed)}</td>
                <td colSpan={3} />
              </tr>
            }
          />
        </div>
      </section>
    </>
  );
}

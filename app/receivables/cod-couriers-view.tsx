import Link from "next/link";
import { money, moneyOrTrace } from "@/lib/db";
import { codCouriers, codParcels } from "@/lib/cod-couriers";
import { DataTable, type DataRow } from "@/components/data-table";

const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * The COD couriers tab (0232): per courier, the cash-on-delivery parcels it
 * is carrying, what it has collected and not paid in (COD Receivable under
 * its name), and what it has paid in to date. Below, every parcel still out.
 */
export async function CodCouriersView({ companyId }: { companyId: string }) {
  const [couriers, parcels] = await Promise.all([codCouriers(companyId), codParcels(companyId, null)]);
  const name = new Map(couriers.map((c) => [c.id, c.name]));
  const totalOut = couriers.reduce((s, c) => s + c.out, 0);
  const totalHeld = couriers.reduce((s, c) => s + c.held, 0);
  const totalRemitted = couriers.reduce((s, c) => s + c.remitted, 0);
  const anyDue = couriers.some((c) => c.held > 0.005 || c.outCount > 0);

  const rows: DataRow[] = couriers.map((c) => ({
    key: c.id,
    searchText: [c.name, c.code, c.phone].filter(Boolean).join(" "),
    sort: { name: c.name, out: c.out, held: c.held, remitted: c.remitted, last: c.lastRemitted ?? "" },
    node: (
      <tr>
        <td>
          <Link href={`/partners/${c.id}`} style={{ color: "var(--link)" }}>{c.name}</Link>
          <div className="subline">{c.code}{c.phone ? ` · ${c.phone}` : ""}</div>
        </td>
        <td className="r">{c.outCount > 0 ? <>{money(c.out)}<div className="subline">{plural(c.outCount, "parcel")}</div></> : "—"}</td>
        <td className="r"><strong>{Math.abs(c.held) > 0.005 ? money(c.held) : "—"}</strong></td>
        <td className="r">{c.remitted > 0 ? money(c.remitted) : "—"}</td>
        <td>{c.lastRemitted ? day(c.lastRemitted) : "—"}</td>
        <td className="tight">
          {(c.held > 0.005 || c.outCount > 0) && <Link href={`/receivables/couriers/pay?courier=${c.id}`} className="btn tiny">Pay in</Link>}
        </td>
      </tr>
    ),
  }));

  const parcelRows: DataRow[] = parcels.map((p) => ({
    key: p.id,
    searchText: [p.no, p.customer, p.customerCode, name.get(p.courierId)].filter(Boolean).join(" "),
    sort: { date: p.date, no: p.no, open: p.outstanding },
    node: (
      <tr>
        <td>{day(p.date)}</td>
        <td className="code"><Link href={`/documents/${p.id}`} style={{ color: "var(--link)" }}>{p.no}</Link></td>
        <td>{p.customer}<div className="subline">{p.customerCode}</div></td>
        <td>{name.get(p.courierId) ?? "—"}</td>
        <td className="r">{money(p.outstanding)}</td>
      </tr>
    ),
  }));

  return (
    <>
      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">Out for delivery</span>
          <span className="kpi-value">{moneyOrTrace(totalOut)}</span>
          <span className="kpi-note">{plural(parcels.length, "parcel")}, still owed by customers</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Held by couriers</span>
          <span className="kpi-value">{moneyOrTrace(totalHeld)}</span>
          <span className="kpi-note">in COD Receivable</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Paid in to date</span>
          <span className="kpi-value">{money(totalRemitted)}</span>
          <span className="kpi-note">fees included</span>
        </div>
      </div>

      <section>
        <div className="card">
          <div className="card-head">
            <h2>Couriers</h2>
            <span className="actions">
              <Link href="/partners/new" className="btn ghost">Add courier</Link>
              {anyDue && <Link href="/receivables/couriers/pay" className="btn">Pay in</Link>}
            </span>
          </div>
          <DataTable
            rows={rows}
            emptyLabel="No courier yet. Add a partner with Courier ticked, then choose it under Delivered by on a cash-on-delivery invoice."
            searchPlaceholder="Search couriers…"
            defaultSort={{ key: "held", dir: "desc" }}
            columns={[
              { key: "name", label: "Courier", sortable: true },
              { key: "out", label: "Out for delivery", sortable: true, align: "r" },
              { key: "held", label: "Held", sortable: true, align: "r" },
              { key: "remitted", label: "Paid in", sortable: true, align: "r" },
              { key: "last", label: "Last paid in", sortable: true },
              { key: "actions", label: "" },
            ]}
          />
        </div>
      </section>

      {parcels.length > 0 && (
        <section>
          <div className="card">
            <div className="card-head"><h2>Parcels out</h2><span className="page-sub">{parcels.length} open</span></div>
            <DataTable
              rows={parcelRows}
              emptyLabel="No parcel out."
              searchPlaceholder="Search invoices, customers…"
              defaultSort={{ key: "date", dir: "asc" }}
              columns={[
                { key: "date", label: "Date", sortable: true },
                { key: "no", label: "Invoice", sortable: true },
                { key: "customer", label: "Customer" },
                { key: "courier", label: "Courier" },
                { key: "open", label: "To collect", sortable: true, align: "r" },
              ]}
            />
          </div>
        </section>
      )}
    </>
  );
}

import { ErpPageHead, ErpSection } from "@/components/erp-worklist";
import Link from "next/link";
import { money, shortDate } from "@/lib/format";
import { getCompany, getTrips } from "@/lib/queries";
import { DataTable, type DataRow } from "@/components/data-table";

const toTime = (v: unknown) => (v ? new Date(v as string).getTime() : 0);

const PILL: Record<string, string> = {
  PLANNED: "", DISPATCHED: "ok", CLOSED: "posted", CANCELLED: "warn",
};

export default async function Trips() {
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;

  const trips = (await getTrips(company.id)) as unknown as Array<{
    id: string; trip_no: string; trip_date: string; status: string;
    location_name: string | null; vehicle_code: string | null; plate_no: string | null;
    driver_name: string | null; salesman_name: string | null;
    stops: string; delivered: string; failed: string; pending: string;
    goods_value: string;
  }>;

  const rows: DataRow[] = trips.map((t) => ({
    key: t.id,
    searchText: [t.trip_no, t.driver_name, t.plate_no, t.salesman_name, t.location_name]
      .filter(Boolean).join(" "),
    sort: {
      trip_no: t.trip_no,
      trip_date: toTime(t.trip_date),
      driver_name: t.driver_name ?? "",
      plate_no: t.plate_no ?? "",
      stops: Number(t.stops),
      goods_value: Number(t.goods_value),
      status: t.status,
    },
    node: (
      <tr className="link">
        <td className="code">
          <Link href={`/logistics/trips/${t.id}`} style={{ color: "var(--link)" }}>
            {t.trip_no}
          </Link>
        </td>
        <td className="code">{shortDate(t.trip_date)}</td>
        <td className="wrap">
          {t.driver_name ?? "—"}
          {t.salesman_name && <div className="subline">with {t.salesman_name}</div>}
        </td>
        <td className="code">{t.plate_no ?? "—"}</td>
        <td className="r">{t.stops}</td>
        <td>
          {/* Delivered / failed / still out, rather than one number. The
              evening question is which of the three a stop landed in. */}
          {Number(t.stops) === 0 ? "—" : (
            <span className="subline">
              {t.delivered} delivered
              {Number(t.failed) > 0 && <> · {t.failed} failed</>}
              {Number(t.pending) > 0 && <> · {t.pending} pending</>}
            </span>
          )}
        </td>
        <td className="r">{money(t.goods_value)}</td>
        <td><span className={`pill ${PILL[t.status] ?? ""}`}>{t.status.toLowerCase()}</span></td>
      </tr>
    ),
  }));

  return (
    <div className="erp-page">
      <ErpPageHead eyebrow="Delivery" title="Delivery trips"
        lead="One driver, one day, an ordered list of stops. Each stop shows what to collect; the trip shows the cash to bring back."
        action={<Link href="/logistics/trips/new" className="erp-hbtn">New trip</Link>} />

      <ErpSection title="Trips" count={trips.length}>
          <DataTable
            rows={rows}
            emptyLabel="No trips yet"
            searchPlaceholder="Search trips, drivers, plates…"
            defaultSort={{ key: "trip_date", dir: "desc" }}
            columns={[
              { key: "trip_no", label: "Trip #", sortable: true },
              { key: "trip_date", label: "Date", sortable: true },
              { key: "driver_name", label: "Driver", sortable: true },
              { key: "plate_no", label: "Vehicle", sortable: true },
              { key: "stops", label: "Stops", sortable: true, align: "r" },
              { key: "outcome", label: "Outcome" },
              { key: "goods_value", label: "Goods", sortable: true, align: "r" },
              { key: "status", label: "Status", sortable: true },
            ]}
          />
      </ErpSection>
    </div>
  );
}

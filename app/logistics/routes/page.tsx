import { ErpPageHead, ErpSection } from "@/components/erp-worklist";
import Link from "next/link";
import { getCompany, getRoutes } from "@/lib/queries";
import { DataTable, type DataRow } from "@/components/data-table";

const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const shortDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("en-GB",
    { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }) : "never";

export default async function Routes() {
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;

  const routes = (await getRoutes(company.id)) as unknown as Array<{
    id: string; code: string; name: string; weekdays: number[];
    location_name: string | null; salesman_name: string | null;
    driver_name: string | null; plate_no: string | null;
    stops: string; last_run: string | null; is_active: boolean;
  }>;

  const rows: DataRow[] = routes.map((r) => ({
    key: r.id,
    searchText: [r.code, r.name, r.salesman_name, r.driver_name, r.location_name]
      .filter(Boolean).join(" "),
    sort: {
      code: r.code, name: r.name,
      days: (r.weekdays ?? []).join(","),
      stops: Number(r.stops),
      salesman_name: r.salesman_name ?? "",
      last_run: r.last_run ? new Date(r.last_run).getTime() : 0,
      is_active: r.is_active ? 1 : 0,
    },
    node: (
      <tr className="link">
        <td className="code">
          <Link href={`/logistics/routes/${r.id}`} style={{ color: "var(--link)" }}>
            {r.code}
          </Link>
        </td>
        <td className="wrap">{r.name}</td>
        <td className="code">
          {(r.weekdays ?? []).length === 0
            ? "—"
            : r.weekdays.map((d) => DAYS[d]).join(" ")}
        </td>
        <td className="r">{r.stops}</td>
        <td className="wrap">
          {r.salesman_name ?? "—"}
          {r.driver_name && <div className="subline">{r.driver_name}</div>}
        </td>
        <td className="code">{shortDate(r.last_run)}</td>
        <td>
          {r.is_active
            ? <span className="pill ok">active</span>
            : <span className="pill warn">retired</span>}
        </td>
      </tr>
    ),
  }));

  return (
    <div className="erp-page">
      <ErpPageHead eyebrow="Delivery" title="Routes"
        lead="Regular rounds: the same customers, in the same order, on the same days. Generate a trip from one on the morning it runs."
        action={<Link href="/logistics/routes/new" className="erp-hbtn">New route</Link>} />

      <ErpSection title="Beats" count={routes.length}>
          <DataTable
            rows={rows}
            emptyLabel="No routes yet"
            searchPlaceholder="Search routes…"
            defaultSort={{ key: "code", dir: "asc" }}
            columns={[
              { key: "code", label: "Code", sortable: true },
              { key: "name", label: "Route", sortable: true },
              { key: "days", label: "Runs", sortable: true },
              { key: "stops", label: "Shops", sortable: true, align: "r" },
              { key: "salesman_name", label: "Normally", sortable: true },
              { key: "last_run", label: "Last run", sortable: true },
              { key: "is_active", label: "Status", sortable: true },
            ]}
          />
      </ErpSection>
    </div>
  );
}

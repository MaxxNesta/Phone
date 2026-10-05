import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { sql } from "@/lib/db";
import { NameUnitsForm } from "@/components/name-units-form";

export const metadata = { title: "Add IMEIs" };

/** Phones counted on a shelf that have no IMEI yet, per product and branch. */
export default async function NameUnits({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePermission("inventory.manage");
  const { q } = await searchParams;
  const like = q ? `%${q}%` : null;
  const rows = await sql`
    with lots as (
      select l.item_id, l.location_id,
             l.qty_received
               - coalesce((select sum(c.qty) from stock_lot_consumption c where c.lot_id = l.id), 0)
               - (select count(*) from stock_serial s
                   where s.stock_lot_id = l.id
                     and not exists (select 1 from stock_serial_issue si
                                      where si.serial_id = s.id
                                        and coalesce(si.lot_id, s.stock_lot_id) = s.stock_lot_id
                                        and fn_serial_issue_stands(si.stock_movement_id))) as unnamed
        from stock_lot l
       where l.company_id = ${user.companyId} and l.stock_movement_id is not null)
    select i.id as item_id, i.code, i.name, i.tracks_serial, loc.id as location_id, loc.name as location_name,
           floor(sum(lots.unnamed))::int as unnamed
      from lots join item i on i.id = lots.item_id join location loc on loc.id = lots.location_id
     where (${like}::text is null or i.code ilike ${like} or i.name ilike ${like})
     group by i.id, loc.id
    having floor(sum(lots.unnamed)) > 0
     order by i.tracks_serial desc, i.name, loc.name`;

  return (
    <>
      <div className="page-head">
        <h1>Add IMEIs to stock on hand</h1>
        <p className="page-sub">
          Phones already counted on a shelf without an IMEI. New phones get their IMEIs when you{" "}
          <Link href="/purchases/receive/new" style={{ color: "var(--brand)" }}>receive stock</Link>.
        </p>
      </div>

      <form className="card filters" method="get">
        <div className="card-body filter-row">
          <div className="field">
            <label htmlFor="q">Product</label>
            <input id="q" name="q" defaultValue={q ?? ""} placeholder="Code or name" />
          </div>
          <div className="field filter-go"><button className="btn">Search</button></div>
        </div>
      </form>

      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr><th>Product</th><th>Location</th><th className="num">Without IMEI</th><th>IMEIs</th></tr>
          </thead>
          <tbody>
            {(rows as any[]).map((r) => (
              <tr key={`${r.item_id}-${r.location_id}`}>
                <td>
                  <div className="prod-name">{r.name}</div>
                  <div className="prod-sub">{r.code}{r.tracks_serial ? "" : " · not yet tracked by IMEI"}</div>
                </td>
                <td>{r.location_name}</td>
                <td className="num">{r.unnamed}</td>
                <td style={{ minWidth: 320 }}>
                  <NameUnitsForm itemId={r.item_id} locationId={r.location_id} unnamed={r.unnamed} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="page-sub">Every unit on hand has its IMEI.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

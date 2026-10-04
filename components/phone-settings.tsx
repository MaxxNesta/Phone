import { setItemPhoneSettings } from "@/lib/phone-actions";

/** IMEI tracking and warranty for one item, on its detail page. */
export function PhoneSettings({ item }: {
  item: { id: string; tracks_serial: boolean; warranty_months: number | null;
          supplier_warranty_months: number | null; has_moved: boolean };
}) {
  return (
    <form action={setItemPhoneSettings} className="card" style={{ marginTop: "var(--s3)" }}>
      <div className="card-head"><h2>Phone settings</h2></div>
      <div className="card-body filter-row">
        <input type="hidden" name="id" value={item.id} />
        <label className="pos-check">
          <input type="checkbox" name="tracks_serial" defaultChecked={item.tracks_serial} disabled={item.has_moved} />
          Track each unit by IMEI / serial
        </label>
        {item.has_moved && (
          <input type="hidden" name="tracks_serial_locked" value={item.tracks_serial ? "1" : "0"} />
        )}
        <div className="field">
          <label htmlFor="ps-w">Customer warranty (months)</label>
          <input id="ps-w" name="warranty_months" type="number" min="0" max="120"
            defaultValue={item.warranty_months ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="ps-sw">Supplier warranty (months)</label>
          <input id="ps-sw" name="supplier_warranty_months" type="number" min="0" max="120"
            defaultValue={item.supplier_warranty_months ?? ""} />
        </div>
        <button className="btn">Save</button>
      </div>
      {item.has_moved && (
        <p className="hint" style={{ padding: "0 var(--s3) var(--s3)" }}>
          IMEI tracking is fixed once stock has moved: units already on the shelf have no IMEIs to follow.
        </p>
      )}
    </form>
  );
}

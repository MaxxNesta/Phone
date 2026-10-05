import Link from "next/link";
import { setItemPhoneSettings } from "@/lib/phone-actions";

/** IMEI tracking and warranty for one item, on its detail page. */
export function PhoneSettings({ item }: {
  item: { id: string; tracks_serial: boolean; warranty_months: number | null;
          supplier_warranty_months: number | null; has_moved: boolean;
          variant_count?: number; variants_tracked?: number; variants_moved?: number };
}) {
  const variants = item.variant_count ?? 0;
  return (
    <form action={setItemPhoneSettings} className="card" style={{ marginTop: "var(--s3)" }}>
      <div className="card-head"><h2>Phone settings</h2></div>
      <div className="card-body filter-row">
        <input type="hidden" name="id" value={item.id} />
        <label className="pos-check">
          <input type="checkbox" name="tracks_serial"
            defaultChecked={variants > 0 ? (item.variants_tracked ?? 0) > 0 : item.tracks_serial}
            disabled={variants === 0 && item.has_moved} />
          Track each unit by IMEI / serial{variants > 0 ? ` — all ${variants} variants` : ""}
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
      {variants > 0 && (
        <p className="hint" style={{ padding: "0 var(--s3) var(--s3)" }}>
          {item.variants_tracked} of {variants} variants are tracked by IMEI.
          {(item.variants_moved ?? 0) > 0 && <> {item.variants_moved} already have stock: give those units their IMEIs on{" "}
            <Link href="/inventory/phones/name" style={{ color: "var(--brand)" }}>Add IMEIs to stock on hand</Link>.</>}
        </p>
      )}
      {variants === 0 && item.has_moved && (
        <p className="hint" style={{ padding: "0 var(--s3) var(--s3)" }}>
          This product already has stock. Give the units on the shelf their IMEIs on{" "}
          <Link href="/inventory/phones/name" style={{ color: "var(--brand)" }}>Add IMEIs to stock on hand</Link>{" "}
          — that turns tracking on.
        </p>
      )}
    </form>
  );
}

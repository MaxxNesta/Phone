import { setItemPhoneSettings } from "@/lib/phone-actions";

const LABEL: Record<string, string> = { IMEI: "IMEI", SERIAL: "Serial number", NONE: "Quantity only" };

/** How each unit is named, and the warranties, for one item on its detail page. */
export function PhoneSettings({ item }: {
  item: { id: string; tracks_serial: boolean; identity?: string; warranty_months: number | null;
          supplier_warranty_months: number | null; has_moved: boolean;
          variant_count?: number; variants_tracked?: number; variants_moved?: number };
}) {
  const variants = item.variant_count ?? 0;
  const identity = item.identity ?? (item.tracks_serial ? "IMEI" : "NONE");
  return (
    <form action={setItemPhoneSettings} className="card" style={{ marginTop: "var(--s3)" }}>
      <div className="card-head"><h2>Tracking &amp; warranty</h2></div>
      <div className="card-body filter-row">
        <input type="hidden" name="id" value={item.id} />
        <div className="field">
          <label htmlFor="ps-id">Tracked by{variants > 0 ? ` — all ${variants} variants` : ""}</label>
          <select id="ps-id" name="identity" defaultValue={identity} disabled={variants === 0 && item.has_moved}>
            {Object.entries(LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
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
      <p className="hint" style={{ padding: "0 var(--s3) var(--s3)" }}>
        IMEI for iPhone and cellular iPad or Watch; serial number for Mac, Wi-Fi iPad and AirPods;
        quantity only for accessories. A cellular variant of a serial-number product is tracked by IMEI.
        {variants > 0 && ` ${item.variants_tracked} of ${variants} variants are tracked unit by unit.`}
        {(item.variants_moved ?? 0) > 0 && ` ${item.variants_moved} already have stock history and keep their setting.`}
        {variants === 0 && item.has_moved && " Tracking is fixed once stock has moved: units already on the shelf were never named."}
      </p>
    </form>
  );
}

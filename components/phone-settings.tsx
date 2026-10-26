import { setItemPhoneSettings } from "@/lib/phone-actions";

const LABEL: Record<string, string> = {
  IMEI: "IMEI", SERIAL: "Serial number", OPTIONAL: "Optional serial", NONE: "Quantity only",
};

/** How each unit is named, and the warranties, for one item on its detail page. */
export function PhoneSettings({ item, embedded = false }: {
  /** Inside the item editor's form: its fields only, saved with the rest. */
  embedded?: boolean;
  item: { id: string; tracks_serial: boolean; identity?: string; warranty_months: number | null;
          supplier_warranty_months: number | null; has_moved: boolean;
          variant_count?: number; variants_tracked?: number; variants_moved?: number };
}) {
  const variants = item.variant_count ?? 0;
  const identity = item.identity ?? (item.tracks_serial ? "IMEI" : "NONE");
  return (
    <Wrap embedded={embedded}>
      <div className={embedded ? undefined : "card-head"}>{embedded ? <h3>Tracking &amp; warranty</h3> : <h2>Tracking &amp; warranty</h2>}</div>
      <div className="card-body filter-row">
        <input type="hidden" name="id" value={item.id} />
        <div className="field">
          <label htmlFor="ps-id">Tracked by{variants > 0 ? ` — all ${variants} variants` : ""}</label>
          {/* Once stock has moved, only Optional can still be chosen: it takes
              named and counted units alike, so nothing on the shelf is wrong. */}
          <select id="ps-id" name="identity" defaultValue={identity}
            disabled={variants === 0 && item.has_moved && identity === "OPTIONAL"}>
            {Object.entries(LABEL)
              .filter(([v]) => !(variants === 0 && item.has_moved) || v === identity || v === "OPTIONAL")
              .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
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
        {!embedded && <button className="btn">Save</button>}
      </div>
      <p className="hint" style={{ padding: "0 var(--s3) var(--s3)" }}>
        IMEI for iPhone and cellular iPad or Watch; serial number for Mac, Wi-Fi iPad and AirPods;
        quantity only for accessories. Optional serial records serials when available, e.g. Apple Watch: each receipt
        gives a serial for every unit or just a count.
        A cellular variant of a serial-number product is tracked by IMEI.
        {variants > 0 && ` ${item.variants_tracked} of ${variants} variants are tracked unit by unit.`}
        {(item.variants_moved ?? 0) > 0 && ` ${item.variants_moved} already have stock history and keep their setting, unless the choice is Optional serial.`}
        {variants === 0 && item.has_moved && " Once stock has moved, tracking can only change to Optional serial: units already on the shelf keep how they were recorded."}
      </p>
    </Wrap>
  );
}

const Wrap = ({ embedded, children }: { embedded: boolean; children: React.ReactNode }) => embedded
  ? <section className="ie-card ie-track">{children}</section>
  : <form action={setItemPhoneSettings} className="card" style={{ marginTop: "var(--s3)" }}>{children}</form>;

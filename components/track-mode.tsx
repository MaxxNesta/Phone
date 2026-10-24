"use client";

/**
 * For an item tracked optionally: whether this line names each unit by its
 * serial number or counts them. Shown only for such items; an IMEI or serial
 * item always names, a quantity item never does.
 */
export function TrackMode({ code, on, onChange, note = true }: {
  code: string; on: boolean; onChange: (on: boolean) => void; note?: boolean;
}) {
  return (
    <span className="gr-trackwrap">
      <span className="gr-trackmode" role="radiogroup" aria-label={`How ${code} is recorded`}>
        <button type="button" role="radio" aria-checked={!on} onClick={() => onChange(false)}>By quantity</button>
        <button type="button" role="radio" aria-checked={on} onClick={() => onChange(true)}>Serials</button>
      </span>
      {note && <span className="subline">{on ? "One serial number for every unit." : "Counted, without serial numbers."}</span>}
    </span>
  );
}

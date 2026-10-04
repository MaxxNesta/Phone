import { setSerialHold } from "@/lib/phone-actions";

export function SerialHoldForm({ serialId, held }: { serialId: string; held: string | null }) {
  return (
    <form action={setSerialHold} className="card">
      <div className="card-head"><h2>{held ? `Held: ${held.toLowerCase()}` : "Hold this unit"}</h2></div>
      <div className="card-body filter-row">
        <input type="hidden" name="serial_id" value={serialId} />
        <div className="field">
          <label htmlFor="hold-note">Note</label>
          <input id="hold-note" name="note" placeholder={held ? "Why it is released" : "Customer, ticket, reason"} />
        </div>
        {held ? (
          <button className="btn" name="kind" value="RELEASE">Release</button>
        ) : (
          <>
            <button className="btn" name="kind" value="RESERVED">Reserve</button>
            <button className="btn ghost" name="kind" value="REPAIR">Send to repair</button>
          </>
        )}
      </div>
    </form>
  );
}

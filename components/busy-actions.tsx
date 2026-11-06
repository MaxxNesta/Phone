"use client";

/** Try the same address again, or go back to where the person came from. */
export function BusyActions() {
  return (
    <div className="busy-actions">
      <button type="button" className="ghost" onClick={() => history.back()}>Go back</button>
      <button type="button" onClick={() => location.reload()}>Try again</button>
    </div>
  );
}

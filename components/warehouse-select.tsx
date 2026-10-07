import type { SelectHTMLAttributes } from "react";

type Loc = { id: string; code: string; name: string };

/**
 * The warehouse a document moves stock in. With only one there is nothing
 * to choose, so it is shown fixed rather than offered: nobody can misclick.
 */
export function WarehouseSelect({ locations, ...props }: { locations: Loc[] } & SelectHTMLAttributes<HTMLSelectElement>) {
  if (locations.length === 1) {
    const l = locations[0];
    return (
      <>
        <span id={props.id} className="fixedfield">{l.code} · {l.name}</span>
        <input type="hidden" name={props.name} value={l.id} />
      </>
    );
  }
  return (
    <select {...props}>
      {locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}
    </select>
  );
}

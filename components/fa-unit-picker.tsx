"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
// The register's words, kept here: lib/fixed-assets reads the database and cannot be bundled for the browser.
const FA_STATUS_LABEL = { DRAFT: "Draft", ACTIVE: "Active", FULLY_DEPRECIATED: "Fully depreciated", DISPOSED: "Disposed", INACTIVE: "Inactive" } as const;

/**
 * Which of a group's units a transfer or disposal takes. The choice lives in
 * the address (?unit=…), so the page works out the preview for exactly these
 * units on the server, the same way posting will.
 */
export function UnitPicker({ units, selected, verb }: {
  units: { id: string; code: string; branch: string; status: string }[]; selected: string[]; verb: string;
}) {
  const router = useRouter(), path = usePathname(), params = useSearchParams();
  const go = (ids: string[]) => {
    const q = new URLSearchParams(params.toString());
    q.delete("unit");
    for (const id of ids) q.append("unit", id);
    router.replace(`${path}?${q}`, { scroll: false });
  };
  const all = selected.length === units.length;
  const toggle = (id: string) => go(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <section className="ie-card fau">
      <h3>Select units</h3>
      <p className="ie-note fau-sub">Choose the units to {verb}.</p>
      <table className="ie-table fau-table">
        <thead><tr>
          <th className="fau-check"><input type="checkbox" aria-label="Every unit" checked={all} onChange={() => go(all ? [] : units.map((u) => u.id))} /></th>
          <th>Unit code</th><th>Location</th><th>Status</th>
        </tr></thead>
        <tbody>{units.map((u) => (
          <tr key={u.id} className={selected.includes(u.id) ? "fau-on" : undefined} onClick={() => toggle(u.id)}>
            <td className="fau-check"><input type="checkbox" aria-label={u.code} checked={selected.includes(u.id)} onChange={() => toggle(u.id)} onClick={(e) => e.stopPropagation()} /></td>
            <td className="mono">{u.code}</td><td>{u.branch}</td>
            <td><span className={`fa-status ${u.status.toLowerCase()}`}>{FA_STATUS_LABEL[u.status as keyof typeof FA_STATUS_LABEL] ?? u.status}</span></td>
          </tr>))}</tbody>
      </table>
      <div className="fau-foot">
        <button type="button" className="fau-all" onClick={() => go(units.map((u) => u.id))}>Select all</button>
        <span className="fa-muted">{selected.length} of {units.length} units selected</span>
      </div>
    </section>
  );
}

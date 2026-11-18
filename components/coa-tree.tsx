"use client";

import { useState } from "react";
import type { ActionResult } from "@/lib/actions";
import { AccountRow, type CoaAccount } from "./account-row";

type Action = (prev: unknown, fd: FormData) => Promise<ActionResult>;

/**
 * The chart's rows with each heading foldable. Rows arrive already in tree
 * order with their depth; folding a heading hides everything beneath it,
 * however deep, and unfolding it brings back what was open before.
 */
export function CoaTree({
  rows, accounts, currencies, actions,
}: {
  rows: { id: string; depth: number }[];
  accounts: CoaAccount[];
  currencies: string[];
  actions: { update: Action; deactivate: Action; activate: Action; remove: Action };
}) {
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const shown = new Set(rows.map((r) => r.id));
  const hidden = (a: CoaAccount) => {
    for (let p = a.parent_id; p && shown.has(p); p = byId.get(p)?.parent_id ?? null)
      if (folded.has(p)) return true;
    return false;
  };
  const toggle = (id: string) =>
    setFolded((f) => { const n = new Set(f); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const headings = rows.filter((r) => !byId.get(r.id)!.is_postable).map((r) => r.id);

  // A long chart reads compact by default; the switch is the viewer's.
  const [compact, setCompact] = useState(rows.length > 120);

  /* Tree lines from the drawn order: a row is the last of its siblings when
     no later row at its depth comes before one shallower. Each level left of
     a row carries a pipe while that ancestor still has siblings below. */
  const visible = rows.filter(({ id }) => !hidden(byId.get(id)!));
  const guidesFor = visible.map((r, i) => {
    const lastAt = (depth: number, from: number) => {
      for (let j = from + 1; j < visible.length; j++) {
        if (visible[j].depth < depth) return true;
        if (visible[j].depth === depth) return false;
      }
      return true;
    };
    const g: ("pipe" | "none" | "tee" | "last")[] = [];
    // The ancestor at each level is the nearest earlier row at that depth.
    for (let level = 1; level < r.depth; level++) {
      let k = i; while (k >= 0 && visible[k].depth !== level) k--;
      g.push(k >= 0 && !lastAt(level, k) ? "pipe" : "none");
    }
    if (r.depth > 0) g.push(lastAt(r.depth, i) ? "last" : "tee");
    return g;
  });

  return (
    <div className="tablewrap">
      {headings.length > 0 && (
        <div className="actions" style={{ padding: "0.5rem 1rem" }}>
          <button type="button" className="ghost tiny" onClick={() => setFolded(new Set(headings))}>Collapse all</button>
          <button type="button" className="ghost tiny" onClick={() => setFolded(new Set())}>Expand all</button>
          <button type="button" className="ghost tiny" aria-pressed={compact} onClick={() => setCompact((c) => !c)}>
            {compact ? "Comfortable" : "Compact"}</button>
        </div>
      )}
      <table className={`coa-table${compact ? " compact" : ""}`}>
        <thead>
          <tr>
            <th>Code</th><th>Name</th><th>Type</th><th /><th />
          </tr>
        </thead>
        <tbody>
          {visible.map(({ id, depth }, i) => {
            const a = byId.get(id)!;
            return (
              <AccountRow
                key={id}
                account={a}
                accounts={accounts}
                depth={depth}
                currencies={currencies}
                updateAction={actions.update}
                deactivateAction={actions.deactivate}
                activateAction={actions.activate}
                deleteAction={actions.remove}
                folded={!a.is_postable ? folded.has(id) : undefined}
                onToggle={!a.is_postable ? () => toggle(id) : undefined}
                guides={guidesFor[i]}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

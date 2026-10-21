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

  return (
    <div className="tablewrap">
      {headings.length > 0 && (
        <div className="actions" style={{ padding: "0.5rem 1rem" }}>
          <button type="button" className="ghost tiny" onClick={() => setFolded(new Set(headings))}>Collapse all</button>
          <button type="button" className="ghost tiny" onClick={() => setFolded(new Set())}>Expand all</button>
        </div>
      )}
      <table>
        <thead>
          <tr>
            <th>Code</th><th>Name</th><th>Type</th><th /><th />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ id, depth }) => {
            const a = byId.get(id)!;
            if (hidden(a)) return null;
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
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

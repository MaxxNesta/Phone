"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/actions";

type Option = { id: string; name: string; code: string; depth: number };

/**
 * Reorganising the tree, kept out of the main flow because it is rare.
 * Inserting above lifts a whole branch down a level; moving re-parents it.
 */
export function Restructure({
  categoryId,
  categoryName,
  aboveAction,
  moveAction,
  returnTo,
  targets,
}: {
  categoryId: string;
  categoryName: string;
  aboveAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  moveAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  returnTo: string;
  targets: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"above" | "move">("above");

  const action = tab === "above" ? aboveAction : moveAction;
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never,
    null
  );

  if (!open) {
    return (
      <div className="actions">
        <button type="button" className="ghost tiny" onClick={() => setOpen(true)}>
          Reorganise this category
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Reorganise {categoryName}</h2>
        <span className="actions">
          <button type="button" className={tab === "above" ? "tiny" : "ghost tiny"}
            onClick={() => setTab("above")}>Insert above</button>
          <button type="button" className={tab === "move" ? "tiny" : "ghost tiny"}
            onClick={() => setTab("move")}>Move</button>
          <button type="button" className="ghost tiny" onClick={() => setOpen(false)}>Close</button>
        </span>
      </div>
      <div className="card-body">
        <form action={formAction} className="form">
          {state && "error" in state && <div className="alert">{state.error}</div>}

          {tab === "above" ? (
            <>
              <input type="hidden" name="target_id" value={categoryId} />
              <span className="page-sub">
                Creates a new category in this one&rsquo;s place. {categoryName}, and
                everything beneath it, drops one level down.
              </span>
              <div className="row">
                <div className="field">
                  <label htmlFor="ra_code">Code segment</label>
                  <input id="ra_code" name="segment" type="text" required placeholder="01" />
                  <span className="hint">Everything beneath re-codes to match</span>
                </div>
                <div className="field">
                  <label htmlFor="ra_name">Name</label>
                  <input id="ra_name" name="name" type="text" required placeholder="Food &amp; Drink" />
                </div>
                <div className="field">
                  <label htmlFor="ra_my">Name (Burmese)</label>
                  <input id="ra_my" name="name_my" type="text" />
                </div>
              </div>
            </>
          ) : (
            <>
              <input type="hidden" name="id" value={categoryId} />
              <span className="page-sub">
                Everything beneath {categoryName} moves with it.
              </span>
              <div className="field">
                <label htmlFor="rm_parent">Put it under</label>
                <select id="rm_parent" name="new_parent_id" defaultValue="">
                  <option value="">Nothing — make it a top-level parent</option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {" ".repeat(t.depth * 2)}{t.depth > 0 ? "└ " : ""}{t.name} ({t.code})
                    </option>
                  ))}
                </select>
                <span className="hint">
                  Its own branch is excluded — that would detach the tree.
                </span>
              </div>
            </>
          )}

          <input type="hidden" name="return_to" value={returnTo} />

          <div className="actions">
            <button type="submit" disabled={pending}>
              {pending ? "Saving…" : tab === "above" ? "Insert above" : "Move category"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

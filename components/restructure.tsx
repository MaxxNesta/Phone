"use client";

import { useActionState, useEffect, useState } from "react";
import type { ActionResult } from "@/lib/actions";
import { categoryCodeTakenBy } from "@/lib/item-code-actions";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("categories");
  const c = useTranslations("common");
  const f = useTranslations("itemForm");
  const [tab, setTab] = useState<"above" | "move">("above");

  // The category inserted above sits at the top level, so its code is its
  // segment. Is that already a category's? Asked as it is typed.
  const [segment, setSegment] = useState("");
  const [takenBy, setTakenBy] = useState<string | null>(null);
  useEffect(() => {
    setTakenBy(null);
    if (!segment) return;
    let stale = false;
    const t = window.setTimeout(() => {
      categoryCodeTakenBy(segment).then((n) => { if (!stale) setTakenBy(n); }).catch(() => {});
    }, 300);
    return () => { stale = true; window.clearTimeout(t); };
  }, [segment]);

  const action = tab === "above" ? aboveAction : moveAction;
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never,
    null
  );

  if (!open) {
    return (
      <div className="actions">
        <button type="button" className="ghost tiny" onClick={() => setOpen(true)}>
          {t("reorganise")}
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>{t("reorganiseName", { name: categoryName })}</h2>
        <span className="actions">
          <button type="button" className={tab === "above" ? "tiny" : "ghost tiny"}
            onClick={() => setTab("above")}>{t("insertAbove")}</button>
          <button type="button" className={tab === "move" ? "tiny" : "ghost tiny"}
            onClick={() => setTab("move")}>{t("move")}</button>
          <button type="button" className="ghost tiny" onClick={() => setOpen(false)}>{c("close")}</button>
        </span>
      </div>
      <div className="card-body">
        <form action={formAction} className="form">
          {state && "error" in state && <div className="alert">{state.error}</div>}

          {tab === "above" ? (
            <>
              <input type="hidden" name="target_id" value={categoryId} />
              <span className="page-sub">
                {t("insertAboveNote", { name: categoryName })}
              </span>
              <div className="row">
                <div className="field">
                  <label htmlFor="ra_code">{t("codeSegment")}</label>
                  <input id="ra_code" name="segment" type="text" required placeholder="01"
                    value={segment} onChange={(e) => setSegment(e.target.value)}
                    aria-invalid={takenBy ? true : undefined}
                    style={takenBy ? { borderColor: "var(--bad)" } : undefined} />
                  {takenBy ? (
                    <span className="hint" role="alert" style={{ color: "var(--bad)" }}>
                      {t("codeTaken", { code: segment.toUpperCase(), name: takenBy })}
                    </span>
                  ) : (
                    <span className="hint">{t("recodes")}</span>
                  )}
                </div>
                <div className="field">
                  <label htmlFor="ra_name">{c("name")}</label>
                  <input id="ra_name" name="name" type="text" required placeholder="Food &amp; Drink" />
                </div>
                <div className="field">
                  <label htmlFor="ra_my">{f("nameBurmese")}</label>
                  <input id="ra_my" name="name_my" type="text" />
                </div>
              </div>
            </>
          ) : (
            <>
              <input type="hidden" name="id" value={categoryId} />
              <span className="page-sub">
                {t("movesWith", { name: categoryName })}
              </span>
              <div className="field">
                <label htmlFor="rm_parent">{t("putUnder")}</label>
                <select id="rm_parent" name="new_parent_id" defaultValue="">
                  <option value="">{t("topLevel")}</option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {" ".repeat(t.depth * 2)}{t.depth > 0 ? "└ " : ""}{t.name} ({t.code})
                    </option>
                  ))}
                </select>
                <span className="hint">
                  {t("ownBranch")}
                </span>
              </div>
            </>
          )}

          <input type="hidden" name="return_to" value={returnTo} />

          <div className="actions">
            <button type="submit" disabled={pending || (tab === "above" && !!takenBy)}>
              {pending ? c("saving") : tab === "above" ? t("insertAbove") : t("moveCategory")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

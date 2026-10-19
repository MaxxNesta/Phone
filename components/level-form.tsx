"use client";

import { useActionState, useEffect, useState } from "react";
import type { ActionResult } from "@/lib/actions";
import { categoryCodeTakenBy } from "@/lib/item-code-actions";
import { useTranslations } from "next-intl";

type Uom = { id: string; code: string; name: string };
type ParentOption = { id: string; code: string; name: string };

/**
 * Add a category at the level currently being viewed — or, when `categories`
 * is passed instead of a fixed `parentId`, add a sub category from a flat
 * list that isn't already scoped to one parent, with a dropdown to choose
 * which category it goes under.
 */
export function AddCategoryForm({
  action,
  parentId,
  parentCode,
  categories,
  returnTo,
  label,
  codeHint,
  nameHint,
}: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  parentId?: string | null;
  parentCode?: string;
  /** Categories to choose a parent from, when there isn't already one fixed parent. */
  categories?: ParentOption[];
  returnTo: string;
  label: string;
  codeHint: string;
  nameHint: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never,
    null
  );
  const [open, setOpen] = useState(false);
  const [segment, setSegment] = useState("");
  const [chosenParentId, setChosenParentId] = useState(categories?.[0]?.id ?? "");

  const choosingParent = categories !== undefined;
  const effectiveParentCode = choosingParent
    ? categories?.find((c) => c.id === chosenParentId)?.code
    : parentCode;

  const composed = `${effectiveParentCode ?? ""}${segment}`;

  const nothingToChooseFrom = choosingParent && categories?.length === 0;

  // Is the code already a category's? Asked as the segment is typed, so the
  // answer is on screen before Save.
  const t = useTranslations("categories");
  const c = useTranslations("common");
  const f = useTranslations("itemForm");
  const [takenBy, setTakenBy] = useState<string | null>(null);
  useEffect(() => {
    setTakenBy(null);
    if (!segment) return;
    let stale = false;
    const t = window.setTimeout(() => {
      categoryCodeTakenBy(composed).then((n) => { if (!stale) setTakenBy(n); }).catch(() => {});
    }, 300);
    return () => { stale = true; window.clearTimeout(t); };
  }, [composed, segment]);

  if (!open) {
    return (
      <div className="actions">
        <button type="button" onClick={() => setOpen(true)} disabled={nothingToChooseFrom}>
          {t("addLabel", { label })}
        </button>
        {nothingToChooseFrom && (
          <span className="page-sub">{t("needCategoryFirst")}</span>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>{t("newLabel", { label: label.toLowerCase() })}</h2>
        <span className="actions">
          {segment && (
            <span className="m" style={{ color: "var(--link)" }}>{t("codeWillBe", { code: composed })}</span>
          )}
          <button type="button" className="ghost tiny" onClick={() => setOpen(false)}>{c("cancel")}</button>
        </span>
      </div>
      <div className="card-body">
        <form action={formAction} className="form">
          {state && "error" in state && <div className="alert">{state.error}</div>}
          {!choosingParent && <input type="hidden" name="parent_id" value={parentId ?? ""} />}
          <input type="hidden" name="return_to" value={returnTo} />

          <div className="row">
            {choosingParent && (
              <div className="field">
                <label htmlFor="parent_id">{c("category")}</label>
                <select id="parent_id" name="parent_id" value={chosenParentId}
                  onChange={(e) => setChosenParentId(e.target.value)} required>
                  {categories?.length === 0 && <option value="">{t("noCategoriesYet")}</option>}
                  {categories?.map((c) => (
                    <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="field">
              <label htmlFor="segment">{t("codeSegment")}</label>
              <input id="segment" name="segment" type="text" required autoFocus
                value={segment} onChange={(e) => setSegment(e.target.value)}
                placeholder={codeHint}
                aria-invalid={takenBy ? true : undefined}
                style={takenBy ? { borderColor: "var(--bad)" } : undefined} />
              {takenBy ? (
                <span className="hint" role="alert" style={{ color: "var(--bad)" }}>
                  {t("codeTaken", { code: composed, name: takenBy })}
                </span>
              ) : (
                <span className="hint">
                  {effectiveParentCode
                    ? t("addedToParent", { code: effectiveParentCode })
                    : t("startOfCodes")}
                </span>
              )}
            </div>
            <div className="field">
              <label htmlFor="name">{c("name")}</label>
              <input id="name" name="name" type="text" required placeholder={nameHint} />
            </div>
            <div className="field">
              <label htmlFor="name_my">{f("nameBurmese")}</label>
              <input id="name_my" name="name_my" type="text" />
            </div>
          </div>

          <div className="actions">
            <button type="submit" disabled={pending || !!takenBy}>{pending ? c("saving") : t("saveLabel", { label: label.toLowerCase() })}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

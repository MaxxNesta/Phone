"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown, X, Plus, Pencil } from "lucide-react";
import type { ActionResult } from "@/lib/actions";
import { useTranslations } from "next-intl";

export type Option = {
  id: string; code: string; name: string; sort_order: number; used: number;
  /** What it physically is (42mm) — compared when looking for similar variants. */
  physical_value?: string; physical_is_manual?: boolean;
};
export type Attribute = {
  id: string; code: string; name: string; name_my: string | null;
  is_active: boolean; products: number; options: Option[];
};

/**
 * One way products vary, and the values it can take.
 *
 * A card each rather than one flat table, because an attribute without its
 * values says nothing: "Size" is only meaningful as S, M, L, XL, and the
 * order those read in is part of what is being maintained.
 */
export function AttributeCard({
  attribute, addOption, removeOption, moveOption, updateOption, update, remove,
}: {
  attribute: Attribute;
  addOption: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  removeOption: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  moveOption: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  updateOption: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  update: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  remove: (prev: unknown, fd: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const t = useTranslations("attributes");
  const c = useTranslations("common");
  const [value, setValue] = useState("");
  /** Which value is being renamed, and whether the attribute itself is.
   *  One at a time — two open inputs is two half-finished edits. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renamingAttr, setRenamingAttr] = useState(false);

  const [addRes, addAction, adding] =
    useActionState<ActionResult | null, FormData>(addOption as never, null);
  const [rmRes, rmAction] =
    useActionState<ActionResult | null, FormData>(removeOption as never, null);
  const [mvRes, mvAction] =
    useActionState<ActionResult | null, FormData>(moveOption as never, null);
  const [upRes, upAction] =
    useActionState<ActionResult | null, FormData>(update as never, null);
  const [delRes, delAction] =
    useActionState<ActionResult | null, FormData>(remove as never, null);
  const [edRes, edAction] =
    useActionState<ActionResult | null, FormData>(updateOption as never, null);

  useEffect(() => {
    const done = [addRes, rmRes, mvRes, upRes, delRes, edRes].some((r) => r && "ok" in r);
    if (done) { setValue(""); setRenaming(null); setRenamingAttr(false); router.refresh(); }
  }, [addRes, rmRes, mvRes, upRes, delRes, edRes, router]);

  const problem = [addRes, rmRes, mvRes, upRes, delRes, edRes]
    .find((r) => r && "error" in r) as { error: string } | undefined;

  const last = attribute.options.length - 1;

  return (
    <div className="card attrcard">
      <div className="card-head">
        {renamingAttr ? (
          <form action={upAction} className="optrow-edit">
            <input type="hidden" name="id" value={attribute.id} />
            {/* Carried through, or updateVariantAttribute reads its absence
                as "switch this off" and a rename would deactivate it. */}
            {attribute.is_active && <input type="hidden" name="is_active" value="1" />}
            <input name="name" defaultValue={attribute.name} autoFocus
                   aria-label={t("renameName", { name: attribute.name })} />
            <input name="name_my" defaultValue={attribute.name_my ?? ""}
                   placeholder={t("burmese")} aria-label={t("nameInBurmese")} />
            <button type="submit" className="btn tiny">{c("save")}</button>
            <button type="button" className="btn ghost tiny"
                    onClick={() => setRenamingAttr(false)}>{c("cancel")}</button>
          </form>
        ) : (
        <h2>
          {attribute.name}
          {!attribute.is_active && (
            <span className="pill" style={{ marginLeft: "0.5rem" }}>{t("off")}</span>
          )}
        </h2>
        )}
        <span className="page-sub">
          <span className="m">{attribute.code}</span>
          {" · "}
          {attribute.products === 0
            ? t("notUsed")
            : t("products", { n: attribute.products })}
        </span>
      </div>

      <div className="card-body">
        {problem && <div className="alert">{problem.error}</div>}

        {attribute.options.length === 0 ? (
          <p className="hint">
            {t("noValues")}
          </p>
        ) : (
          <ul className="optlist">
            {attribute.options.map((o, i) => (
              <li key={o.id} className="optrow">
                {renaming === o.id ? (
                  <form action={edAction} className="optrow-edit">
                    <input type="hidden" name="id" value={o.id} />
                    <input name="name" defaultValue={o.name} autoFocus
                           aria-label={t("renameName", { name: o.name })} />
                    {/* The code built the SKU of every variant already
                        carrying it, and those are stored strings. Editable
                        only while nothing depends on it. */}
                    <input name="code" defaultValue={o.code} disabled={o.used > 0}
                           aria-label={t("codeFor", { name: o.name })} className="m"
                           title={o.used > 0
                             ? t("codeFixed", { n: o.used })
                             : t("codeUsed")} />
                    <input name="physical_value" defaultValue={o.physical_is_manual ? o.physical_value : ""}
                           placeholder={`Physical: ${o.physical_value ?? "auto"}`} className="m optrow-phys"
                           aria-label={`Physical value of ${o.name}`}
                           title="What this value physically is, e.g. 42mm for 42. Leave blank to work it out automatically." />
                    <button type="submit" className="btn tiny">{c("save")}</button>
                    <button type="button" className="btn ghost tiny"
                            onClick={() => setRenaming(null)}>{c("cancel")}</button>
                  </form>
                ) : (
                <>
                <span className="optrow-name">
                  {o.name}
                  {o.name !== o.code && <span className="m optrow-code">{o.code}</span>}
                  {o.physical_value && o.physical_value !== o.name.toLowerCase() && (
                    <span className="m optrow-code" title="What this value physically is">= {o.physical_value}</span>
                  )}
                  {o.used > 0 && (
                    <span className="subline">
                      {t("variants", { n: o.used })}
                    </span>
                  )}
                </span>
                <button type="button" className="btn ghost tiny"
                        onClick={() => setRenaming(o.id)}
                        aria-label={t("renameName", { name: o.name })}>
                  <Pencil size={12} aria-hidden="true" />
                </button>
                {/* Hand ordered, because S/M/L/XL is not alphabetical and
                    the list is read in the order it is kept. */}
                <form action={mvAction} className="optrow-move">
                  <input type="hidden" name="id" value={o.id} />
                  <input type="hidden" name="direction" value="up" />
                  <button type="submit" className="btn ghost tiny" disabled={i === 0}
                          aria-label={t("moveUp", { name: o.name })}>
                    <ChevronUp size={13} aria-hidden="true" />
                  </button>
                </form>
                <form action={mvAction}>
                  <input type="hidden" name="id" value={o.id} />
                  <input type="hidden" name="direction" value="down" />
                  <button type="submit" className="btn ghost tiny" disabled={i === last}
                          aria-label={t("moveDown", { name: o.name })}>
                    <ChevronDown size={13} aria-hidden="true" />
                  </button>
                </form>
                <form action={rmAction}>
                  <input type="hidden" name="id" value={o.id} />
                  <button type="submit" className="btn ghost tiny"
                          aria-label={t("remove", { name: o.name })}>
                    <X size={13} aria-hidden="true" />
                  </button>
                </form>
                </>
                )}
              </li>
            ))}
          </ul>
        )}

        <form action={addAction} className="optadd">
          <input type="hidden" name="attribute_id" value={attribute.id} />
          <input
            name="code" value={value} onChange={(e) => setValue(e.target.value)}
            placeholder={attribute.code === "SIZE" ? "M" : "Red"}
            aria-label={t("newValue", { name: attribute.name })}
          />
          <button type="submit" className="btn ghost" disabled={!value.trim() || adding}>
            <Plus size={13} aria-hidden="true" /> {t("add")}
          </button>
        </form>

        <div className="attrcard-foot">
          <button type="button" className="btn ghost tiny"
                  onClick={() => setRenamingAttr(true)}>{t("rename")}</button>
          <form action={upAction}>
            <input type="hidden" name="id" value={attribute.id} />
            <input type="hidden" name="name" value={attribute.name} />
            {!attribute.is_active && <input type="hidden" name="is_active" value="1" />}
            <button type="submit" className="btn ghost tiny">
              {attribute.is_active ? t("switchOff") : t("switchOn")}
            </button>
          </form>
          {attribute.products === 0 && (
            <form action={delAction}>
              <input type="hidden" name="id" value={attribute.id} />
              <button type="submit" className="btn ghost tiny">{c("delete")}</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { Fragment, useActionState, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ActionResult } from "@/lib/actions";
import { ConfirmDelete } from "./confirm-delete";
import { RowMenu } from "./row-menu";
import { ItemPhotoField } from "./item-photo-field";
import { ItemThumb } from "./item-thumb";
import { VariantTags, type VariantPart } from "./variant-tags";
import { useTranslations } from "next-intl";

// lib/db.ts opens a real Postgres connection at import time — never import
// it into a client component. Same formatting as money() there, kept local.
const money = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

type Item = {
  id: string; code: string; name: string; name_my: string | null;
  item_group_id: string; brand_id: string | null; base_uom_id: string;
  group_name: string; parent_group_name: string | null; brand_name: string | null;
  uom_code: string; is_stocked: boolean; is_active: boolean; sale_price: string | null;
  photo_version?: string | null;
  /** The packs this item is bought and sold in, each holding so many base
   *  units. Empty for an item handled only in its own unit. */
  packs?: { uomId: string; code?: string; factor: number }[];
  last_purchase_price?: string | null;
  last_purchase_doc_no?: string | null;
  last_purchase_date?: string | null;
};

export type RowVariant = {
  id: string; code: string; name: string;
  barcode: string | null; qty_on_hand: number; is_active: boolean;
  /** Each variant carries its own, because a red shirt and a black one are
   *  two things and one picture on the parent would be wrong for one. */
  photo_version: string | null;
  /** What it is, with the attribute kept beside each value. */
  variant_parts: VariantPart[] | null;
};

export function ItemRow({
  item,
  deleteAction,
  deactivateAction,
  activateAction,
  setPhotoAction,
  variants = [],
  showBrand = true,
  showPhoto = true,
}: {
  /** Off when nothing in the list has a photo, so no empty column is kept for one. */
  showPhoto?: boolean;
  /** Hidden while the shop carries a single brand. */
  showBrand?: boolean;
  item: Item;
  /** The things on the shelf, where this row is a product that varies.
   *  Empty for an ordinary item, which is nearly every row. */
  variants?: RowVariant[];
  deleteAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  deactivateAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  activateAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  /** Sets one variant's picture. Only a photo — a variant row has no other
   *  form behind it. */
  setPhotoAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
}) {
  const c = useTranslations("common");
  const t = useTranslations("items");
  const dtl = useTranslations("itemDetail");
  const ph = useTranslations("photo");
  const [open, setOpen] = useState(false);
  /** Which variant's photo is being changed, if any. One at a time: the
   *  panel is a file picker and two open at once is two answers to one
   *  question. */
  const [photoFor, setPhotoFor] = useState<string | null>(null);
  const [photoRes, photoFormAction, photoPending] =
    useActionState<ActionResult | null, FormData>(setPhotoAction as never, null);
  const [, deactFormAction] = useActionState<ActionResult | null, FormData>(
    deactivateAction as never,
    null
  );
  const [, actFormAction] = useActionState<ActionResult | null, FormData>(
    activateAction as never,
    null
  );
  const [delState, delFormAction, delPending] = useActionState<ActionResult | null, FormData>(
    deleteAction as never,
    null
  );


  return (
    <>
    <tr>
      {showPhoto && (
        <td className="thumbcell">
          <ItemThumb
            src={item.photo_version ? `/items/${item.id}/photo?v=${item.photo_version}` : null}
            name={item.name}
          />
        </td>
      )}
      <td className="code">
        {/* A product that varies opens to show what it varies into. The
            twelve rows are still twelve items; this is only whether the
            catalogue lists them all at once. */}
        {variants.length > 0 && (
          <button type="button" className="stmt-toggle" onClick={() => setOpen(!open)}
                  aria-expanded={open} aria-label={t("variantsOf", { n: variants.length, code: item.code })}>
            <ChevronRight size={13} aria-hidden="true"
                          style={{ transform: open ? "rotate(90deg)" : "none" }} />
          </button>
        )}
        <Link href={`/items/categories/${item.item_group_id}`} style={{ color: "var(--link)" }}>
          {item.code}
        </Link>
      </td>
      <td className="wrap">
        {item.name}
        {item.name_my && <div className="subline">{item.name_my}</div>}
        {!item.is_stocked && <> <span className="pill">{dtl("service")}</span></>}
        {!item.is_active && <> <span className="pill warn">{dtl("inactive")}</span></>}
      </td>
      <td style={{ color: "var(--muted)" }}>
        {item.parent_group_name ?? item.group_name}
      </td>
      <td style={{ color: "var(--muted)" }}>
        {item.parent_group_name ? item.group_name : "—"}
      </td>
      {showBrand && <td style={{ color: "var(--muted)" }}>{item.brand_name ?? "—"}</td>}
      {/* The base unit, and what else this item is bought and sold in.
          Pack sizes lived only inside Edit, so the catalogue could not
          answer "which of these come by the carton" without opening every
          row one at a time. */}
      <td className="code">
        {item.uom_code}
        {(item.packs ?? []).length > 0 && (
          <div className="subline">
            {(item.packs ?? [])
              .map((p) => `1 ${p.code ?? "?"} = ${Number(p.factor)} ${item.uom_code}`)
              .join(" · ")}
          </div>
        )}
      </td>
      <td className="r">{item.sale_price ? money(item.sale_price) : "—"}</td>
      {/* Derived, never stored: the price on the newest posted purchase
          invoice. The document it came from is shown underneath, because a
          figure with no provenance invites being read as "the" cost. */}
      <td className="r">
        {item.last_purchase_price ? money(item.last_purchase_price) : "—"}
        {item.last_purchase_doc_no && (
          <div className="subline" style={{ color: "var(--muted)" }}>
            {item.last_purchase_doc_no}
            {item.last_purchase_date ? ` · ${item.last_purchase_date}` : ""}
          </div>
        )}
      </td>
      <td className="r">
        <RowMenu label={c("actionsFor", { name: item.name })}>
          <Link href={`/items/${item.id}/edit`} role="menuitem">{c("edit")}</Link>
          {item.is_active ? (
            <form action={deactFormAction}>
              <input type="hidden" name="id" value={item.id} />
              <button type="submit" className="warn">{c("deactivate")}</button>
            </form>
          ) : (
            <form action={actFormAction}>
              <input type="hidden" name="id" value={item.id} />
              <button type="submit">{c("reactivate")}</button>
            </form>
          )}
          <div className="rowmenu-sep" />
          <ConfirmDelete
            action={delFormAction}
            pending={delPending}
            error={delState && "error" in delState ? delState.error : null}
            title={c("deleteName", { name: item.name })}
            detail={c("cannotUndo")}
            className="danger"
          >
            <input type="hidden" name="id" value={item.id} />
          </ConfirmDelete>
        </RowMenu>
        {delState && "error" in delState && (
          <div className="hint" style={{ color: "var(--bad)" }}>{delState.error}</div>
        )}
      </td>
    </tr>

    {open && variants.length > 0 && (
      <tr className="variantrow">
        <td />
        <td colSpan={showBrand ? 9 : 8}>
          {/* Where somebody already is when they notice the twelve sizes
              they just made have no barcodes on them. */}
          <Link href={`/items/${item.id}/variants`} className="linkbtn">
            {t("editAllVariants", { n: variants.length })}
          </Link>
        </td>
      </tr>
    )}

    {open && variants.map((v) => (
      <Fragment key={v.id}>
        <tr className="variantrow">
          {showPhoto && (
            <td className="variantrow-thumb">
              <ItemThumb
                src={v.photo_version ? `/items/${v.id}/photo?v=${v.photo_version}` : null}
                name={v.name}
              />
            </td>
          )}
          <td className="code">{v.code}</td>
          <td className="wrap">
            {v.name}
            <VariantTags variant={v.variant_parts} className="vartags-inline" />
            {!v.is_active && <span className="pill" style={{ marginLeft: "0.4rem" }}>{t("off")}</span>}
            <div className="subline">
              {v.barcode ? <span className="m">{v.barcode}</span> : t("noBarcode")}
              {" \u00b7 "}{t("onHand", { n: v.qty_on_hand })}
              {" \u00b7 "}
              <button type="button" className="linkbtn"
                      onClick={() => setPhotoFor(photoFor === v.id ? null : v.id)}>
                {v.photo_version ? ph("change") : t("addPhoto")}
              </button>
            </div>
          </td>
          {/* Category, brand and unit are the product's, not the variant's,
              and repeating them down twelve rows says nothing twelve times.
              The table has no barcode or quantity column, so those ride under
              the name rather than being put in somebody else's. */}
          <td colSpan={showBrand ? 7 : 6} />
        </tr>

        {photoFor === v.id && (
          <tr className="variantrow">
            <td />
            <td colSpan={showBrand ? 9 : 8}>
              {photoRes && "error" in photoRes && (
                <div className="alert">{photoRes.error}</div>
              )}
              <form action={photoFormAction} className="variantphoto">
                <input type="hidden" name="id" value={v.id} />
                <ItemPhotoField
                  label={t("photoOf", { name: v.name })}
                  currentSrc={
                    v.photo_version ? `/items/${v.id}/photo?v=${v.photo_version}` : null
                  }
                />
                <div className="actions">
                  <button type="submit" disabled={photoPending}>
                    {photoPending ? c("saving") : t("savePhoto")}
                  </button>
                  <button type="button" className="ghost tiny"
                          onClick={() => setPhotoFor(null)}>{c("cancel")}</button>
                </div>
              </form>
            </td>
          </tr>
        )}
      </Fragment>
    ))}
    </>
  );
}


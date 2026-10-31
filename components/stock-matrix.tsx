"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LabelList,
} from "recharts";
import { ItemThumb } from "./item-thumb";
import { variantPhotos } from "@/lib/variants";
import type { VariantStockRow } from "./variant-stock";

/**
 * One product at a time, as a grid.
 *
 * The folded views answer "how much red"; this answers "how much red in M",
 * which is the question standing in front of a rail deciding what to
 * reorder. A grid is the only shape that answers it without arithmetic:
 * sizes across, colours down, and the gap you are looking for is the cell
 * that reads nothing.
 *
 * Only combinations that exist are shown. A catalogue of eight colours and
 * six sizes would otherwise be forty-eight cells mostly holding a dash, and
 * the dashes would be louder than the figures.
 */

const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** Distinct enough at a glance, and none of them the debit or credit ink. */
const SLICES = ["#3B6FD4", "#2E9E6B", "#C2610A", "#6C5CE0", "#C0392B", "#0E7C86",
                "#B8860B", "#7D4F9E"];

export function StockMatrix({
  rows, productId, basePath, keep = {},
}: {
  rows: VariantStockRow[];
  productId?: string;
  basePath: string;
  keep?: Record<string, string | undefined>;
}) {
  const t = useTranslations("inventory");
  const withParts = useMemo(
    () => rows.filter((r) => r.parts && r.parts.length > 0), [rows]);

  /** One entry per product that has variants, in code order. */
  const products = useMemo(() => {
    const m = new Map<string, { id: string; code: string; name: string;
                                category: string; unit: string;
                                variants: VariantStockRow[] }>();
    for (const r of withParts) {
      const e = m.get(r.parent_item_id) ?? {
        id: r.parent_item_id, code: r.parent_code, name: r.parent_name,
        category: r.category_name, unit: r.uom_code, variants: [],
      };
      e.variants.push(r);
      m.set(r.parent_item_id, e);
    }
    return [...m.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [withParts]);

  const photos = useMemo(() => variantPhotos(withParts), [withParts]);

  /**
   * Which product opens first.
   *
   * The one with the most combinations, not the first alphabetically. A
   * grid is worth looking at in proportion to how many cells it has, and
   * landing on a shirt that comes in two colours and nothing else makes
   * the whole view look pointless.
   */
  const busiest = products.reduce(
    (a, b) => (b.variants.length > a.variants.length ? b : a), products[0]);
  const selected = products.find((p) => p.id === productId) ?? busiest;

  const href = (id: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) q.set(k, v);
    q.set("view", "matrix");
    q.set("product", id);
    return `${basePath}?${q.toString()}`;
  };

  if (products.length === 0) {
    return (
      <div className="empty">
        {t("mat.noVariants")}
      </div>
    );
  }

  return (
    <div className="matrixlayout">
      {/* Which product. A list rather than a dropdown: the pictures are the
          fastest way to find a garment, and a select cannot show them. */}
      <aside className="card matrixpick">
        <div className="card-head"><h2>{t("mat.products")}</h2></div>
        <div className="matrixpick-list">
          {products.map((p) => {
            const shot = photos.pictureFor(p.variants[0]);
            const total = p.variants.reduce((s, v) => s + Number(v.qty_on_hand), 0);
            return (
              <Link key={p.id} scroll={false} href={href(p.id)} className="matrixpick-row"
                    data-active={p.id === selected.id || undefined}>
                <ItemThumb
                  src={shot ? `/items/${shot.id}/photo?v=${shot.photo_version}` : null}
                  name={p.name}
                />
                <span className="matrixpick-text">
                  <span className="m">{p.code}</span>
                  <strong>{p.name}</strong>
                  <span className="page-sub">
                    {t("var.nVariants", { n: p.variants.length })}
                    {` · ${qty(total)} ${p.unit}`}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </aside>

      <ProductMatrix key={selected.id} product={selected} photos={photos} />
    </div>
  );
}

function ProductMatrix({
  product, photos,
}: {
  product: { id: string; code: string; name: string; category: string;
             unit: string; variants: VariantStockRow[] };
  photos: ReturnType<typeof variantPhotos>;
}) {
  const t = useTranslations("inventory");
  const vs = product.variants;

  // The attributes this product varies by, in its declared order.
  const attrs = useMemo(() => {
    const m = new Map<string, { id: string; code?: string; name: string; sort: number }>();
    for (const v of vs) for (const p of v.parts!) {
      if (!m.has(p.attributeId)) {
        m.set(p.attributeId, { id: p.attributeId, code: p.attributeCode, name: p.attribute, sort: p.attributeSort });
      }
    }
    return [...m.values()].sort((a, b) => a.sort - b.sort);
  }, [vs]);

  /** Colour down the side, storage across the top: the two things a phone
   *  is asked for by. Anything else it varies by (region, activation) is
   *  added together inside the cell rather than given rows of its own, which
   *  would multiply the grid by every region. A product without a colour or
   *  a storage falls back to the attribute with the pictures, then the rest. */
  const rowAttr = attrs.find((a) => a.code === "COL")
    ?? attrs.find((a) => a.id === photos.photoAttributeId)
    ?? attrs[attrs.length - 1];
  const colAttr = attrs.find((a) => a.code === "STO" && a.id !== rowAttr.id)
    ?? attrs.find((a) => a.id !== rowAttr.id) ?? null;

  const optionsOf = (attributeId: string) => {
    const m = new Map<string, { id: string; label: string; sort: number }>();
    for (const v of vs) {
      const p = v.parts!.find((x) => x.attributeId === attributeId);
      if (p && !m.has(p.optionId)) {
        m.set(p.optionId, { id: p.optionId, label: p.option, sort: p.optionSort });
      }
    }
    return [...m.values()].sort((a, b) => a.sort - b.sort);
  };

  const rowOpts = optionsOf(rowAttr.id);
  const colOpts = colAttr ? optionsOf(colAttr.id) : [];

  const has = (v: VariantStockRow, optId: string) => v.parts!.some((p) => p.optionId === optId);
  /** Every variant in a cell, or null where that combination was never created. */
  const cell = (rowOptId: string, colOptId: string | null) => {
    const list = vs.filter((v) => has(v, rowOptId) && (colOptId === null || has(v, colOptId)));
    return list.length ? list : null;
  };

  const sumOf = (list: VariantStockRow[]) =>
    list.reduce((s, v) => s + Number(v.qty_on_hand), 0);

  const rowTotal = (optId: string) => sumOf(vs.filter((v) => has(v, optId)));
  const colTotal = rowTotal;
  const grand = sumOf(vs);

  const byRow = rowOpts.map((o) => ({ name: o.label, qty: rowTotal(o.id) }));
  const byCol = colOpts.map((o) => ({ name: o.label, qty: colTotal(o.id) }));
  const shot = photos.pictureFor(vs[0]);
  const missing = colAttr
    ? rowOpts.reduce((n, r) => n + colOpts.filter((c) => !cell(r.id, c.id)).length, 0)
    : 0;

  return (
    <div className="matrixmain">
      <div className="card">
        <div className="card-body matrixhead">
          <ItemThumb
            src={shot ? `/items/${shot.id}/photo?v=${shot.photo_version}` : null}
            name={product.name}
          />
          <div className="matrixhead-text">
            <div className="matrixhead-title">
              <span className="m">{product.code}</span>
              <strong>{product.name}</strong>
            </div>
            <span className="page-sub">
              {t("mat.headSub", { category: product.category, unit: product.unit,
                variants: t("var.nVariants", { n: vs.length }), qty: qty(grand) })}
            </span>
          </div>
        </div>

        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>{colAttr ? `${rowAttr.name} / ${colAttr.name}` : rowAttr.name}</th>
                {colOpts.map((c) => <th key={c.id} className="r">{c.label}</th>)}
                <th className="r">{t("mat.total")}</th>
              </tr>
            </thead>
            <tbody>
              {rowOpts.map((r) => {
                const rShot = photos.pictureFor(vs.find((v) => has(v, r.id))!);
                return (
                  <tr key={r.id}>
                    <td className="wrap">
                      <span className="matrixrow-label">
                        <ItemThumb
                          src={rShot ? `/items/${rShot.id}/photo?v=${rShot.photo_version}` : null}
                          name={`${product.name} ${r.label}`}
                        />
                        <strong>{r.label}</strong>
                      </span>
                    </td>
                    {colAttr
                      ? colOpts.map((c) => {
                          const v = cell(r.id, c.id);
                          return (
                            <td key={c.id} className="r"
                                title={v ? v.map((x) => x.code).join(", ") : t("mat.notCreated")}>
                              {/* An em dash is a combination that was never
                                  made; a grey nought is one that exists and
                                  has run out. They are different answers. */}
                              {v === null
                                ? <span className="matrixcell-none">—</span>
                                : <span style={{ color: sumOf(v) === 0
                                                        ? "var(--muted)" : undefined }}>
                                    {qty(sumOf(v))}
                                  </span>}
                            </td>
                          );
                        })
                      : null}
                    <td className="r"><strong>{qty(rowTotal(r.id))}</strong></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>{t("mat.total")}</strong></td>
                {colOpts.map((c) => (
                  <td key={c.id} className="r"><strong>{qty(colTotal(c.id))}</strong></td>
                ))}
                <td className="r"><strong>{qty(grand)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {missing > 0 && (
          <div className="card-body" style={{ paddingTop: 0 }}>
            <span className="page-sub">
              {t("mat.missing", { n: missing, of: rowOpts.length * Math.max(colOpts.length, 1) })}
            </span>
          </div>
        )}
      </div>

      {/* Only worth drawing once there is more than one bar to compare. */}
      {(byRow.length > 1 || byCol.length > 1) && (
        <div className="matrixcharts">
          {byRow.length > 1 && (
            <div className="card">
              <div className="card-head">
                <h2>{t("var.by", { name: rowAttr.name })}</h2>
                <span className="page-sub">{t("mat.unitOnHand", { unit: product.unit })}</span>
              </div>
              <div className="card-body" style={{ height: "14rem" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byRow} margin={{ top: 16, right: 8, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="var(--muted)" />
                    <YAxis tick={{ fontSize: 12 }} stroke="var(--muted)" allowDecimals={false} />
                    <Tooltip formatter={(v: unknown) => `${qty(Number(v))} ${product.unit}`} />
                    {/* One colour for every bar, deliberately.
                        These categories are usually colours, and a palette
                        would paint Red blue — which reads as a mapping and
                        is not one. The label under the bar is the colour;
                        the bar is just a length. */}
                    <Bar dataKey="qty" radius={[3, 3, 0, 0]} minPointSize={2}
                         fill="var(--brand)">
                      <LabelList dataKey="qty" position="top" style={{ fontSize: 11 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {byCol.length > 1 && colAttr && (
            <div className="card">
              <div className="card-head">
                <h2>{t("var.by", { name: colAttr.name })}</h2>
                <span className="page-sub">{t("mat.shareOf", { qty: qty(grand), unit: product.unit })}</span>
              </div>
              <div className="card-body matrixdonut">
                <div style={{ height: "14rem", flex: "1 1 11rem", minWidth: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={byCol.filter((d) => d.qty > 0)} dataKey="qty" nameKey="name"
                           innerRadius="58%" outerRadius="84%" paddingAngle={2}>
                        {byCol.filter((d) => d.qty > 0).map((_, i) => (
                          <Cell key={i} fill={SLICES[i % SLICES.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: unknown) => `${qty(Number(v))} ${product.unit}`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* Read as a list, because a donut alone cannot be read to a
                    number and somebody always wants the number. */}
                <ul className="matrixlegend">
                  {byCol.map((d, i) => (
                    <li key={d.name}>
                      <span className="matrixlegend-dot"
                            style={{ background: SLICES[i % SLICES.length] }} />
                      <span className="matrixlegend-name">{d.name}</span>
                      <span className="matrixlegend-qty">{qty(d.qty)}</span>
                      <span className="matrixlegend-pct">
                        {grand > 0 ? `${Math.round((d.qty / grand) * 100)}%` : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

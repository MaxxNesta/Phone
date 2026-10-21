"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/actions";
import { useTranslations } from "next-intl";

type Row = {
  id: string; item_code: string; item_name: string; uom_code: string;
  location_name: string; document_no: string; doc_date: string;
  partner_name: string | null;
  outstanding: string; provisional_unit_cost: string; outstanding_value: string;
  price_source: string | null; price_source_no: string | null;
  confirmed_reason: string | null; reason_is_legacy: boolean;
};

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });

const SOURCE_KEY: Record<string, string> = {
  PURCHASE_INVOICE: "neg.srcInvoice",
  GOODS_RECEIPT: "neg.srcReceipt",
  NONE: "neg.srcNone",
};

/**
 * Reconciling stock the ERP was never told arrived.
 *
 * The price is shown, not asked for. It was decided when the goods went out —
 * from the supplier's purchase invoice where there was one — and the
 * adjustment has to value the returning units at exactly what the sale
 * charged for them. A box to type a different figure would let the correction
 * and the cost of sale disagree, which is the thing being fixed.
 *
 * Where the price came from is shown beside it, because a figure with no
 * provenance is one people either accept without reading or distrust without
 * being able to check.
 */
export function ReconcileStock({
  action, rows, today,
}: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  rows: Row[];
  today: string;
}) {
  const t = useTranslations("inventory");
  const c = useTranslations("common");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never, null
  );
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const chosen = rows.filter((r) => picked.has(r.id));
  const totalValue = chosen.reduce((s, r) => s + Number(r.outstanding_value), 0);
  const totalUnits = chosen.reduce((s, r) => s + Number(r.outstanding), 0);

  return (
    <form action={formAction}>
      <div className="card">
        <div className="card-head">
          <h2>{t("neg.reconTitle")}</h2>
          <span className="page-sub">
            {t("neg.awaiting", { n: rows.length })}
          </span>
        </div>

        {state && "error" in state && (
          <div className="card-body"><div className="alert">{state.error}</div></div>
        )}

        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: "1%" }} />
                <th>{t("item")}</th><th>{c("warehouse")}</th><th>{t("neg.wentOutOn")}</th><th>{t("neg.why")}</th>
                <th className="r">{c("quantity")}</th>
                <th className="r">{t("neg.inventoryPrice")}</th>
                <th>{t("neg.source")}</th>
                <th className="r">{t("neg.adjValue")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={picked.has(r.id) ? "" : undefined}>
                  <td>
                    <input type="checkbox" name="negative_stock_id" value={r.id}
                           checked={picked.has(r.id)} onChange={() => toggle(r.id)}
                           aria-label={t("neg.reconcileItem", { name: r.item_name })} />
                  </td>
                  <td className="wrap">
                    <strong>{r.item_name}</strong>
                    <div className="subline" style={{ color: "var(--muted)" }}>{r.item_code}</div>
                  </td>
                  <td>{r.location_name}</td>
                  <td className="code">
                    {r.document_no}
                    <div className="subline" style={{ color: "var(--muted)" }}>
                      {r.doc_date}{r.partner_name ? ` · ${r.partner_name}` : ""}
                    </div>
                  </td>
                  {/* Why somebody said the goods were there. A confirmation
                      made before that was asked for says so rather than
                      showing an empty cell, which reads as an answer of
                      "none" — as though the question had been put and
                      declined. It never was. */}
                  <td className="wrap">
                    {r.reason_is_legacy
                      ? <span className="muted">{t("neg.legacy")}</span>
                      : (r.confirmed_reason ?? <span className="muted">&mdash;</span>)}
                  </td>
                  <td className="r">{qty(Number(r.outstanding))} {r.uom_code}</td>
                  <td className="r">{fmt(Number(r.provisional_unit_cost))}</td>
                  <td className="wrap" style={{ color: "var(--muted)" }}>
                    {SOURCE_KEY[r.price_source ?? "NONE"] ? t(SOURCE_KEY[r.price_source ?? "NONE"]) : r.price_source}
                    {r.price_source_no && (
                      <div className="subline code">{r.price_source_no}</div>
                    )}
                  </td>
                  <td className="r"><strong>{fmt(Number(r.outstanding_value))}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card-body">
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="field">
              <label htmlFor="doc_date">{t("neg.adjDate")}</label>
              <input id="doc_date" name="doc_date" type="date" defaultValue={today} required />
            </div>
            <div className="field">
              <label htmlFor="memo">{c("note")}</label>
              <input id="memo" name="memo" type="text"
                     placeholder={t("neg.notePlaceholder")} />
            </div>
          </div>

          <p className="page-sub" style={{ marginTop: "0.5rem" }}>
            {chosen.length === 0
              ? t("neg.chooseLines")
              : t("neg.addsBack", { units: c("units", { n: totalUnits }), value: fmt(totalValue) })}
          </p>
        </div>

        <div className="card-body" style={{ paddingTop: 0 }}>
          <button type="submit" disabled={pending || chosen.length === 0}>
            {pending ? t("neg.reconciling")
              : chosen.length === 0 ? t("neg.confirm")
              : t("neg.confirmValue", { value: fmt(totalValue) })}
          </button>
        </div>
      </div>
    </form>
  );
}

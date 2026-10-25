"use client";

import { useActionState, useState } from "react";
import { clearItemPrice, type ActionResult } from "@/lib/actions";
import { useTranslations } from "next-intl";

type Level = {
  levelId: string; levelName: string;
  price: string | null; validFrom: string | null; prices: number;
};

type Row = {
  itemId: string; code: string; name: string;
  baseUomId: string; uomCode: string;
  packs: { uomId: string; code: string; factor: number }[];
  levels: Level[];
};

const money = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === ""
    ? null
    : Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * One item, and what it sells for at each level.
 *
 * Setting a price adds the next one from the day it applies rather than
 * overwriting the last: an invoice raised in March was raised at March's
 * price, and the line already records what was charged. So the list is free
 * to move on without dragging history with it — and a price that starts next
 * Monday can be entered today.
 */
export function PriceRow({
  row, today, action,
}: {
  row: Row;
  today: string;
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
}) {
  const c = useTranslations("common");
  const pr = useTranslations("prices");
  const [editing, setEditing] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never, null,
  );

  const [clearState, clearAction, clearing] = useActionState<ActionResult | null, FormData>(
    clearItemPrice as never, null,
  );
  const editingLevel = row.levels.find((l) => l.levelId === editing);

  return (
    <>
      <tr>
        <td className="code">{row.code}</td>
        <td className="wrap">{row.name}</td>
        {row.levels.map((l) => (
          <td key={l.levelId} className="r">
            {l.price === null ? (
              <button type="button" className="linkish" onClick={() => setEditing(l.levelId)}>
                Set
              </button>
            ) : (
              <button type="button" className="linkish" onClick={() => setEditing(l.levelId)}
                      title={pr("from", { date: String(l.validFrom) })}>
                {money(l.price)}
              </button>
            )}
            <div className="subline">
              {l.price === null ? pr("noPrice") : pr("perUnit", { unit: row.uomCode })}
            </div>
          </td>
        ))}
      </tr>

      {editing && (
        <tr>
          <td colSpan={2 + row.levels.length}>
            {[state, clearState].map((s) => s && "error" in s && <div key={s.error} className="alert">{s.error}</div>)}
            <form action={formAction} className="form">
              <input type="hidden" name="item_id" value={row.itemId} />
              <input type="hidden" name="price_level_id" value={editing} />
              <div className="row">
                <div className="field">
                  <label>{c("price")}</label>
                  <input
                    name="price" type="number" min="0" step="any" required
                    defaultValue={row.levels.find((l) => l.levelId === editing)?.price ?? ""}
                  />
                  <span className="hint">
                    {row.code} · {row.levels.find((l) => l.levelId === editing)?.levelName}
                  </span>
                </div>
                <div className="field">
                  <label>{pr("perUnitLabel")}</label>
                  <select name="uom_id" defaultValue={row.baseUomId}>
                    <option value={row.baseUomId}>{row.uomCode}</option>
                    {row.packs.map((p) => (
                      <option key={p.uomId} value={p.uomId}>
                        {p.code} ({p.factor} {row.uomCode})
                      </option>
                    ))}
                  </select>
                  <span className="hint">{pr("perUnitHint")}</span>
                </div>
                <div className="field">
                  <label>{pr("chargedFrom")}</label>
                  <input name="valid_from" type="date" defaultValue={today} required />
                  <span className="hint">{pr("chargedFromHint")}</span>
                </div>
              </div>
              <div className="actions">
                <button type="submit" disabled={pending}>
                  {pending ? c("saving") : pr("setPrice")}
                </button>
                <button type="button" className="ghost" onClick={() => setEditing(null)}>
                  {c("cancel")}
                </button>
              </div>
            </form>
            {editingLevel?.price != null && (
              /* Back to the default: no price at all, which is not the same as a price of 0. */
              <form action={clearAction} className="actions">
                <input type="hidden" name="item_id" value={row.itemId} />
                <input type="hidden" name="price_level_id" value={editing} />
                <button type="submit" className="ghost" disabled={clearing}>Remove price (no price)</button>
              </form>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

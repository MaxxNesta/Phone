"use client";
import { WarehouseSelect } from "@/components/warehouse-select";

import { Fragment, useActionState, useEffect, useMemo, useState } from "react";
import { TrackMode } from "./track-mode";
import { SerialEntry, type ScannedSerial } from "./serial-entry";
import { NegativeStockConfirm, type Shortfall } from "./negative-stock-confirm";
import type { ActionResult, PickerItem } from "@/lib/actions";
import { ItemPicker } from "./item-picker";
import { AddItemsBar, type Pick } from "./add-items-bar";
import { useTranslations } from "next-intl";
import { LineRemove } from "./line-remove";

type Item = PickerItem;
type Node = { id: string; code: string; segment: string; name: string; parent_id: string | null };
type Location = { id: string; code: string; name: string };
type StockRow = { item_id: string; location_id: string; qty_on_hand: string };
type Line = { key: number; itemId: string; qty: string; serials?: ScannedSerial[]; withSerials?: boolean };

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * Moves stock between two of the company's own warehouses. No partner, no
 * price — it leaves the source at whatever it was already carried at and
 * reopens at the destination at that same cost, so the company-wide total
 * never moves, only which location holds it.
 */
export function StockTransferForm({
  action,
  items: initialItems,
  locations,
  toLocations,
  stockByLocation,
  shelfSerials = [],
  today,
  categories,
  uoms,
}: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  items: Item[];
  locations: Location[];
  /** Where stock may go: any branch. `locations` is where it may come from. */
  toLocations?: Location[];
  stockByLocation: StockRow[];
  /** Handsets on each shelf, so a phone line offers the IMEIs that can move. */
  shelfSerials?: { item_id: string; location_id: string; imei: string }[];
  today: string;
  categories: Node[];
  uoms: { id: string; code: string; name: string }[];
}) {
  const t = useTranslations("inventory");
  const c = useTranslations("common");
  // One key per form: a double click or a retried request posts once.
  const [attemptKey] = useState(() => crypto.randomUUID());
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never,
    null
  );

  const [items, setItems] = useState<Item[]>(initialItems);
  const addItem = (i: Item) => setItems((xs) => [...xs, i]);

  const [lines, setLines] = useState<Line[]>([{ key: 1, itemId: "", qty: "" }]);
  const [fromLocationId, setFromLocationId] = useState(locations[0]?.id ?? "");
  const destinations = toLocations ?? locations;
  const [toLocationId, setToLocationId] = useState(
    destinations.find((l) => l.id !== locations[0]?.id)?.id ?? destinations[0]?.id ?? "");
  const [docDate, setDocDate] = useState(today);
  const [receivedTime, setReceivedTime] = useState("");

  useEffect(() => {
    setReceivedTime(new Date().toTimeString().slice(0, 5));
  }, []);

  const byId = (id: string) => items.find((i) => i.id === id);
  /** Names every unit: always for IMEI and SERIAL items, by choice for OPTIONAL ones. */
  const named = (l: Line): boolean => !!byId(l.itemId)?.tracks_serial || (byId(l.itemId)?.identity === "OPTIONAL" && !!l.withSerials);

  const onHandAtFrom = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of stockByLocation) if (r.location_id === fromLocationId) m.set(r.item_id, Number(r.qty_on_hand));
    return m;
  }, [stockByLocation, fromLocationId]);
  const availableHere = (itemId: string) => onHandAtFrom.get(itemId) ?? 0;

  function setLine(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function pickItem(key: number, itemId: string) {
    setLine(key, { itemId });
  }

  /** Search, scan or browse adds here, as it does on invoices and receipts. */
  function addPicks(picks: Pick[]) {
    setLines((ls) => {
      let next = [...ls];
      for (const p of picks) {
        const at = next.find((l) => l.itemId === p.itemId);
        if (at) { next = next.map((l) => l === at ? { ...l, qty: String((Number(l.qty) || 0) + p.qty) } : l); continue; }
        const blank = next.find((l) => !l.itemId);
        next = blank ? next.map((l) => l === blank ? { ...l, itemId: p.itemId, qty: String(p.qty) } : l)
          : [...next, { key: Math.max(0, ...next.map((l) => l.key)) + 1, itemId: p.itemId, qty: String(p.qty) }];
      }
      return next;
    });
  }

  const addLine = () =>
    setLines((ls) => [...ls, { key: Math.max(0, ...ls.map((l) => l.key)) + 1, itemId: "", qty: "" }]);

  const removeLine = (key: number) =>
    setLines((ls) => (ls.length === 1 ? [{ key: key + 1, itemId: "", qty: "" }] : ls.filter((l) => l.key !== key)));

  const payload = JSON.stringify(
    lines
      .filter((l) => l.itemId && Number(l.qty) > 0)
      .map((l) => ({ itemId: l.itemId, qty: Number(l.qty), serials: (named(l) ? l.serials ?? [] : []).map((x) => x.serial) }))
  );
  const serialShort = lines.some((l) => named(l) && Number(l.qty) > 0
    && (l.serials?.length ?? 0) !== Number(l.qty));

  const sameLocation = fromLocationId && toLocationId && fromLocationId === toLocationId;

  const [negativeConfirmed, setNegativeConfirmed] = useState(false);
  // The engine requires a reason alongside the confirmation. Confirming
  // without one used to post; now it is refused, and a form that offered the
  // confirmation and not the reason could not complete the move at all.
  const [negativeReason, setNegativeReason] = useState("");
  const [askNegative, setAskNegative] = useState(false);

  const shortages = lines.filter((l) => {
    if (!l.itemId) return false;
    const item = byId(l.itemId);
    return item?.is_stocked && Number(l.qty) > availableHere(l.itemId);
  });

  return (
    <form action={formAction} className="form wide docsheet">
      <input type="hidden" name="idempotency_key" value={attemptKey} />
      {state && "error" in state && <div className="alert">{state.error}</div>}

      <input type="hidden" name="lines" value={payload} />

      <div className="card">
        <div className="card-head">
          <h2>{t("tr.fromTo")}</h2>
        </div>
        <div className="card-body">
          <div className="row">
            <div className="field">
              <label htmlFor="from_location_id">{t("tr.fromWarehouse")}</label>
              <WarehouseSelect locations={locations} id="from_location_id" name="from_location_id" value={fromLocationId}
                onChange={(e) => setFromLocationId(e.target.value)} required />
            </div>

            <div className="field">
              <label htmlFor="to_location_id">{t("tr.toWarehouse")}</label>
              <WarehouseSelect locations={destinations} id="to_location_id" name="to_location_id" value={toLocationId}
                onChange={(e) => setToLocationId(e.target.value)} required />
            </div>

            <div className="field">
              <label htmlFor="doc_date">{c("date")}</label>
              <input id="doc_date" name="doc_date" type="date" value={docDate}
                onChange={(e) => setDocDate(e.target.value)} required />
            </div>

            <div className="field">
              <label htmlFor="received_time">{t("time")}</label>
              <input id="received_time" name="received_time" type="time" value={receivedTime}
                onChange={(e) => setReceivedTime(e.target.value)} />
              <span className="hint">{t("tr.timeHint")}</span>
            </div>

            <div className="field">
              <label htmlFor="reference">{t("reference")}</label>
              <input id="reference" name="reference" type="text" placeholder={t("tr.referencePlaceholder")} />
            </div>
          </div>

          {sameLocation && <div className="alert" style={{ marginTop: "0.75rem" }}>{t("tr.twoDifferent")}</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>{t("lines")}</h2>
          <button type="button" className="ghost tiny" onClick={addLine}>{t("allocateLine")}</button>
        </div>

        <AddItemsBar items={items} categories={categories} onAdd={addPicks}
          available={availableHere} stockToggle title={t("tr.addItems")} sub={t("addItemsSub")} />

        <div className="tablewrap">
          <table className="linetable">
            <thead>
              <tr>
                <th>{t("item")}</th><th className="r">{t("tr.availableHere")}</th>
                <th className="r">{t("tr.qtyToMove")}</th><th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const item = byId(l.itemId);
                const short = item?.is_stocked && Number(l.qty) > availableHere(l.itemId);
                return (
                  <Fragment key={l.key}>
                  <tr>
                    <td style={{ minWidth: 240 }}>
                      <ItemPicker
                        mode="purchase"
                        items={items}
                        categories={categories}
                        uoms={uoms}
                        value={l.itemId}
                        onPick={(id) => pickItem(l.key, id)}
                        onCreated={addItem}
                      />
                    </td>
                    <td className="r" style={{ color: short ? "var(--bad)" : undefined }}>
                      {item ? (item.is_stocked ? fmt(availableHere(item.id)) : t("service")) : "—"}
                    </td>
                    <td className="narrow">
                      <input type="number" min="0" step="any" value={l.qty}
                        onChange={(e) => setLine(l.key, { qty: e.target.value })}
                        aria-label={c("quantity")} />
                    </td>
                    <td className="tight">
                      <LineRemove onClick={() => removeLine(l.key)} label={t("removeLine")} />
                    </td>
                  </tr>
                  {item?.identity === "OPTIONAL" && (
                    <tr className="batchrow">
                      <td colSpan={4}>
                        <TrackMode code={item.code} on={!!l.withSerials} onChange={(on) => setLine(l.key, { withSerials: on })} />
                      </td>
                    </tr>
                  )}
                  {item && named(l) && (
                    <tr className="batchrow">
                      <td colSpan={4}>
                        <SerialEntry
                          label={t("tr.serialLabel", { code: item.code })}
                          qty={Number(l.qty) || 0}
                          value={l.serials ?? []}
                          suggestions={shelfSerials
                            .filter((u) => u.item_id === item.id && u.location_id === fromLocationId)
                            .map((u) => u.imei)}
                          onChange={(v) => setLine(l.key, {
                            serials: v,
                            ...(!(Number(l.qty) > 0) || Number(l.qty) === (l.serials?.length ?? 0)
                              ? { qty: String(v.length) } : {}),
                          })}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {shortages.length > 0 && !negativeConfirmed && (
        <div className="alert">
          <strong>{t("tr.insufficient")}</strong>{" "}
          {t("tr.insufficientBody", { codes: shortages.map((l) => byId(l.itemId)?.code).join(", ") })}
        </div>
      )}

      {shortages.length > 0 && negativeConfirmed && (
        <div className="alert">
          <strong>{t("tr.confirmed")}</strong> {t("tr.confirmedBody")}{" "}
          <button type="button" className="ghost tiny"
                  onClick={() => setNegativeConfirmed(false)}>{t("undo")}</button>
          {/* Required by the engine, so it is asked here rather than refused
              after the fact. A confirmation without a reason records that
              somebody clicked, not what they knew. */}
          <div className="field" style={{ marginTop: "0.5rem" }}>
            <label htmlFor="neg_reason">{t("tr.whyShort")}</label>
            <input id="neg_reason" type="text" required
                   placeholder={t("tr.whyShortPlaceholder")}
                   value={negativeReason}
                   onChange={(e) => setNegativeReason(e.target.value)} />
          </div>
        </div>
      )}

      {negativeConfirmed && (
        <input type="hidden" name="negative_stock_reason" value={negativeReason} />
      )}
      {negativeConfirmed && (
        <input type="hidden" name="allow_negative_stock" value="true" />
      )}

      <NegativeStockConfirm
        open={askNegative}
        shortfalls={shortages.map((l): Shortfall => {
          const item = byId(l.itemId);
          return {
            itemCode: item?.code ?? "",
            itemName: item?.name ?? "",
            uomCode: item?.uom_code ?? "",
            required: Number(l.qty),
            recorded: availableHere(l.itemId),
          };
        })}
        onCancel={() => setAskNegative(false)}
        onConfirm={() => { setNegativeConfirmed(true); setAskNegative(false); }}
      />

      <div className="field">
        <label htmlFor="memo">{c("note")}</label>
        <textarea id="memo" name="memo" rows={2} placeholder={t("tr.notePlaceholder")} />
      </div>

      <div className="actions">
        {serialShort && <span className="low" role="status">{t("tr.oneImeiPerHandset")}</span>}
        <button
          type={shortages.length > 0 && !negativeConfirmed ? "button" : "submit"}
          onClick={
            shortages.length > 0 && !negativeConfirmed
              ? () => setAskNegative(true)
              : undefined
          }
          disabled={
            (shortages.length > 0 && negativeConfirmed && !negativeReason.trim()) ||
            pending || Boolean(sameLocation) || serialShort ||
            lines.every((l) => !l.itemId || Number(l.qty) <= 0)
          }
        >
          {pending ? t("posting") : t("tr.post")}
        </button>
        <span className="page-sub">
          {t("tr.postNote")}
        </span>
      </div>
    </form>
  );
}

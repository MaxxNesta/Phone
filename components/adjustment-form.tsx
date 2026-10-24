"use client";
import { WarehouseSelect } from "@/components/warehouse-select";

import { useActionState, useEffect, useMemo, useState } from "react";
import { TrackMode } from "./track-mode";
import { SerialEntry, type ScannedSerial } from "./serial-entry";
import type { ActionResult, PickerItem } from "@/lib/actions";
import { ItemPicker } from "./item-picker";
import { useTranslations } from "next-intl";

type Item = PickerItem;
type Node = { id: string; code: string; segment: string; name: string; parent_id: string | null };
type Location = { id: string; code: string; name: string };
type StockRow = { item_id: string; location_id: string; qty_on_hand: string };
type Line = {
  key: number; itemId: string; qty: string; unitCost: string;
  /** Only carried on an increase — a loss consumes lots FIFO already picked. */
  batchNo?: string; expiryDate?: string;
  /** The handsets lost, for a decrease of an item tracked by IMEI. */
  serials?: ScannedSerial[];
  /** Optional tracking: this line names its units. */
  withSerials?: boolean;
};

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * A correction, not a transaction — damage, shrinkage, or a physical count
 * that disagrees with the ledger. Positive quantity is stock found;
 * negative is stock lost. No partner, because nobody sold or supplied this.
 */
export function AdjustmentForm({
  action,
  items: initialItems,
  locations,
  stockByLocation,
  shelfSerials = [],
  today,
  categories,
  uoms,
}: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  items: Item[];
  locations: Location[];
  stockByLocation: StockRow[];
  /** Handsets on each shelf, offered when a phone is written off. */
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

  const [lines, setLines] = useState<Line[]>([{ key: 1, itemId: "", qty: "", unitCost: "" }]);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [docDate, setDocDate] = useState(today);
  const [receivedTime, setReceivedTime] = useState("");

  useEffect(() => {
    setReceivedTime(new Date().toTimeString().slice(0, 5));
  }, []);

  const byId = (id: string) => items.find((i) => i.id === id);
  /** Names every unit: always for IMEI and SERIAL items, by choice for OPTIONAL ones. */
  const named = (l: Line): boolean => !!byId(l.itemId)?.tracks_serial || (byId(l.itemId)?.identity === "OPTIONAL" && !!l.withSerials);

  // Company-wide on_hand on Item can say there's stock to remove when this
  // specific warehouse has none — same reasoning as the sales voucher.
  const onHandByItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of stockByLocation) if (r.location_id === locationId) m.set(r.item_id, Number(r.qty_on_hand));
    return m;
  }, [stockByLocation, locationId]);
  const onHandHere = (itemId: string) => onHandByItem.get(itemId) ?? 0;

  function setLine(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function pickItem(key: number, itemId: string) {
    const item = byId(itemId);
    const cost = item ? Number(item.next_cost) : 0;
    setLine(key, { itemId, unitCost: cost > 0 ? String(cost) : "" });
  }

  const addLine = () =>
    setLines((ls) => [...ls, { key: Math.max(0, ...ls.map((l) => l.key)) + 1, itemId: "", qty: "", unitCost: "" }]);

  const removeLine = (key: number) =>
    setLines((ls) => (ls.length === 1 ? ls : ls.filter((l) => l.key !== key)));

  const isLoss = (l: Line) => Number(l.qty) < 0;
  const effectiveCost = (l: Line) => {
    if (isLoss(l)) return Number(byId(l.itemId)?.next_cost ?? 0);
    return Number(l.unitCost) || 0;
  };
  const amount = (l: Line) => (Number(l.qty) || 0) * effectiveCost(l);
  const total = lines.reduce((s, l) => s + amount(l), 0);

  const serialShort = lines.some((l) => isLoss(l) && named(l)
    && (l.serials?.length ?? 0) !== Math.abs(Number(l.qty)));

  const payload = JSON.stringify(
    lines
      .filter((l) => l.itemId && Number(l.qty) !== 0)
      .map((l) => ({
        itemId: l.itemId,
        qty: Number(l.qty),
        unitCost: !isLoss(l) && l.unitCost !== "" ? Number(l.unitCost) : "",
        serials: (named(l) ? l.serials ?? [] : []).map((x) => x.serial),
        // Found stock arrives, so it names its lot like any other arrival.
        // A loss sends nothing: FIFO decides which layers it takes.
        batchNo: isLoss(l) ? "" : (l.batchNo ?? ""),
        expiryDate: isLoss(l) ? "" : (l.expiryDate ?? ""),
      }))
  );

  // A loss can't take more than what's on hand at this warehouse.
  const shortages = lines.filter((l) => {
    if (!l.itemId || !isLoss(l)) return false;
    const item = byId(l.itemId);
    return item?.is_stocked && -Number(l.qty) > onHandHere(l.itemId);
  });

  return (
    <form action={formAction} className="form wide">
      <input type="hidden" name="idempotency_key" value={attemptKey} />
      {state && "error" in state && <div className="alert">{state.error}</div>}

      <input type="hidden" name="lines" value={payload} />

      <div className="card">
        <div className="card-head">
          <h2>{t("adj.warehouseAndDate")}</h2>
        </div>
        <div className="card-body">
          <div className="row">
            <div className="field">
              <label htmlFor="location_id">{c("warehouse")}</label>
              <WarehouseSelect locations={locations} id="location_id" name="location_id" value={locationId}
                onChange={(e) => setLocationId(e.target.value)} required />
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
              <span className="hint">{t("adj.timeHint")}</span>
            </div>

            <div className="field">
              <label htmlFor="reference">{t("reference")}</label>
              <input id="reference" name="reference" type="text" placeholder={t("adj.referencePlaceholder")} />
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>{t("lines")}</h2>
          <button type="button" className="ghost tiny" onClick={addLine}>{t("allocateLine")}</button>
        </div>

        <div className="tablewrap">
          <table className="linetable">
            <thead>
              <tr>
                <th>{t("item")}</th><th className="r">{t("onHand")}</th>
                <th className="r">{t("adj.qtyHead")}</th><th className="r">{t("unitCost")}</th>
                <th className="r">{t("adj.value")}</th><th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const item = byId(l.itemId);
                const loss = isLoss(l);
                const short = loss && item?.is_stocked && -Number(l.qty) > onHandHere(l.itemId);
                return (
                  <tr key={l.key}>
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
                      {item ? (
                        <>
                          {fmt(onHandHere(item.id))}
                          <div style={{ fontSize: "0.72rem", fontWeight: 400, color: "var(--muted)" }}>
                            {t("adj.total", { n: fmt(Number(item.on_hand)) })}
                          </div>
                        </>
                      ) : "—"}
                    </td>
                    <td className="narrow">
                      <input type="number" step="any" value={l.qty}
                        onChange={(e) => setLine(l.key, { qty: e.target.value })}
                        aria-label={c("quantity")} />
                    </td>
                    <td className="narrow">
                      {loss ? (
                        <span className="m" style={{ color: "var(--muted)" }}>
                          {fmt(effectiveCost(l))}
                        </span>
                      ) : (
                        <input type="number" min="0" step="any" value={l.unitCost}
                          onChange={(e) => setLine(l.key, { unitCost: e.target.value })}
                          aria-label={t("unitCost")} />
                      )}
                    </td>
                    <td className="r">{fmt(amount(l))}</td>
                    <td className="tight">
                      <button type="button" className="ghost tiny" onClick={() => removeLine(l.key)}
                        aria-label={t("removeLine")} disabled={lines.length === 1}>×</button>
                    </td>
                  </tr>
                );
              })}
              {/* Found stock of a tracked item has to say which lot it is,
                  the same as a goods receipt — the engine refuses it
                  otherwise. Only on an increase: a loss consumes layers that
                  already exist and FIFO chooses them. */}
              {lines.filter((l) => isLoss(l) && byId(l.itemId)?.identity === "OPTIONAL").map((l) => (
                <tr key={`mode-${l.key}`} className="batchrow">
                  <td colSpan={6}>
                    <TrackMode code={byId(l.itemId)!.code} on={!!l.withSerials} onChange={(on) => setLine(l.key, { withSerials: on })} />
                  </td>
                </tr>
              ))}
              {lines.filter((l) => isLoss(l) && named(l)).map((l) => {
                const item = byId(l.itemId)!;
                return (
                  <tr key={`serial-${l.key}`} className="batchrow">
                    <td colSpan={6}>
                      <SerialEntry
                        label={t("adj.serialLabel", { code: item.code })}
                        qty={Math.abs(Number(l.qty)) || 0}
                        value={l.serials ?? []}
                        suggestions={shelfSerials
                          .filter((u) => u.item_id === item.id && u.location_id === locationId)
                          .map((u) => u.imei)}
                        onChange={(v) => setLine(l.key, { serials: v })}
                      />
                    </td>
                  </tr>
                );
              })}
              {lines.filter((l) => !isLoss(l) && byId(l.itemId)?.tracks_batch).map((l) => {
                const item = byId(l.itemId)!;
                return (
                  <tr key={`batch-${l.key}`} className="batchrow">
                    <td colSpan={6}>
                      <span className="batchrow-label">{t("whichLot", { code: item.code })}</span>
                      <input
                        type="text"
                        value={l.batchNo ?? ""}
                        onChange={(e) => setLine(l.key, { batchNo: e.target.value })}
                        placeholder={t("batchNumber")}
                        aria-label={t("batchNumberFor", { code: item.code })}
                      />
                      {item.tracks_expiry && (
                        <input
                          type="date"
                          value={l.expiryDate ?? ""}
                          onChange={(e) => setLine(l.key, { expiryDate: e.target.value })}
                          aria-label={t("expiryDateFor", { code: item.code })}
                        />
                      )}
                      {/* Said, not refused. Goods do arrive already
                          expired — a supplier ships short-dated stock and it
                          has to be recorded before it can be returned — so
                          the form notices out loud and lets the posting
                          through. Compared against the document date rather
                          than today, or every back-dated receipt would trip
                          it. */}
                      {l.expiryDate && docDate && l.expiryDate <= docDate ? (
                        <span className="hint" style={{ color: "var(--warn)" }}>
                          {t("adj.expired")}
                        </span>
                      ) : (
                        <span className="hint">
                          {item.tracks_expiry ? t("adj.expiryRequired") : t("adj.lotRecorded")}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="totalbar">
          <span style={{ color: "var(--muted)" }}>{t("adj.netValue")}</span>
          <span className="big">{fmt(total)} MMK</span>
        </div>
      </div>

      {shortages.length > 0 && (
        <div className="alert">
          {t("adj.notEnough", { codes: shortages.map((l) => byId(l.itemId)?.code).join(", ") })}
        </div>
      )}

      <div className="field">
        <label htmlFor="memo">{c("note")}</label>
        <textarea id="memo" name="memo" rows={2} placeholder={t("adj.notePlaceholder")} />
      </div>

      <div className="actions">
        {serialShort && <span className="low" role="status">{t("adj.oneImeiPerHandset")}</span>}
        <button type="submit" disabled={pending || lines.every((l) => !l.itemId || Number(l.qty) === 0) || shortages.length > 0 || serialShort}>
          {pending ? t("posting") : t("adj.post")}
        </button>
        <span className="page-sub">
          {t("adj.postNote")}
        </span>
      </div>
    </form>
  );
}

"use client";
import { WarehouseSelect } from "@/components/warehouse-select";

import { useActionState, useEffect, useMemo, useState } from "react";
import { TrackMode } from "./track-mode";
import { SerialEntry, type ScannedSerial } from "./serial-entry";
import type { ActionResult, PickerItem } from "@/lib/actions";
import { AddItemsBar, type Pick } from "./add-items-bar";
import { useTranslations } from "next-intl";
import { LineRemove } from "./line-remove";
import { useNotice } from "@/components/toast";
import { HelpHint } from "@/components/help-hint";
import { Copy, Plus, Warehouse as WarehouseIcon, CalendarDays, Clock, Hash, Tag } from "lucide-react";

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
  /** Written off from a receipt's defects: the receipt line, and where the units came from. */
  sourceLineId?: string | null;
  origin?: string | null;
  /** Their receipt cost, which the write-off takes off stock. */
  knownCost?: number | null;
};
export type AdjustmentPrefill = {
  docNo: string; locationId: string; memo: string;
  lines: { itemId: string; qty: string; sourceLineId: string; serials: ScannedSerial[]; origin: string; cost: number }[];
};

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * A correction, not a transaction: damage, shrinkage, or a physical count
 * that disagrees with the ledger. Positive quantity is stock found; negative
 * is stock lost. No partner, because nobody sold or supplied this.
 *
 * A write-off (Path B) is a loss for a reason: damaged or scrapped stock,
 * usually out of quarantine, charged to Inventory Damage instead of the
 * adjustment account a count difference uses (0225).
 *
 * Laid out as the returns are: one sheet, the details and the lines on the
 * left, the units and the note under them, the summary and the post button
 * on the right (globals.css, "returns, two columns").
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
  prefill = null,
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
  /** Opened from a receipt's defects to write them off. */
  prefill?: AdjustmentPrefill | null;
}) {
  const t = useTranslations("inventory");
  const c = useTranslations("common");
  // One key per form: a double click or a retried request posts once.
  const [attemptKey] = useState(() => crypto.randomUUID());
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never,
    null
  );
  useNotice(state);

  const [items] = useState<Item[]>(initialItems);

  const [lines, setLines] = useState<Line[]>(() =>
    (prefill?.lines ?? []).map((l, i) => ({ key: i + 1, itemId: l.itemId, qty: l.qty, unitCost: "",
      serials: l.serials, sourceLineId: l.sourceLineId, origin: l.origin, knownCost: l.cost })));
  const [locationId, setLocationId] = useState(prefill?.locationId ?? locations[0]?.id ?? "");
  const [docDate, setDocDate] = useState(today);
  const [receivedTime, setReceivedTime] = useState("");
  const [reason, setReason] = useState<"COUNT" | "DAMAGE">(prefill ? "DAMAGE" : "COUNT");
  const [adding, setAdding] = useState(!prefill);
  const [imeiOpen, setImeiOpen] = useState<number[]>([]);
  const toggleImei = (key: number) => setImeiOpen((ks) => (ks.includes(key) ? ks.filter((k) => k !== key) : [...ks, key]));

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

  /** Search, scan or browse adds here, as it does on invoices and receipts:
   *  the empty line is filled first, an item already on the sheet gains qty.
   *  A write-off takes stock away, so its lines start negative. */
  function addPicks(picks: Pick[]) {
    setLines((ls) => {
      let next = [...ls];
      for (const p of picks) {
        const sign = reason === "DAMAGE" ? -1 : 1;
        const at = next.find((l) => l.itemId === p.itemId && !l.sourceLineId);
        if (at) { next = next.map((l) => l === at ? { ...l, qty: String((Number(l.qty) || 0) + sign * p.qty) } : l); continue; }
        const cost = Number(byId(p.itemId)?.next_cost ?? 0);
        const fill = { itemId: p.itemId, qty: String(sign * p.qty), unitCost: cost > 0 ? String(cost) : "" };
        const blank = next.find((l) => !l.itemId);
        next = blank ? next.map((l) => l === blank ? { ...l, ...fill } : l)
          : [...next, { key: Math.max(0, ...next.map((l) => l.key)) + 1, ...fill }];
      }
      return next;
    });
  }

  const removeLine = (key: number) =>
    setLines((ls) => ls.filter((l) => l.key !== key));

  const isLoss = (l: Line) => Number(l.qty) < 0;
  const effectiveCost = (l: Line) => {
    if (isLoss(l)) return l.knownCost ?? Number(byId(l.itemId)?.next_cost ?? 0);
    return Number(l.unitCost) || 0;
  };
  const amount = (l: Line) => (Number(l.qty) || 0) * effectiveCost(l);
  const total = lines.reduce((s, l) => s + amount(l), 0);
  const found = lines.filter((l) => l.itemId && Number(l.qty) > 0);
  const lost = lines.filter((l) => l.itemId && isLoss(l));
  const sumQty = (ls: Line[]) => ls.reduce((s, l) => s + Math.abs(Number(l.qty) || 0), 0);
  const sumVal = (ls: Line[]) => ls.reduce((s, l) => s + Math.abs(amount(l)), 0);

  const serialShort = lines.some((l) => isLoss(l) && named(l)
    && (l.serials?.length ?? 0) !== Math.abs(Number(l.qty)));
  // A write-off only takes stock away; the engine refuses it otherwise.
  const foundOnWriteOff = reason === "DAMAGE" && found.length > 0;

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
        sourceLineId: l.sourceLineId ?? null,
      }))
  );

  // A loss can't take more than what's on hand at this warehouse.
  const shortages = lines.filter((l) => {
    if (!l.itemId || !isLoss(l)) return false;
    const item = byId(l.itemId);
    return item?.is_stocked && -Number(l.qty) > onHandHere(l.itemId);
  });

  // The rows under the lines: the handsets a loss names, a found lot's batch,
  // and the optional-tracking switch.
  const unitLines = lines.filter((l) => {
    const item = byId(l.itemId);
    if (!item) return false;
    return (isLoss(l) && (named(l) || item.identity === "OPTIONAL")) || (!isLoss(l) && !!item.tracks_batch) || !!l.origin;
  });
  const here = locations.find((l) => l.id === locationId);

  return (
    <form action={formAction} className="form wide docsheet rtn">
      <input type="hidden" name="idempotency_key" value={attemptKey} />
      <input type="hidden" name="lines" value={payload} />
      <input type="hidden" name="reason" value={reason} />

      <div className="rtn-layout">
      <div className="rtn-main">
      {state && "error" in state && <div className="alert">{state.error}</div>}

      <div className="card doc-info">
        <div className="card-head"><h2>{t("adj.details")}</h2></div>
        <div className="card-body">
          <div className="doc-fields">
            <div className="field">
              <label htmlFor="location_id"><WarehouseIcon size={13} aria-hidden="true" />{c("warehouse")}</label>
              <WarehouseSelect locations={locations} id="location_id" name="location_id" value={locationId}
                onChange={(e) => setLocationId(e.target.value)} required />
            </div>

            <div className="field">
              <label htmlFor="adj_reason"><Tag size={13} aria-hidden="true" />{t("adj.reason")}
                <HelpHint label={t("adj.reason")}>{t("adj.reasonHint")}</HelpHint>
              </label>
              <select id="adj_reason" value={reason} onChange={(e) => setReason(e.target.value as "COUNT" | "DAMAGE")}>
                <option value="COUNT">{t("adj.reasonCount")}</option>
                <option value="DAMAGE">{t("adj.reasonDamage")}</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="doc_date"><CalendarDays size={13} aria-hidden="true" />{c("date")}</label>
              <input id="doc_date" name="doc_date" type="date" value={docDate}
                onChange={(e) => setDocDate(e.target.value)} required />
            </div>

            <div className="field">
              <label htmlFor="received_time"><Clock size={13} aria-hidden="true" />{t("time")}
                <HelpHint label={t("time")}>{t("adj.timeHint")}</HelpHint>
              </label>
              <input id="received_time" name="received_time" type="time" value={receivedTime}
                onChange={(e) => setReceivedTime(e.target.value)} />
            </div>

            <div className="field">
              <label htmlFor="reference"><Hash size={13} aria-hidden="true" />{t("reference")}</label>
              <input id="reference" name="reference" type="text" placeholder={t("adj.referencePlaceholder")} />
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>{t("lines")}</h2></div>

        {adding ? (
          <AddItemsBar items={items} categories={categories} onAdd={addPicks}
            available={onHandHere} title={t("adj.addItems")} sub={t("addItemsSub")} />
        ) : (
          <div className="rtn-filled">
            <span>{t("adj.filledFrom", { doc: prefill?.docNo ?? "" })}</span>
            <button type="button" className="linkish" onClick={() => setAdding(true)}><Plus size={14} aria-hidden="true" /> {t("adj.addProduct")}</button>
          </div>
        )}

        <div className="tablewrap">
          <table className="linetable">
            <thead>
              <tr>
                <th>{t("item")}</th><th className="r">{t("onHand")}</th>
                <th className="r vc-qty">{t("adj.qtyHead")}</th><th className="r">{t("unitCost")}</th>
                <th className="r">{t("adj.value")}</th><th />
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr><td colSpan={6} className="page-sub line-empty">{t("adj.empty")}</td></tr>
              )}
              {lines.map((l) => {
                const item = byId(l.itemId);
                const loss = isLoss(l);
                const short = loss && item?.is_stocked && -Number(l.qty) > onHandHere(l.itemId);
                const n = l.serials?.length ?? 0;
                return (
                  <tr key={l.key}>
                    <td style={{ minWidth: 150 }}>
                      {item ? (
                        <div className="rtn-item">
                          {item.photo && <span className="vthumb sm"><img src={item.photo} alt="" /></span>}
                          <span>
                            <div className="line-item-name">{item.name}</div>
                            <span className="subline">
                              {item.code}
                              {loss && named(l) && <> · <span className={n > 0 && n === Math.abs(Number(l.qty)) ? undefined : "low"}>{n} IMEI{n === 1 ? "" : "s"}</span></>}
                            </span>
                          </span>
                        </div>
                      ) : "—"}
                    </td>
                    <td className="r" style={{ color: short ? "var(--bad)" : undefined }}>
                      {item && l.sourceLineId ? (
                        // From a receipt's defects: this line's own units in quarantine.
                        <>{fmt(Math.abs(Number(l.qty) || 0))}<span className="subline" style={{ display: "block" }}>{t("adj.blocked")}</span></>
                      ) : item ? (
                        <>
                          {fmt(onHandHere(item.id))}
                          <span className="subline" style={{ display: "block" }}>
                            {t("adj.total", { n: fmt(Number(item.on_hand)) })}
                          </span>
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
                        <span className="m rtn-fixed">{fmt(effectiveCost(l))}</span>
                      ) : (
                        <input type="number" min="0" step="any" value={l.unitCost}
                          onChange={(e) => setLine(l.key, { unitCost: e.target.value })}
                          aria-label={t("unitCost")} />
                      )}
                    </td>
                    <td className="r">{fmt(amount(l))}</td>
                    <td className="tight">
                      <LineRemove onClick={() => removeLine(l.key)} label={t("removeLine")} />
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

      {/* Each line's units: the handsets a loss names (with where they came
          from when written off from a receipt), and the lot found stock
          belongs to. One row each; the entry opens under its row. */}
      {unitLines.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>{t("adj.unitsHead")}</h2></div>
          <div className="rtn-units">
            {unitLines.map((l) => {
              const item = byId(l.itemId)!;
              const loss = isLoss(l);
              const serials = l.serials ?? [];
              const q = Math.abs(Number(l.qty)) || 0;
              const done = q > 0 && serials.length === q;
              const open = imeiOpen.includes(l.key);
              const [what, ...why] = (l.origin ?? "").split(" · ");
              return (
                <div key={l.key} className="rtn-unit">
                  <div className="rtn-unit-row">
                    <strong className="rtn-unit-code">{item.code}</strong>
                    <span className="rtn-unit-why">
                      {l.origin ? <>{what}{why.length > 0 && <span className="page-sub"> · {why.join(" · ")}</span>}</> : <span className="page-sub">{item.name}</span>}
                    </span>
                    {loss && named(l) && done && !open && (
                      <span className="rtn-unit-imei">
                        {serials.map((x) => (
                          <span key={x.serial} className="vimei">
                            IMEI <span className="m">{x.serial}</span>
                            <button type="button" className="vicon" aria-label={`Copy IMEI ${x.serial}`}
                              onClick={() => navigator.clipboard?.writeText(x.serial)}><Copy size={14} /></button>
                          </span>
                        ))}
                        <button type="button" className="linkish" onClick={() => toggleImei(l.key)}>{t("adj.change")}</button>
                      </span>
                    )}
                  </div>
                  {loss && item.identity === "OPTIONAL" && (
                    <TrackMode code={item.code} on={!!l.withSerials} onChange={(on) => setLine(l.key, { withSerials: on })} />
                  )}
                  {loss && named(l) && (!done || open) && (
                    <SerialEntry
                      label="IMEIs"
                      qty={q}
                      value={serials}
                      suggestions={shelfSerials
                        .filter((u) => u.item_id === item.id && u.location_id === locationId)
                        .map((u) => u.imei)}
                      onChange={(v) => setLine(l.key, { serials: v })}
                      onDone={open ? () => toggleImei(l.key) : undefined}
                    />
                  )}
                  {/* Found stock of a tracked item has to say which lot it is,
                      the same as a goods receipt: the engine refuses it
                      otherwise. Only on an increase: a loss consumes layers
                      that already exist and FIFO chooses them. */}
                  {!loss && item.tracks_batch && (
                    <div className="rtn-lot">
                      <input type="text" value={l.batchNo ?? ""}
                        onChange={(e) => setLine(l.key, { batchNo: e.target.value })}
                        placeholder={t("batchNumber")} aria-label={t("batchNumberFor", { code: item.code })} />
                      {item.tracks_expiry && (
                        <input type="date" value={l.expiryDate ?? ""}
                          onChange={(e) => setLine(l.key, { expiryDate: e.target.value })}
                          aria-label={t("expiryDateFor", { code: item.code })} />
                      )}
                      {/* Said, not refused. Goods do arrive already expired and
                          have to be recorded before they can be returned, so the
                          form notices out loud and lets the posting through.
                          Compared against the document date rather than today,
                          or every back-dated adjustment would trip it. */}
                      {l.expiryDate && docDate && l.expiryDate <= docDate ? (
                        <span className="hint" style={{ color: "var(--warn)" }}>{t("adj.expired")}</span>
                      ) : (
                        <span className="hint">{item.tracks_expiry ? t("adj.expiryRequired") : t("adj.lotRecorded")}</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><h2><label htmlFor="memo">{c("note")}</label></h2></div>
        <textarea id="memo" name="memo" rows={2} className="rtn-note" placeholder={t("adj.notePlaceholder")}
          defaultValue={prefill?.memo ?? undefined} />
      </div>
      </div>

      <aside className="rtn-side">
        <section className="rtn-sec">
          <h2 className="rtn-side-title">{t("adj.summary")}</h2>
          <div className="rtn-total">
            <span>{t("adj.netValue")}</span>
            <strong>{fmt(total)} MMK</strong>
          </div>
          <dl className="rtn-facts">
            <dt>{c("warehouse")}</dt><dd>{here?.name ?? "—"}</dd>
            <dt>{t("adj.found")}</dt><dd>{found.length ? `${fmt(sumQty(found))} · ${fmt(sumVal(found))}` : "—"}</dd>
            <dt>{t("adj.lost")}</dt><dd>{lost.length ? `${fmt(sumQty(lost))} · ${fmt(sumVal(lost))}` : "—"}</dd>
            <dt>{t("adj.chargedTo")}</dt><dd>{reason === "DAMAGE" ? "Inventory Damage" : "Stock Adjustment"}</dd>
          </dl>
          {shortages.length > 0 && (
            <div className="alert">
              {t("adj.notEnough", { codes: shortages.map((l) => byId(l.itemId)?.code).join(", ") })}
            </div>
          )}
          {foundOnWriteOff && <div className="alert">{t("adj.writeOffOnlyLoss")}</div>}
          {serialShort && <span className="low" role="status">{t("adj.oneImeiPerHandset")}</span>}
          <button type="submit" className="rtn-post"
            disabled={pending || lines.every((l) => !l.itemId || Number(l.qty) === 0) || shortages.length > 0 || serialShort || foundOnWriteOff}>
            {pending ? t("posting") : reason === "DAMAGE" ? t("adj.postWriteOff") : t("adj.post")}
          </button>
          <span className="page-sub">{reason === "DAMAGE" ? t("adj.postNoteDamage") : t("adj.postNote")}</span>
        </section>
      </aside>
      </div>
    </form>
  );
}

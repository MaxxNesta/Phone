"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { SlidersHorizontal, X, Check, ShoppingCart, AlarmClock, Layers, Moon, Truck, LineChart, ClipboardList, Settings2 } from "lucide-react";
import { money } from "@/lib/format";
import type { ActionResult } from "@/lib/actions";
import { KpiCard } from "./kpi-card";
import { ShareDonut, RankedBarChart } from "./charts";
import { ItemThumb } from "./item-thumb";
import { ExportCsvButton } from "./export-csv";
import { HelpHint } from "./help-hint";

export type PlanRowLite = {
  id: string; code: string; name: string; uom: string; categoryId: string | null; photo: string | null;
  supplier: string | null; supplierId: string | null;
  leadTime: number; leadSource: "item" | "supplier" | "default";
  measuredDays: number | null; measuredSample: number; reviewSuggested: boolean;
  onHand: number; stockValue: number; reserved: number; incoming: number; available: number; projected: number;
  perDay: number; sdDay: number; abc: "A" | "B" | "C" | null; xyz: "X" | "Y" | "Z" | null;
  method: "AUTO" | "MINMAX" | "MANUAL"; min: number | null; max: number | null;
  moq: number | null; multiple: number | null; safety: number; safetySource: "set" | "calc";
  rop: number; target: number; daysLeft: number | null; daysCover: number | null;
  orderBy: string | null; suggest: number; unitCost: number; excessQty: number;
  status: "now" | "soon" | "ok" | "excess" | "dead" | "manual"; weeks: number[];
};
export type PlanOpenLine = {
  orderId: string; docNo: string; supplier: string | null; itemId: string;
  outstanding: number; docDate: string; dueDate: string | null;
};
type Tab = "order" | "excess" | "dead" | "late" | "all";
type Action = (prev: unknown, fd: FormData) => Promise<ActionResult>;

const STATUS_ORDER = ["now", "soon", "excess", "dead", "ok", "manual"] as const;
/* One hue per status, far apart on the wheel so no two read as the same:
   red, amber, blue, grey, green, pale grey. Defined in globals.css (--rp-*)
   with dark-mode values, because the theme's own --warn is a red-orange that
   sits right beside --bad. */
const STATUS_TONE: Record<string, string> = {
  now: "var(--rp-now)", soon: "var(--rp-soon)", excess: "var(--rp-excess)",
  dead: "var(--rp-dead)", ok: "var(--rp-ok)", manual: "var(--rp-manual)",
};
const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US");
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/**
 * The planning workbench: what to buy, what is sitting, what is late.
 *
 * Built from the app's own pieces — KpiCard tiles, the .segmented control,
 * ShareDonut and RankedBarChart, ItemThumb, ExportCsvButton, and the
 * customer panel's side column (.cpanel) for one product. Filtering is
 * local and instant; only demand window and cover, which change the
 * arithmetic, go back to the server.
 */
export function PlanWorkbench({
  rows, openLines, categories, today, seeCost, windowDays, coverDays, assumptions,
  planLocationId, createOrders, savePlanning,
}: {
  rows: PlanRowLite[]; openLines: PlanOpenLine[];
  categories: { id: string; name: string }[];
  today: string; seeCost: boolean; windowDays: number; coverDays: number;
  assumptions: { label: string; options: { label: string; href: string; on: boolean }[] }[];
  /** Where planning settings are saved; null when several warehouses are in view. */
  planLocationId: string | null;
  createOrders: Action; savePlanning: Action;
}) {
  const t = useTranslations("plan");
  const [tab, setTab] = useState<Tab>("order");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [sup, setSup] = useState("");
  const [cls, setCls] = useState(""); // "A", "AX", "Z" …
  const [picked, setPicked] = useState<Record<string, number>>({}); // id → qty, ticked lines only
  const [open, setOpen] = useState<string | null>(null);

  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const suppliers = useMemo(() => [...new Map(rows.filter((r) => r.supplierId).map((r) => [r.supplierId!, r.supplier!])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const late = useMemo(() => openLines.filter((l) => l.dueDate && l.dueDate < today), [openLines, today]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) =>
      (!needle || r.code.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle) || (r.supplier ?? "").toLowerCase().includes(needle))
      && (!cat || r.categoryId === cat) && (!sup || r.supplierId === sup)
      && (!cls || (cls.length === 1 ? r.abc === cls || r.xyz === cls : `${r.abc}${r.xyz}` === cls)));
  }, [rows, q, cat, sup, cls]);
  const filteredIds = useMemo(() => new Set(filtered.map((r) => r.id)), [filtered]);

  const inTab = (r: PlanRowLite) => tab === "all" ? true : tab === "order" ? r.status === "now" || r.status === "soon" : r.status === tab;
  const shown = filtered.filter(inTab);
  const lateShown = late.filter((l) => filteredIds.has(l.itemId));

  const val = (r: PlanRowLite, qty: number) => qty * r.unitCost;
  const sum = (list: PlanRowLite[], f: (r: PlanRowLite) => number) => list.reduce((s, r) => s + f(r), 0);
  const k = {
    now: filtered.filter((r) => r.status === "now"),
    order: filtered.filter((r) => r.status === "now" || r.status === "soon"),
    excess: filtered.filter((r) => r.status === "excess"),
    dead: filtered.filter((r) => r.status === "dead"),
  };

  const qtyOf = (r: PlanRowLite) => (r.id in picked ? picked[r.id] : r.suggest);
  const pickedRows = Object.keys(picked).map((id) => byId.get(id)).filter((r): r is PlanRowLite => !!r);
  const pickedSuppliers = new Set(pickedRows.map((r) => r.supplierId ?? "none"));
  const allPicked = shown.length > 0 && shown.every((r) => r.id in picked);
  const toggle = (r: PlanRowLite) => setPicked((p) => {
    const n = { ...p };
    if (r.id in n) delete n[r.id]; else n[r.id] = r.suggest || 1;
    return n;
  });
  const toggleAll = () => setPicked((p) => {
    const n = { ...p };
    if (allPicked) for (const r of shown) delete n[r.id];
    else for (const r of shown) if (!(r.id in n)) n[r.id] = r.suggest || 1;
    return n;
  });
  const orders = useMemo(() => {
    const g = new Map<string, { supplierId: string | null; lines: object[] }>();
    for (const r of pickedRows) {
      const key = r.supplierId ?? "none";
      if (!g.has(key)) g.set(key, { supplierId: r.supplierId, lines: [] });
      g.get(key)!.lines.push({ itemId: r.id, qty: picked[r.id], unitPrice: r.unitCost || undefined, leadDays: r.leadTime, leadSource: r.leadSource });
    }
    return [...g.values()];
  }, [pickedRows, picked]);
  const [orderState, orderAction, ordering] = useActionState<ActionResult | null, FormData>(createOrders as never, null);

  const filters = [
    cat && { k: "cat", label: catName.get(cat) ?? "", clear: () => setCat("") },
    sup && { k: "sup", label: suppliers.find(([id]) => id === sup)?.[1] ?? "", clear: () => setSup("") },
    cls && { k: "cls", label: t("classN", { c: cls }), clear: () => setCls("") },
  ].filter(Boolean) as { k: string; label: string; clear: () => void }[];

  const tabs: { id: Tab; label: string; n: number }[] = [
    { id: "order", label: t("tab.order"), n: k.order.length },
    { id: "excess", label: t("tab.excess"), n: k.excess.length },
    { id: "dead", label: t("tab.dead"), n: k.dead.length },
    { id: "late", label: t("tab.late"), n: lateShown.length },
    { id: "all", label: t("tab.all"), n: filtered.length },
  ];

  // What the open tab shows, as a spreadsheet.
  const csv: (string | number)[][] = tab === "late"
    ? [["Order", "Supplier", "Code", "Product", "Outstanding", "Due"],
       ...lateShown.map((l) => [l.docNo, l.supplier ?? "", byId.get(l.itemId)?.code ?? "", byId.get(l.itemId)?.name ?? "", l.outstanding, l.dueDate ?? ""])]
    : [["Code", "Product", "Supplier", "Class", "Status", "On hand", "Available", "Incoming", "Per day", "Safety", "Reorder point", "Order up to", "Order qty", "Order by", "Excess"],
       ...shown.map((r) => [r.code, r.name, r.supplier ?? "", `${r.abc ?? ""}${r.xyz ?? ""}`, r.status, r.onHand, r.available, r.incoming,
                            r.perDay, r.safety, r.rop, r.target, qtyOf(r), r.orderBy ?? "", r.excessQty])];

  const health = STATUS_ORDER.map((s) => ({ s, n: filtered.filter((r) => r.status === s).length })).filter((x) => x.n > 0);
  const noSup = t("noSupplier");
  const bySupplier = (() => {
    const by = new Map<string, number>();
    for (const r of k.order) by.set(r.supplier ?? noSup, (by.get(r.supplier ?? noSup) ?? 0) + (seeCost ? val(r, r.suggest) : r.suggest));
    return [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value }));
  })();

  const openRow = open ? byId.get(open) ?? null : null;

  return (
    <>
      <div className="rp">
        <div className="kpis kpis-tiled kpis-compact">
          <KpiCard icon={<AlarmClock size={16} aria-hidden="true" />} label={t("k.orderNow")} value={k.now.length}
            unit={t("products")} tone={k.now.length ? "bad" : undefined} hint={t("k.orderNowNote")} />
          <KpiCard icon={<ShoppingCart size={16} aria-hidden="true" />} label={t("k.toBuy")}
            value={seeCost ? money(sum(k.order, (r) => val(r, r.suggest))) : fmt(sum(k.order, (r) => r.suggest))}
            unit={seeCost ? "MMK" : t("units")} hint={t("k.toBuyNote", { n: k.order.length, unit: seeCost ? "MMK" : t("units") })} />
          <KpiCard icon={<Layers size={16} aria-hidden="true" />} label={t("k.excess")}
            value={seeCost ? money(sum(k.excess, (r) => val(r, r.excessQty))) : fmt(sum(k.excess, (r) => r.excessQty))}
            unit={seeCost ? "MMK" : t("units")} hint={t("k.excessNote", { n: k.excess.length })} />
          <KpiCard icon={<Moon size={16} aria-hidden="true" />} label={t("k.dead", { n: windowDays })}
            value={seeCost ? money(sum(k.dead, (r) => r.stockValue)) : fmt(sum(k.dead, (r) => r.onHand))}
            unit={seeCost ? "MMK" : t("units")} hint={t("k.deadNote", { n: k.dead.length })} />
          <KpiCard icon={<Truck size={16} aria-hidden="true" />} label={t("k.late")} value={lateShown.length}
            tone={lateShown.length ? "warn" : undefined} hint={t("k.lateNote", { n: new Set(lateShown.map((l) => l.orderId)).size })} />
        </div>

        <div className="rp-charts">
          <section className="card rp-chart">
            <h3>{t("chart.health")}</h3>
            <ShareDonut count currency="" colours={health.map((h) => STATUS_TONE[h.s])}
              centre={{ value: String(filtered.length), label: t("products") }}
              data={health.map((h) => ({ id: h.s, name: t(`status.${h.s}`), revenue: h.n }))} emptyLabel={t("empty.all")} />
          </section>
          <AbcMatrix rows={filtered} active={cls} onPick={(c) => setCls(cls === c ? "" : c)} />
          <section className="card rp-chart">
            <h3>{t("chart.bySupplier")}</h3>
            {bySupplier.length === 0 ? <p className="rp-note">{t("chart.nothing")}</p>
              : <RankedBarChart compact data={bySupplier} height={Math.max(90, bySupplier.length * 30)} />}
          </section>
        </div>

        {/* One slim toolbar: the app's segmented control for the lists, then search,
            filters and assumptions folded into popovers. */}
        <div className="rp-bar">
          <div className="segmented" role="tablist">
            {tabs.map((x) => (
              <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={`seg${tab === x.id ? " on" : ""}`} onClick={() => setTab(x.id)}>
                {x.label}<span className="rp-n">{x.n}</span>
              </button>
            ))}
          </div>
          {filters.map((f) => (
            <span key={f.k} className="rp-chip">{f.label}
              <button type="button" aria-label={t("clear")} onClick={f.clear}><X size={12} aria-hidden="true" /></button>
            </span>
          ))}
          <div className="rp-tools">
            <input type="search" className="rp-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} aria-label={t("search")} />
            <Pop label={<><SlidersHorizontal size={14} aria-hidden="true" />{t("filter")}{filters.length > 0 && <span className="rp-n">{filters.length}</span>}</>}>
              <label className="rp-field">{t("category")}
                <select value={cat} onChange={(e) => setCat(e.target.value)}>
                  <option value="">{t("any")}</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="rp-field">{t("supplier")}
                <select value={sup} onChange={(e) => setSup(e.target.value)}>
                  <option value="">{t("any")}</option>
                  {suppliers.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
                </select>
              </label>
              <label className="rp-field">{t("class")}
                <select value={cls} onChange={(e) => setCls(e.target.value)}>
                  <option value="">{t("any")}</option>
                  {["A", "B", "C", "X", "Y", "Z"].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            </Pop>
            <Pop label={<span className="rp-assume">{t("assume", { w: windowDays, c: coverDays })}</span>} align="right">
              {assumptions.map((a) => (
                <div key={a.label} className="rp-field">{a.label}
                  <div className="segmented">
                    {a.options.map((o) => <Link key={o.href} href={o.href} scroll={false} className={`seg${o.on ? " on" : ""}`} aria-current={o.on || undefined}>{o.label}</Link>)}
                  </div>
                </div>
              ))}
              <p className="rp-note">{t("assumeNote")}</p>
            </Pop>
            <ExportCsvButton name={`replenishment-${tab}-${today}`} rows={csv} />
          </div>
        </div>

        <div className="card">
          {tab === "late" ? (
            lateShown.length === 0 ? <div className="empty">{t("empty.late")}</div> : (
              <div className="tablewrap"><table>
                <thead><tr><th>{t("col.order")}</th><th>{t("supplier")}</th><th>{t("col.product")}</th>
                  <th className="r">{t("col.outstanding")}</th><th>{t("col.due")}</th><th className="r">{t("col.late")}</th></tr></thead>
                <tbody>{lateShown.map((l) => {
                  const r = byId.get(l.itemId);
                  return (
                    <tr key={l.orderId + l.itemId}>
                      <td><Link className="m" href={`/documents/${l.orderId}`}>{l.docNo}</Link></td>
                      <td>{l.supplier ?? "—"}</td>
                      <td className="wrap">{r && <Product r={r} onOpen={setOpen} />}</td>
                      <td className="r">{fmt(l.outstanding)}</td>
                      <td>{l.dueDate}</td>
                      <td className="r"><span className="pill overdue">{t("nDays", { n: daysBetween(l.dueDate!, today) })}</span></td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
            )
          ) : shown.length === 0 ? (
            <div className="empty">{t(`empty.${tab}`, { w: windowDays, c: coverDays })}</div>
          ) : (
            <div className="tablewrap"><table>
              <thead><tr>
                {tab === "order" && <th className="rp-ck"><input type="checkbox" checked={allPicked} onChange={toggleAll} aria-label={t("pickAll")} /></th>}
                <th colSpan={2}>{t("col.product")}</th>
                <th>{t("col.class")}</th>
                <th>{t("col.trend")}</th>
                {tab === "order" && <>
                  <th className="r">{t("col.available")}</th><th className="r">{t("col.incoming")}</th>
                  <th className="r">{t("col.perDay")}</th><th>{t("col.runsOut")}</th>
                  <th className="r">{t("col.rop")}</th><th className="r">{t("col.suggest")}</th>
                  {seeCost && <th className="r">{t("col.value")}</th>}
                  <th>{t("col.orderBy")}</th>
                </>}
                {tab === "excess" && <>
                  <th className="r">{t("col.onHand")}</th><th className="r">{t("col.perDay")}</th><th className="r">{t("col.cover")}</th>
                  <th className="r">{t("col.target")}</th><th className="r">{t("col.excess")}</th>{seeCost && <th className="r">{t("col.value")}</th>}
                </>}
                {tab === "dead" && <>
                  <th className="r">{t("col.onHand")}</th><th className="r">{t("col.incoming")}</th>{seeCost && <th className="r">{t("col.stockValue")}</th>}
                  <th>{t("supplier")}</th>
                </>}
                {tab === "all" && <>
                  <th>{t("col.method")}</th><th className="r">{t("col.available")}</th><th className="r">{t("col.perDay")}</th>
                  <th className="r">{t("col.safety")}</th><th className="r">{t("col.rop")}</th><th className="r">{t("col.target")}</th><th>{t("col.status")}</th>
                </>}
              </tr></thead>
              <tbody>{shown.map((r) => (
                <tr key={r.id} data-picked={r.id in picked || undefined} data-open={open === r.id || undefined}>
                  {tab === "order" && <td className="rp-ck"><input type="checkbox" checked={r.id in picked} onChange={() => toggle(r)} aria-label={t("pick", { code: r.code })} /></td>}
                  <td className="vgroup-thumb"><ItemThumb src={r.photo} name={r.name} /></td>
                  <td className="wrap"><Product r={r} onOpen={setOpen} sub={tab === "order" ? r.supplier : null} /></td>
                  <td><ClassBadge r={r} /></td>
                  <td><Spark weeks={r.weeks} /></td>
                  {tab === "order" && <>
                    <td className="r">{fmt(r.available)}</td>
                    <td className="r">{r.incoming > 0 ? fmt(r.incoming) : "—"}</td>
                    <td className="r">{fmt(r.perDay)}</td>
                    <td><Runway r={r} /></td>
                    <td className="r">{fmt(r.rop)}</td>
                    <td className="r">
                      <input className="rp-qty" type="number" min={0} inputMode="numeric" value={qtyOf(r)}
                        onChange={(e) => setPicked((p) => ({ ...p, [r.id]: Math.max(0, Number(e.target.value) || 0) }))}
                        aria-label={t("qtyFor", { code: r.code })} />
                    </td>
                    {seeCost && <td className="r">{money(val(r, qtyOf(r)))}</td>}
                    <td><span className={`pill ${r.status === "now" ? "overdue" : "rp-soon"}`}>{r.status === "now" ? t("today") : r.orderBy}</span></td>
                  </>}
                  {tab === "excess" && <>
                    <td className="r">{fmt(r.onHand)}</td><td className="r">{fmt(r.perDay)}</td>
                    <td className="r">{r.daysCover === null ? "—" : t("nDays", { n: Math.round(r.daysCover) })}</td>
                    <td className="r">{fmt(r.target)}</td><td className="r"><strong>{fmt(r.excessQty)}</strong></td>
                    {seeCost && <td className="r">{money(val(r, r.excessQty))}</td>}
                  </>}
                  {tab === "dead" && <>
                    <td className="r">{fmt(r.onHand)}</td><td className="r">{r.incoming > 0 ? fmt(r.incoming) : "—"}</td>
                    {seeCost && <td className="r">{money(r.stockValue)}</td>}
                    <td>{r.supplier ?? "—"}</td>
                  </>}
                  {tab === "all" && <>
                    <td>{t(`method.${r.method}`)}</td><td className="r">{fmt(r.available)}</td><td className="r">{fmt(r.perDay)}</td>
                    <td className="r">{fmt(r.safety)}</td><td className="r">{fmt(r.rop)}</td><td className="r">{fmt(r.target)}</td>
                    <td><span className="rp-status"><i style={{ background: STATUS_TONE[r.status] }} />{t(`status.${r.status}`)}</span></td>
                  </>}
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>

        {pickedRows.length > 0 && (
          <form action={orderAction} className="rp-dock">
            <input type="hidden" name="orders" value={JSON.stringify(orders)} />
            <span><strong>{t("dock.lines", { n: pickedRows.length })}</strong> · {t("dock.suppliers", { n: pickedSuppliers.size })}
              {seeCost && <> · {money(sum(pickedRows, (r) => val(r, picked[r.id] ?? 0)))} MMK</>}</span>
            {orderState && "error" in orderState && <span className="rp-err">{orderState.error}</span>}
            <button type="button" className="ghost tiny" onClick={() => setPicked({})}>{t("clear")}</button>
            <button type="submit" className="tiny" disabled={ordering}>{ordering ? t("dock.creating") : t("dock.create", { n: pickedSuppliers.size })}</button>
          </form>
        )}
      </div>

      {openRow && (
        <ItemPanel key={openRow.id} r={openRow} lines={openLines.filter((l) => l.itemId === openRow.id)} today={today}
          seeCost={seeCost} coverDays={coverDays} windowDays={windowDays} category={catName.get(openRow.categoryId ?? "") ?? null}
          planLocationId={planLocationId} save={savePlanning} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

function Product({ r, onOpen, sub }: { r: PlanRowLite; onOpen: (id: string) => void; sub?: string | null }) {
  return (
    // One line for the name, cut with an ellipsis (full name on hover), and the
    // code and supplier small beneath — rows stay one height however long the name.
    <button type="button" className="rp-prod" onClick={() => onOpen(r.id)} title={r.name}>
      <span className="rp-name">{r.name}</span>
      <span className="m">{r.code}{sub && ` · ${sub}`}</span>
    </button>
  );
}

/** A small popover on a button (the details pattern the supply-chain export uses); closes on outside click or Escape. */
function Pop({ label, children, align }: { label: React.ReactNode; children: React.ReactNode; align?: "right" }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      const d = ref.current;
      if (!d?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !d.contains(e.target as Node)) d.open = false;
    };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, []);
  return (
    <details className="rp-pop" ref={ref}>
      <summary className="btn ghost tiny">{label}</summary>
      <div className="rp-popbody" data-align={align}>{children}</div>
    </details>
  );
}

function ClassBadge({ r }: { r: PlanRowLite }) {
  if (!r.abc && !r.xyz) return <span className="rp-cls" data-c="none">—</span>;
  return <span className="rp-cls" data-c={r.abc ?? "none"} title={`${r.abc ?? "–"} by value · ${r.xyz ?? "–"} by steadiness`}>{r.abc ?? "–"}{r.xyz ?? ""}</span>;
}

/** Thirteen weeks out as tiny bars, the latest in full blue (the week-bars convention). */
function Spark({ weeks }: { weeks: number[] }) {
  const max = Math.max(...weeks, 1);
  return (
    <svg className="rp-spark" viewBox="0 0 65 20" width={65} height={20} aria-hidden="true">
      {weeks.map((w, i) => {
        const h = Math.max(w > 0 ? 2 : 0.6, (w / max) * 20);
        return <rect key={i} x={i * 5} y={20 - h} width={3.4} height={h} rx={1} fill={i === 12 ? "var(--chart-1)" : "var(--bar-past)"} />;
      })}
    </svg>
  );
}

/** Days of stock left against the lead time (the tick); red when it runs out first. Uses the panel's meter bar. */
function Runway({ r }: { r: PlanRowLite }) {
  const t = useTranslations("plan");
  if (r.daysLeft === null) return <span className="page-sub">—</span>;
  const span = Math.max(r.leadTime * 2, 30);
  return (
    <span className="rp-run" title={t("runTitle", { d: Math.floor(r.daysLeft), l: r.leadTime })}>
      <span className="cpanel-bar rp-runbar">
        <span style={{ background: r.daysLeft < r.leadTime ? "var(--rp-now)" : "var(--rp-soon)", width:`${Math.max(0, Math.min(1, r.daysLeft / span)) * 100}%` }} />
        <b style={{ left: `${Math.min(1, r.leadTime / span) * 100}%` }} />
      </span>
      {t("nDays", { n: Math.max(0, Math.floor(r.daysLeft)) })}
    </span>
  );
}

/** ABC by value against XYZ by steadiness: where attention pays. */
function AbcMatrix({ rows, active, onPick }: { rows: PlanRowLite[]; active: string; onPick: (c: string) => void }) {
  const t = useTranslations("plan");
  const cell = (a: string, x: string) => rows.filter((r) => r.abc === a && r.xyz === x).length;
  return (
    <section className="card rp-chart">
      <h3>{t("chart.abc")} <HelpHint label={t("chart.abc")}><NineBox count={cell} /></HelpHint></h3>
      <div className="rp-matrix">
        <span />{["X", "Y", "Z"].map((x) => <span key={x} className="rp-mh" title={t(`xyz.${x}`)}>{x}</span>)}
        {["A", "B", "C"].map((a) => (
          <div key={a} style={{ display: "contents" }}>
            <span className="rp-mh" title={t(`abc.${a}`)}>{a}</span>
            {["X", "Y", "Z"].map((x) => {
              const n = cell(a, x);
              return (
                <button key={x} type="button" className="rp-cell" data-tone={BOX[a + x].tone} aria-pressed={active === a + x}
                  onClick={() => onPick(a + x)} disabled={!n}>{n}</button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="rp-note">{t("chart.abcNote")}</p>
    </section>
  );
}

/**
 * The nine-box explanation behind the ABC × XYZ "?": what each box means
 * (speed, demand, stock level, risk), coloured by risk, with how many of
 * this shop's products sit in it.
 */
// tone: how much attention the box needs overall (green easy, amber watch,
// red hard to plan), which is not the same as its stock-out risk: a CZ item
// is low risk to the business but the hardest of all to buy for.
// Five steps along the diagonal, from AX (high volume, smooth: plan it and
// forget it) to CZ (low volume, random: the hardest to buy for).
type Tone = "g2" | "g1" | "y" | "o" | "r2";
const BOX: Record<string, { level: string; risk: "low" | "mid" | "high"; tone: Tone }> = {
  AX: { level: "low", risk: "low", tone: "g2" }, AY: { level: "midHigh", risk: "mid", tone: "g1" }, AZ: { level: "high", risk: "mid", tone: "y" },
  BX: { level: "low", risk: "low", tone: "g1" }, BY: { level: "avg", risk: "mid", tone: "y" }, BZ: { level: "high", risk: "high", tone: "o" },
  CX: { level: "low", risk: "low", tone: "y" }, CY: { level: "midHigh", risk: "low", tone: "o" }, CZ: { level: "midHigh", risk: "low", tone: "r2" },
};
function NineBox({ count }: { count: (a: string, x: string) => number }) {
  const t = useTranslations("plan");
  return (
    <div className="abc9">
      <p>{t("box.intro")}</p>
      <div className="abc9-grid">
        <span />{["X", "Y", "Z"].map((x) => <b key={x} className="abc9-h">{x}<small>{t(`xyz.${x}`)}</small></b>)}
        {["A", "B", "C"].map((a) => (
          <div key={a} style={{ display: "contents" }}>
            <b className="abc9-h abc9-row">{a}</b>
            {["X", "Y", "Z"].map((x) => {
              const b = BOX[a + x];
              return (
                <div key={x} className="abc9-cell" data-tone={b.tone}>
                  <ul>
                    <li>{t(`box.speed.${a}`)}</li>
                    <li>{t(`box.demand.${x}`)}</li>
                    <li>{t(`box.level.${b.level}`)}</li>
                    <li>{t(`box.risk.${b.risk}`)}</li>
                  </ul>
                  <span className="abc9-n">{t("nItems", { n: count(a, x) })}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <ul className="abc9-legend">
        {([["g1", "green"], ["y", "amber"], ["r2", "red"]] as const).map(([tone, k]) => <li key={k}><i data-tone={tone} />{t(`box.tone.${k}`)}</li>)}
      </ul>
      <p className="abc9-foot">{t("box.foot")}</p>
    </div>
  );
}

/** One product, in the customer panel's column: projection, figures, history, open orders, planning. */
function ItemPanel({ r, lines, today, seeCost, coverDays, windowDays, category, planLocationId, save, onClose }: {
  r: PlanRowLite; lines: PlanOpenLine[]; today: string; seeCost: boolean; coverDays: number; windowDays: number;
  category: string | null; planLocationId: string | null; save: Action; onClose: () => void;
}) {
  const t = useTranslations("plan");
  const router = useRouter();
  const [state, action, saving] = useActionState<ActionResult | null, FormData>(save as never, null);
  const [method, setMethod] = useState(r.method);
  useEffect(() => { if (state && "ok" in state) router.refresh(); }, [state, router]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    // The customer panel, floating over the page (its narrow-screen form at
    // every width) so the charts and table keep their layout underneath.
    <aside className="cpanel cpanel-float" role="dialog" aria-label={r.name}>
      <header className="cpanel-head">
        <div className="cpanel-title">
          <div className="cpanel-name"><h2>{r.name}</h2><ClassBadge r={r} /></div>
          <span className="page-sub">{[r.code, category, r.supplier].filter(Boolean).join(" · ")}</span>
        </div>
        <button type="button" className="cpanel-x" aria-label={t("close")} onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </header>
      <div className="cpanel-body">
        <Sec icon={<LineChart size={15} aria-hidden="true" />} title={t("sheet.projection")}>
          <Projection r={r} lines={lines} today={today} />
        </Sec>

        <div className="cpanel-cards">
          <div><span>{t("col.onHand")}</span><strong>{fmt(r.onHand)}</strong>{seeCost && <span>{money(r.stockValue)} MMK</span>}</div>
          <div><span>{t("sheet.reserved")}</span><strong>{fmt(r.reserved)}</strong></div>
          <div><span>{t("col.incoming")}</span><strong>{fmt(r.incoming)}</strong></div>
          <div><span>{t("col.perDay")}</span><strong>{fmt(r.perDay)}</strong><span>{t("sheet.over", { n: windowDays })}</span></div>
          <div><span>{t("sheet.variability")}</span><strong>±{fmt(r.sdDay)}</strong><span>{t("sheet.perDaySd")}</span></div>
          <div><span>{t("sheet.lead")}</span><strong>{t("nDays", { n: r.leadTime })}</strong><span>{t(`lead.${r.leadSource}`)}</span></div>
          <div><span>{t("col.safety")}</span><strong>{fmt(r.safety)}</strong><span>{r.safetySource === "set" ? t("sheet.fixed") : t("sheet.calc")}</span></div>
          <div><span>{t("col.rop")}</span><strong>{fmt(r.rop)}</strong></div>
          <div><span>{t("col.target")}</span><strong>{fmt(r.target)}</strong><span>{t("sheet.coverN", { n: coverDays })}</span></div>
        </div>
        {r.reviewSuggested && <p className="cpanel-note rp-warn">{t("sheet.review", { n: r.measuredDays ?? 0, l: r.leadTime })}</p>}
        {!r.reviewSuggested && r.measuredDays !== null && <p className="cpanel-explain page-sub">{t("sheet.measured", { n: r.measuredDays, s: r.measuredSample })}</p>}

        <Sec icon={<ClipboardList size={15} aria-hidden="true" />} title={t("sheet.history")}>
          <History weeks={r.weeks} />
        </Sec>

        {lines.length > 0 && (
          <Sec icon={<Truck size={15} aria-hidden="true" />} title={t("sheet.openOrders")}>
            <table className="cpanel-table">
              <tbody>{lines.map((l) => (
                <tr key={l.orderId}>
                  <td><Link href={`/documents/${l.orderId}`} className="m">{l.docNo}</Link></td>
                  <td>{l.supplier}</td><td className="r">{fmt(l.outstanding)}</td>
                  <td className={l.dueDate && l.dueDate < today ? "rp-late" : undefined}>{l.dueDate ?? "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </Sec>
        )}

        <Sec icon={<Settings2 size={15} aria-hidden="true" />} title={t("sheet.planning")}>
          {!planLocationId ? <p className="rp-note">{t("sheet.pickWarehouse")}</p> : (
            <form action={action} className="rp-form">
              <input type="hidden" name="item_id" value={r.id} />
              <input type="hidden" name="location_id" value={planLocationId} />
              <input type="hidden" name="supplier_id" value={r.supplierId ?? ""} />
              <input type="hidden" name="method" value={method} />
              <div className="segmented" role="radiogroup" aria-label={t("col.method")}>
                {(["AUTO", "MINMAX", "MANUAL"] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={method === m} className={`seg${method === m ? " on" : ""}`} onClick={() => setMethod(m)}>{t(`method.${m}`)}</button>
                ))}
              </div>
              <p className="rp-note">{t(`methodNote.${method}`)}</p>
              <div className="cpanel-grid">
                <label className="field">{method === "MINMAX" ? t("f.min") : t("f.floor")}<input name="min_qty" type="number" min={0} step="any" defaultValue={r.min ?? ""} placeholder="—" /></label>
                <label className="field">{t("f.max")}<input name="max_qty" type="number" min={0} step="any" defaultValue={r.max ?? ""} placeholder="—" disabled={method !== "MINMAX"} /></label>
                <label className="field">{t("f.safety")}<input name="safety_qty" type="number" min={0} step="any" defaultValue={r.safetySource === "set" ? r.safety : ""} placeholder={t("f.auto", { n: r.safety })} disabled={method !== "AUTO"} /></label>
                {r.supplierId ? <>
                  <label className="field">{t("f.lead")}<input name="lead_time_days" type="number" min={0} max={365} defaultValue={r.leadSource === "item" ? r.leadTime : ""} placeholder={t("f.leadUsual", { n: r.leadTime })} /></label>
                  <label className="field">{t("f.moq")}<input name="moq" type="number" min={1} step="any" defaultValue={r.moq ?? ""} placeholder="—" /></label>
                  <label className="field">{t("f.pack")}<input name="order_multiple" type="number" min={1} step="any" defaultValue={r.multiple ?? ""} placeholder="—" /></label>
                </> : <p className="rp-note">{t("f.noSupplier")}</p>}
              </div>
              <div className="rp-formfoot">
                {state && "error" in state && <span className="rp-err">{state.error}</span>}
                {state && "ok" in state && !saving && <span className="rp-ok"><Check size={14} aria-hidden="true" /> {t("saved")}</span>}
                <button type="submit" className="tiny" disabled={saving}>{saving ? t("saving") : t("save")}</button>
              </div>
            </form>
          )}
        </Sec>
      </div>
    </aside>
  );
}

/** The customer panel's section: icon, heading, a soft box. */
function Sec({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="cpanel-sec">
      <div className="cpanel-sec-head">{icon}<h3>{title}</h3></div>
      <div className="cpanel-box">{children}</div>
    </section>
  );
}

/**
 * Eight weeks ahead at today's rate: stock falls by the daily demand (never
 * below nothing — a sale that finds an empty shelf is lost, not owed), steps
 * up as each open order lands, and a dashed line shows the suggested order.
 */
function Projection({ r, lines, today }: { r: PlanRowLite; lines: PlanOpenLine[]; today: string }) {
  const t = useTranslations("plan");
  const D = 56, W = 400, H = 140, P = { l: 28, r: 6, t: 8, b: 18 };
  const arrivals = lines.map((l) => ({ d: l.dueDate ? Math.max(0, daysBetween(today, l.dueDate)) : r.leadTime, q: l.outstanding }));
  const planned = r.suggest > 0 ? { d: Math.max(0, daysBetween(today, r.orderBy ?? today)) + r.leadTime, q: r.suggest } : null;
  const base: number[] = [], withPlan: number[] = [];
  let a = Math.max(0, r.available), b = a;
  for (let d = 0; d <= D; d++) {
    const land = arrivals.filter((x) => x.d === d).reduce((s, x) => s + x.q, 0);
    if (d > 0) { a = Math.max(0, a - r.perDay); b = Math.max(0, b - r.perDay); }
    a += land; b += land + (planned && planned.d === d ? planned.q : 0);
    base.push(a); withPlan.push(b);
  }
  const hi = Math.max(...base, ...withPlan, r.rop, r.safety, 1) * 1.08;
  const x = (d: number) => P.l + (d / D) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - v / hi) * (H - P.t - P.b);
  const path = (vs: number[]) => vs.map((v, d) => `${d ? "L" : "M"}${x(d).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const stockout = base.findIndex((v) => v <= 0);
  return (
    <figure className="rp-proj">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("sheet.projection")}>
        {[0, 2, 4, 6, 8].map((w) => <g key={w}>
          <line x1={x(w * 7)} x2={x(w * 7)} y1={P.t} y2={H - P.b} stroke="var(--line-soft)" />
          <text x={x(w * 7)} y={H - 4} textAnchor="middle" className="rp-ax">{w === 0 ? t("today") : `${w}w`}</text>
        </g>)}
        <line x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} stroke="var(--line)" />
        <text x={P.l - 4} y={y(0) + 3} textAnchor="end" className="rp-ax">0</text>
        <line x1={P.l} x2={W - P.r} y1={y(r.rop)} y2={y(r.rop)} stroke="var(--rp-soon)" strokeWidth={1.5} strokeDasharray="5 3" />
        <text x={P.l - 4} y={y(r.rop) + 3} textAnchor="end" className="rp-ax">{Math.round(r.rop)}</text>
        {r.safety > 0 && <line x1={P.l} x2={W - P.r} y1={y(r.safety)} y2={y(r.safety)} stroke="var(--rp-now)" strokeWidth={1.5} />}
        <path d={`${path(base)}L${x(D)},${y(0)}L${x(0)},${y(0)}Z`} fill="color-mix(in srgb, var(--chart-1) 12%, transparent)" />
        {planned && <path d={path(withPlan)} fill="none" stroke="var(--chart-1)" strokeWidth={1.5} strokeDasharray="5 4" />}
        <path d={path(base)} fill="none" stroke="var(--chart-1)" strokeWidth={2} />
        {stockout >= 0 && <circle cx={x(stockout)} cy={y(0)} r={4} fill="var(--bad)" />}
      </svg>
      <figcaption className="wk-legend rp-legend-inline">
        <span><i className="ln" style={{ borderColor: "var(--chart-1)" }} />{t("sheet.projected")}</span>
        {planned && <span><i className="ln dash" style={{ borderColor: "var(--chart-1)" }} />{t("sheet.withSuggested", { n: r.suggest })}</span>}
        <span><i className="ln dash" style={{ borderColor: "var(--rp-soon)" }} />{t("col.rop")}</span>
        {r.safety > 0 && <span><i className="ln thin" style={{ borderColor: "var(--rp-now)" }} />{t("col.safety")}</span>}
        {stockout >= 0 && <span className="rp-late">{t("sheet.stockout", { n: stockout })}</span>}
      </figcaption>
    </figure>
  );
}

function History({ weeks }: { weeks: number[] }) {
  const t = useTranslations("plan");
  const max = Math.max(...weeks, 1);
  return (
    <div className="rp-hist" role="img" aria-label={weeks.join(", ")}>
      {weeks.map((w, i) => (
        <span key={i} title={t("sheet.weekAgo", { n: 12 - i, q: fmt(w) })}>
          <i style={{ height: `${(w / max) * 100}%`, background: i === 12 ? "var(--chart-1)" : "var(--bar-past)" }} />
          <small>{i % 2 === 0 ? (i === 12 ? t("thisWeek") : `-${12 - i}`) : ""}</small>
        </span>
      ))}
    </div>
  );
}

"use client";

import { createContext, useActionState, useCallback, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { Pencil, X, Building2, Truck, Wallet, StickyNote, Clock, ChevronDown, ChevronRight, Timer, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ActionResult } from "@/lib/actions";
import {
  supplierOverview, supplierPurchases, supplierBills, billSettlements, supplierTerms, termItems, supplierActivity,
} from "@/lib/supplier-panel";
import type { Activity } from "@/lib/customer-panel-data";
import { PartnerEditForm, type Partner } from "./partner-edit-form";
import { Section, Field, Loading, Failed, useLoad, docLabel, Timeline } from "./customer-panel";
import { useNotice } from "@/components/toast";

// lib/db.ts opens a connection at import, so formatting stays local here.
const money = (v: number | string | null | undefined) =>
  Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : "—");

type Ctx = { selected: string | null; open: (id: string) => void };
const PanelCtx = createContext<Ctx>({ selected: null, open: () => {} });
export const useSupplierPanel = () => useContext(PanelCtx);

type Act = (prev: unknown, fd: FormData) => Promise<ActionResult>;

/**
 * The Suppliers list's side panel, the purchase-side twin of the customer
 * panel: the list stays put and narrows, the panel opens beside it. Its
 * Purchasing terms tab replaces the old Products → Purchasing terms page.
 */
export function SupplierPanelProvider({
  suppliers, supplierCategories, updateAction, saveTermAction, deleteTermAction, children,
}: {
  suppliers: Partner[];
  supplierCategories: { id: string; name: string }[];
  updateAction: Act; saveTermAction: Act; deleteTermAction: Act;
  children: React.ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const open = useCallback((id: string) => setSelected((s) => (s === id ? null : id)), []);
  const partner = suppliers.find((c) => c.id === selected) ?? null;

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  return (
    <PanelCtx.Provider value={{ selected, open }}>
      <div className={`cpanel-layout${partner ? " has-panel" : ""}`}>
        <div className="cpanel-main">{children}</div>
        {partner && (
          <SupplierPanel key={partner.id} partner={partner} supplierCategories={supplierCategories}
            updateAction={updateAction} saveTermAction={saveTermAction} deleteTermAction={deleteTermAction}
            onClose={() => setSelected(null)} />
        )}
      </div>
    </PanelCtx.Provider>
  );
}

const TABS = ["overview", "purchases", "bills", "terms", "activity"] as const;
type Tab = (typeof TABS)[number];

function SupplierPanel({ partner, supplierCategories, updateAction, saveTermAction, deleteTermAction, onClose }: {
  partner: Partner;
  supplierCategories: { id: string; name: string }[];
  updateAction: Act; saveTermAction: Act; deleteTermAction: Act;
  onClose: () => void;
}) {
  const t = useTranslations("supplierPanel");
  const cp = useTranslations("customerPanel");
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState(false);

  return (
    <aside className="cpanel" role="dialog" aria-label={partner.name}>
      <header className="cpanel-head">
        <div className="cpanel-title">
          <div className="cpanel-name">
            <h2 title={partner.name}>{partner.name}</h2>
            {partner.is_active
              ? <span className="pill ok">{cp("active")}</span>
              : <span className="pill warn">{cp("inactive")}</span>}
          </div>
          <span className="page-sub">{cp("code", { code: partner.code })}</span>
        </div>
        <button type="button" className="ghost tiny" onClick={() => setEditing((e) => !e)}>
          <Pencil size={14} aria-hidden="true" /> {cp("edit")}
        </button>
        <button type="button" className="cpanel-x" aria-label={cp("close")} onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      {editing ? (
        <div className="cpanel-body">
          <PartnerEditForm partner={partner} supplierCategories={supplierCategories}
            updateAction={updateAction} onCancel={() => setEditing(false)} />
        </div>
      ) : (
        <>
          <nav className="cpanel-tabs" role="tablist">
            {TABS.map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k}
                className={tab === k ? "on" : undefined} onClick={() => setTab(k)}>
                {t(`tab.${k}`)}
              </button>
            ))}
          </nav>
          <div className="cpanel-body">
            {tab === "overview" && <Overview partner={partner} onActivity={() => setTab("activity")} onEdit={() => setEditing(true)} onTerms={() => setTab("terms")} />}
            {tab === "purchases" && <Purchases partner={partner} />}
            {tab === "bills" && <Bills partner={partner} />}
            {tab === "terms" && <Terms partner={partner} saveAction={saveTermAction} deleteAction={deleteTermAction} onEdit={() => setEditing(true)} />}
            {tab === "activity" && <ActivityTab partner={partner} />}
          </div>
        </>
      )}
    </aside>
  );
}

function Overview({ partner, onActivity, onEdit, onTerms }: { partner: Partner; onActivity: () => void; onEdit: () => void; onTerms: () => void }) {
  const t = useTranslations("supplierPanel");
  const cp = useTranslations("customerPanel");
  const s = useLoad(() => supplierOverview(partner.id));
  const editLink = <button type="button" className="cpanel-link" onClick={onEdit}>{cp("edit")}</button>;
  return (
    <>
      <Section icon={<Building2 size={16} aria-hidden="true" />} title={cp("companyContact")}>
        <div className="cpanel-grid">
          <Field label={cp("companyName")}>{partner.company_name}</Field>
          <Field label={cp("contactPerson")}>{partner.contact_person}</Field>
          <Field label={cp("phone")}>{partner.phone}</Field>
          <Field label={cp("email")}>{partner.email}</Field>
          <Field label={cp("address")}>{[partner.address, partner.township, partner.region].filter(Boolean).join(", ") || null}</Field>
        </div>
      </Section>
      <Section icon={<Truck size={16} aria-hidden="true" />} title={t("purchasing")} action={editLink}>
        <div className="cpanel-grid">
          <Field label={t("group")}>{partner.supplier_category_name}</Field>
          <Field label={cp("paymentTerms")}>
            {Number(partner.payment_terms_days) === 0 ? t("payNow") : cp("days", { n: partner.payment_terms_days })}
          </Field>
          <Field label={t("currency")}>{partner.currency ?? t("homeCurrency")}</Field>
          <Field label={t("usualDelivery")}>
            {partner.lead_time_days === null ? t("notSet") : cp("days", { n: partner.lead_time_days })}
          </Field>
        </div>
        <div className="cpanel-note"><button type="button" className="cpanel-link" onClick={onTerms}>{t("seeTerms")}</button></div>
      </Section>
      <Section icon={<Wallet size={16} aria-hidden="true" />} title={t("money")}>
        <div className="cpanel-grid">
          <Field label={t("owed")}>{money(s.data?.owed ?? partner.outstanding)}</Field>
          <Field label={t("lastPurchase")}>{s.loading ? "…" : day(s.data?.lastPurchase)}</Field>
        </div>
        {s.data && s.data.overdue > 0 && (
          <div className="cpanel-note bad">{t("overdueAmount", { amount: money(s.data.overdue) })}</div>
        )}
      </Section>
      <Section icon={<StickyNote size={16} aria-hidden="true" />} title={cp("notes")} action={editLink}>
        <p className="cpanel-notes">{partner.notes || <span className="page-sub">{cp("noNotes")}</span>}</p>
      </Section>
      <Section icon={<Clock size={16} aria-hidden="true" />} title={cp("recentActivity")}
        action={<button type="button" className="cpanel-link" onClick={onActivity}>{cp("viewAll")}</button>}>
        {s.loading ? <Loading /> : s.error ? <Failed error={s.error} /> : <Timeline rows={s.data!.recent} created={t("created")} />}
      </Section>
    </>
  );
}

const TYPE_PILL: Record<string, string> = { PURCHASE_ORDER: "draft", GOODS_RECEIPT: "info", PURCHASE_INVOICE: "posted" };

function Purchases({ partner }: { partner: Partner }) {
  const t = useTranslations("supplierPanel");
  const cp = useTranslations("customerPanel");
  const [pages, setPages] = useState<Awaited<ReturnType<typeof supplierPurchases>>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const more = (offset: number) => {
    setBusy(true);
    supplierPurchases(partner.id, offset).then((p) => setPages((x) => (offset === 0 ? [p] : [...x, p])))
      .catch((e) => setError(String(e?.message ?? e))).finally(() => setBusy(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { more(0); }, []);
  if (error) return <Failed error={error} />;
  if (!pages.length) return <Loading />;
  const sum = pages[0].summary;
  const rows = pages.flatMap((p) => p.rows);
  return (
    <>
      <div className="cpanel-cards">
        <div><span>{t("totalPurchased")}</span><strong>{money(sum.totalPurchased)}</strong></div>
        <div><span>{t("openOrders")}</span><strong>{sum.openOrders}</strong></div>
        <div><span>{t("toReceive")}</span><strong>{cp("units", { n: sum.toReceive })}</strong></div>
      </div>
      <p className="page-sub cpanel-explain">{t("purchasesExplain")}</p>
      {rows.length === 0 ? <div className="cpanel-state">{t("noPurchases")}</div> : (
        <table className="cpanel-table">
          <thead><tr><th>{cp("reference")}</th><th>{t("type")}</th><th className="r">{cp("amount")}</th><th>{cp("status")}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/documents/${r.id}`}>{r.docNo ?? cp("draft")}</Link>
                  <div className="subline">{day(r.date)}</div>
                </td>
                <td><span className={`pill ${TYPE_PILL[r.docType] ?? ""}`}>{t(`kind.${r.docType}`)}</span></td>
                <td className="r">{money(r.amount)}</td>
                <td>
                  {r.voided ? <span className="pill reversed">{cp("voided")}</span>
                    : r.docType === "PURCHASE_ORDER" && r.status === "POSTED"
                      ? (r.toReceive ? <span className="pill warn">{t("toReceiveN", { n: r.toReceive })}</span>
                                     : <span className="pill ok">{t("received")}</span>)
                      : <span className={`pill ${r.status === "POSTED" ? "posted" : "draft"}`}>{cp(`st.${r.status}`)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="cpanel-foot">
        {pages[pages.length - 1].more && (
          <button type="button" className="ghost tiny" disabled={busy} onClick={() => more(rows.length)}>
            {busy ? cp("loading") : cp("loadMore")}
          </button>
        )}
        <Link href={`/partners/${partner.id}`} className="cpanel-link">{cp("viewAll")}</Link>
      </div>
    </>
  );
}

const PAY_PILL: Record<string, string> = { PAID: "ok", PARTIAL: "warn", UNPAID: "draft", OVERDUE: "overdue" };

function Bills({ partner }: { partner: Partner }) {
  const t = useTranslations("supplierPanel");
  const cp = useTranslations("customerPanel");
  const [pages, setPages] = useState<Awaited<ReturnType<typeof supplierBills>>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openBill, setOpenBill] = useState<string | null>(null);
  const more = (offset: number) => {
    setBusy(true);
    supplierBills(partner.id, offset).then((p) => setPages((x) => (offset === 0 ? [p] : [...x, p])))
      .catch((e) => setError(String(e?.message ?? e))).finally(() => setBusy(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { more(0); }, []);
  if (error) return <Failed error={error} />;
  if (!pages.length) return <Loading />;
  const sum = pages[0].summary;
  const rows = pages.flatMap((p) => p.rows);
  return (
    <>
      <div className="cpanel-cards four">
        <div><span>{t("totalBilled")}</span><strong>{money(sum.billed)}</strong></div>
        <div><span>{t("owed")}</span><strong>{money(sum.owed)}</strong></div>
        <div><span>{cp("overdue")}</span><strong className={sum.overdue > 0 ? "bad" : undefined}>{money(sum.overdue)}</strong></div>
        <div><span>{t("unpaidBills")}</span><strong>{sum.unpaid}</strong></div>
      </div>
      {rows.length === 0 ? <div className="cpanel-state">{t("noBills")}</div> : (
        <table className="cpanel-table">
          <thead><tr><th>{t("bill")}</th><th className="r">{cp("total")}</th><th className="r">{cp("balance")}</th><th>{cp("status")}</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const open = openBill === r.id;
              return (
                <BillRow key={r.id} partnerId={partner.id} r={r} open={open}
                  onToggle={() => setOpenBill((o) => (o === r.id ? null : r.id))} />
              );
            })}
          </tbody>
        </table>
      )}
      <div className="cpanel-foot">
        {pages[pages.length - 1].more && (
          <button type="button" className="ghost tiny" disabled={busy} onClick={() => more(rows.length)}>
            {busy ? cp("loading") : cp("loadMore")}
          </button>
        )}
        <Link href={`/partners/${partner.id}`} className="cpanel-link">{cp("viewAll")}</Link>
      </div>
    </>
  );
}

function BillRow({ partnerId, r, open, onToggle }: {
  partnerId: string;
  r: Awaited<ReturnType<typeof supplierBills>>["rows"][number];
  open: boolean; onToggle: () => void;
}) {
  const t = useTranslations("supplierPanel");
  const cp = useTranslations("customerPanel");
  return (
    <>
      <tr className={open ? "is-open" : undefined}>
        <td>
          <button type="button" className="cpanel-expand" aria-expanded={open} onClick={onToggle} aria-label={t("showPayments")}>
            {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          </button>
          <Link href={`/documents/${r.id}`}>{r.docNo}</Link>
          <div className="subline">{day(r.date)} · {cp("due", { date: day(r.due) })}</div>
        </td>
        <td className="r">{money(r.total)}</td>
        <td className="r">{r.outstanding > 0 ? money(r.outstanding) : "—"}</td>
        <td><span className={`pill ${PAY_PILL[r.status]}`}>{cp(`pay.${r.status}`)}</span></td>
      </tr>
      {open && (
        <tr className="cpanel-sub"><td colSpan={4}><Settlements partnerId={partnerId} billId={r.id} /></td></tr>
      )}
    </>
  );
}

function Settlements({ partnerId, billId }: { partnerId: string; billId: string }) {
  const t = useTranslations("supplierPanel");
  const cp = useTranslations("customerPanel");
  const s = useLoad(() => billSettlements(partnerId, billId));
  if (s.loading) return <Loading />;
  if (s.error) return <Failed error={s.error} />;
  if (!s.data!.length) return <div className="cpanel-state">{t("noPayments")}</div>;
  return (
    <ul className="cpanel-pays">
      {s.data!.map((p) => (
        <li key={p.id + p.docType}>
          <Link href={`/documents/${p.id}`}>{p.docNo}</Link>
          <span className="page-sub">{docLabel(cp, p.docType)}{p.channel ? ` · ${p.channel}` : ""} · {day(p.date)}</span>
          <strong>{money(p.amount)}</strong>
        </li>
      ))}
    </ul>
  );
}

/**
 * Purchasing terms: the supplier's usual delivery time, and the products
 * that come at a different speed — what Products → Purchasing terms held,
 * now with the supplier it belongs to. Replenishment reads both.
 */
function Terms({ partner, saveAction, deleteAction, onEdit }: { partner: Partner; saveAction: Act; deleteAction: Act; onEdit: () => void }) {
  const t = useTranslations("supplierPanel");
  const cp = useTranslations("customerPanel");
  const [ver, setVer] = useState(0);
  // Stable, so a saved or removed term reloads the list once, not on every render.
  const reload = useCallback(() => setVer((v) => v + 1), []);
  const [data, setData] = useState<Awaited<ReturnType<typeof supplierTerms>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    supplierTerms(partner.id).then((d) => live && setData(d)).catch((e) => live && setError(String(e?.message ?? e)));
    return () => { live = false; };
  }, [partner.id, ver]);
  if (error) return <Failed error={error} />;
  if (!data) return <Loading />;
  const usual = data.usual;
  return (
    <>
      <Section icon={<Timer size={16} aria-hidden="true" />} title={t("usualDelivery")}
        action={<button type="button" className="cpanel-link" onClick={onEdit}>{cp("edit")}</button>}>
        <div className="cpanel-grid">
          <Field label={t("thisSupplier")}>{usual === null ? t("notSet") : cp("days", { n: usual })}</Field>
          <Field label={t("companyDefault")}>{cp("days", { n: data.companyDefault })}</Field>
        </div>
        <p className="page-sub cpanel-explain">{t("usualExplain")}</p>
      </Section>
      <Section icon={<Truck size={16} aria-hidden="true" />} title={t("exceptions")}>
        {data.rows.length === 0 ? <div className="cpanel-state">{t("noExceptions")}</div> : (
          <table className="cpanel-table">
            <thead><tr><th>{t("product")}</th><th className="r">{t("delivery")}</th><th /></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.itemCode}</strong> {r.itemName}
                    {(r.sku || r.note) && <div className="subline">{[r.sku && t("theirCode", { code: r.sku }), r.note].filter(Boolean).join(" · ")}</div>}
                  </td>
                  <td className="r">{r.days === null ? t("asUsual") : cp("days", { n: r.days })}</td>
                  <td className="r"><RemoveTerm id={r.id} action={deleteAction} onDone={reload} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <AddTerm supplierId={partner.id} usual={usual} taken={data.rows.map((r) => r.itemId)} action={saveAction} onDone={reload} />
      </Section>
    </>
  );
}

function RemoveTerm({ id, action, onDone }: { id: string; action: Act; onDone: () => void }) {
  const t = useTranslations("supplierPanel");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action as never, null);
  useNotice(state);
  useEffect(() => { if (state && "ok" in state) onDone(); }, [state, onDone]);
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="ghost tiny" disabled={pending} aria-label={t("remove")} title={t("remove")}>
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </form>
  );
}

/** `taken`: products that already have a term here, left out so adding never silently overwrites one. */
function AddTerm({ supplierId, usual, taken, action, onDone }: { supplierId: string; usual: number | null; taken: string[]; action: Act; onDone: () => void }) {
  const t = useTranslations("supplierPanel");
  const [items, setItems] = useState<{ id: string; code: string; name: string }[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action as never, null);
  useNotice(state);
  useEffect(() => { if (state && "ok" in state) { setAdding(false); onDone(); } }, [state, onDone]);
  useEffect(() => { if (adding && !items) termItems().then(setItems).catch(() => setItems([])); }, [adding, items]);
  if (!adding) {
    return <div className="cpanel-foot"><button type="button" className="ghost tiny" onClick={() => setAdding(true)}>{t("addException")}</button></div>;
  }
  return (
    <form action={formAction} className="cpanel-form">
      <input type="hidden" name="supplier_id" value={supplierId} />
      {state && "error" in state && <div className="alert">{state.error}</div>}
      <label>{t("product")}
        <select name="item_id" required defaultValue="">
          <option value="" disabled>{items ? t("chooseProduct") : t("loadingProducts")}</option>
          {(items ?? []).filter((i) => !taken.includes(i.id)).map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}
        </select>
      </label>
      <label>{t("deliveryDays")}
        <input name="lead_time_days" type="number" min="0" max="365" placeholder={usual === null ? "" : String(usual)} />
        <span className="hint">{t("blankIsUsual")}</span>
      </label>
      <label>{t("theirProductCode")}<input name="supplier_sku" /></label>
      <label>{t("note")}<input name="note" /></label>
      <div className="cpanel-form-actions">
        <button type="button" className="ghost tiny" onClick={() => setAdding(false)}>{t("cancel")}</button>
        <button type="submit" className="btn tiny" disabled={pending}>{t("save")}</button>
      </div>
    </form>
  );
}

function ActivityTab({ partner }: { partner: Partner }) {
  const t = useTranslations("supplierPanel");
  const cp = useTranslations("customerPanel");
  const [rows, setRows] = useState<Activity[]>([]);
  const [more, setMore] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | string>("loading");
  const load = (offset: number) => {
    setState("loading");
    supplierActivity(partner.id, offset)
      .then((r) => { setRows((x) => (offset === 0 ? r.rows : [...x, ...r.rows])); setMore(r.more); setState("ready"); })
      .catch((e) => setState(String(e?.message ?? e)));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(0); }, []);
  if (state !== "loading" && state !== "ready") return <Failed error={state} />;
  return (
    <>
      {rows.length === 0 && state === "loading" ? <Loading /> : <Timeline rows={rows} created={t("created")} />}
      <p className="page-sub cpanel-explain">{t("activityExplain")}</p>
      {more && (
        <div className="cpanel-foot">
          <button type="button" className="ghost tiny" disabled={state === "loading"} onClick={() => load(rows.length)}>
            {state === "loading" ? cp("loading") : cp("loadMore")}
          </button>
        </div>
      )}
    </>
  );
}

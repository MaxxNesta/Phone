"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { Pencil, X, Building2, MapPin, Tag, CreditCard, StickyNote, Clock, ChevronDown, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ActionResult } from "@/lib/actions";
import {
  customerOverview, customerSales, customerInvoices, invoiceSettlements, customerActivity,
} from "@/lib/customer-panel";
import type { Activity } from "@/lib/customer-panel-data";
import { PartnerEditForm, type Partner } from "./partner-edit-form";

// lib/db.ts opens a connection at import, so formatting stays local here.
const money = (v: number | string | null | undefined) =>
  Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : "—");
const stamp = (v: string | null | undefined) => (v ? v.slice(0, 16).replace("T", " ") : "—");

/**
 * A customer's credit, read the way the till enforces it: no limit set is
 * unlimited, a limit of nought is no credit at all, and a limit already
 * exceeded says by how much.
 */
export function creditState(p: Pick<Partner, "credit_limit" | "available">) {
  if (p.credit_limit === null) return { kind: "UNLIMITED" as const };
  const limit = Number(p.credit_limit);
  if (limit === 0) return { kind: "NONE" as const };
  const left = Number(p.available ?? limit);
  const used = limit - left;
  return {
    kind: left < 0 ? ("OVER" as const) : ("LIMIT" as const),
    limit, left, used, pct: Math.min(100, Math.max(0, (used / limit) * 100)),
  };
}

type Ctx = { selected: string | null; open: (id: string) => void };
const PanelCtx = createContext<Ctx>({ selected: null, open: () => {} });
export const useCustomerPanel = () => useContext(PanelCtx);

/**
 * Holds which customer is open and draws the panel beside the list. The
 * list stays where it is — search, filters, sort and page are the table's own
 * state and nothing here touches them.
 */
export function CustomerPanelProvider({
  customers, priceLevels, categories, updateAction, children,
}: {
  customers: Partner[];
  priceLevels: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  updateAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const open = useCallback((id: string) => setSelected((s) => (s === id ? null : id)), []);
  const partner = customers.find((c) => c.id === selected) ?? null;

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  return (
    <PanelCtx.Provider value={{ selected, open }}>
      {/* The panel is a column beside the page, starting level with its
          heading, so the list narrows rather than disappearing under it. */}
      <div className={`cpanel-layout${partner ? " has-panel" : ""}`}>
        <div className="cpanel-main">{children}</div>
        {partner && (
          <CustomerPanel key={partner.id} partner={partner} priceLevels={priceLevels}
            categories={categories} updateAction={updateAction} onClose={() => setSelected(null)} />
        )}
      </div>
    </PanelCtx.Provider>
  );
}

const TABS = ["overview", "sales", "invoices", "activity"] as const;
type Tab = (typeof TABS)[number];

function CustomerPanel({ partner, priceLevels, categories, updateAction, onClose }: {
  partner: Partner;
  priceLevels: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  updateAction: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  onClose: () => void;
}) {
  const t = useTranslations("customerPanel");
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState(false);

  return (
    <aside className="cpanel" role="dialog" aria-label={partner.name}>
      <header className="cpanel-head">
        <div className="cpanel-title">
          <div className="cpanel-name">
            <h2 title={partner.name}>{partner.name}</h2>
            {partner.is_active
              ? <span className="pill ok">{t("active")}</span>
              : <span className="pill warn">{t("inactive")}</span>}
          </div>
          <span className="page-sub">{t("code", { code: partner.code })}</span>
        </div>
        <button type="button" className="ghost tiny" onClick={() => setEditing((e) => !e)}>
          <Pencil size={14} aria-hidden="true" /> {t("edit")}
        </button>
        <button type="button" className="cpanel-x" aria-label={t("close")} onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      {editing ? (
        <div className="cpanel-body">
          <PartnerEditForm partner={partner} priceLevels={priceLevels} categories={categories}
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
            {tab === "overview" && <Overview partner={partner} onActivity={() => setTab("activity")} onEdit={() => setEditing(true)} />}
            {tab === "sales" && <Sales partner={partner} />}
            {tab === "invoices" && <Invoices partner={partner} />}
            {tab === "activity" && <ActivityTab partner={partner} />}
          </div>
        </>
      )}
    </aside>
  );
}

/** One tab's data, fetched the first time the tab is shown. */
function useLoad<T>(load: () => Promise<T>) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let live = true;
    load().then((data) => live && setState({ data, loading: false }))
      .catch((e) => live && setState({ error: e instanceof Error ? e.message : String(e), loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}

function Loading() {
  const t = useTranslations("customerPanel");
  return <div className="cpanel-state">{t("loading")}</div>;
}
function Failed({ error }: { error: string }) {
  const t = useTranslations("customerPanel");
  return <div className="cpanel-state bad">{t("failed")} <span className="page-sub">{error}</span></div>;
}

function Section({ icon, title, action, children }: {
  icon: React.ReactNode; title: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="cpanel-sec">
      <div className="cpanel-sec-head">{icon}<h3>{title}</h3>{action}</div>
      <div className="cpanel-box">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="cpanel-field">
      <span>{label}</span>
      <strong>{children ?? "—"}</strong>
    </div>
  );
}

function CreditBlock({ partner, outstanding }: { partner: Partner; outstanding?: number }) {
  const t = useTranslations("customerPanel");
  const cs = creditState(partner);
  return (
    <>
      <div className="cpanel-grid">
        <Field label={t("outstanding")}>{money(outstanding ?? partner.outstanding)}</Field>
        <Field label={t("paymentTerms")}>
          {Number(partner.payment_terms_days) === 0 ? t("noCreditAllowed") : t("days", { n: partner.payment_terms_days })}
        </Field>
        <Field label={t("creditLimit")}>
          {cs.kind === "UNLIMITED" ? t("unlimited") : cs.kind === "NONE" ? t("noCredit") : money(cs.limit)}
        </Field>
        <Field label={t("leftToSpend")}>
          {cs.kind === "UNLIMITED" ? t("unlimited") : cs.kind === "NONE" ? "—"
            : cs.kind === "OVER" ? <span className="pill overdue">{t("overBy", { amount: money(-cs.left) })}</span>
            : money(cs.left)}
        </Field>
      </div>
      {(cs.kind === "LIMIT" || cs.kind === "OVER") && (
        <div className="cpanel-meter">
          <div className="cpanel-bar"><span className={cs.kind === "OVER" ? "over" : undefined} style={{ width: `${cs.pct}%` }} /></div>
          <div className="cpanel-meter-legend">
            <span>{t("used", { amount: money(cs.used), pct: Math.round((cs.used / cs.limit) * 100) })}</span>
            <span>{cs.kind === "OVER" ? t("overLimit") : t("available", { pct: Math.max(0, 100 - Math.round((cs.used / cs.limit) * 100)) })}</span>
          </div>
        </div>
      )}
    </>
  );
}

function Overview({ partner, onActivity, onEdit }: { partner: Partner; onActivity: () => void; onEdit: () => void }) {
  const t = useTranslations("customerPanel");
  const s = useLoad(() => customerOverview(partner.id));
  const editLink = <button type="button" className="cpanel-link" onClick={onEdit}>{t("edit")}</button>;
  return (
    <>
      <Section icon={<Building2 size={16} aria-hidden="true" />} title={t("companyContact")}>
        <div className="cpanel-grid">
          <Field label={t("companyName")}>{partner.company_name}</Field>
          <Field label={t("memberCard")}>{partner.member_card_id}</Field>
          <Field label={t("contactPerson")}>{partner.contact_person}</Field>
          <Field label={t("phone")}>{partner.phone}</Field>
          <Field label={t("email")}>{partner.email}</Field>
          <Field label={t("address")}>{partner.address}</Field>
        </div>
      </Section>
      <Section icon={<MapPin size={16} aria-hidden="true" />} title={t("location")} action={editLink}>
        <div className="cpanel-grid">
          <Field label={t("township")}>{partner.township}</Field>
          <Field label={t("region")}>{partner.region}</Field>
        </div>
      </Section>
      <Section icon={<Tag size={16} aria-hidden="true" />} title={t("pricingCategory")}>
        <div className="cpanel-grid">
          <Field label={t("priceLevel")}>{partner.price_level_name ?? t("default")}</Field>
          <Field label={t("category")}>{partner.category_name}</Field>
        </div>
      </Section>
      <Section icon={<CreditCard size={16} aria-hidden="true" />} title={t("creditTerms")} action={editLink}>
        <CreditBlock partner={partner} outstanding={s.data?.outstanding} />
        {s.data && s.data.overdue > 0 && (
          <div className="cpanel-note bad">{t("overdueAmount", { amount: money(s.data.overdue) })}</div>
        )}
      </Section>
      <Section icon={<StickyNote size={16} aria-hidden="true" />} title={t("notes")} action={editLink}>
        <p className="cpanel-notes">{partner.notes || <span className="page-sub">{t("noNotes")}</span>}</p>
      </Section>
      <Section icon={<Clock size={16} aria-hidden="true" />} title={t("recentActivity")}
        action={<button type="button" className="cpanel-link" onClick={onActivity}>{t("viewAll")}</button>}>
        {s.loading ? <Loading /> : s.error ? <Failed error={s.error} /> : <Timeline rows={s.data!.recent} />}
      </Section>
    </>
  );
}

const SOURCE_PILL: Record<string, string> = { SO: "draft", DO: "draft", SO_SI: "posted", DIRECT: "posted", POS: "ok" };

function Sales({ partner }: { partner: Partner }) {
  const t = useTranslations("customerPanel");
  const [pages, setPages] = useState<Awaited<ReturnType<typeof customerSales>>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const more = (offset: number) => {
    setBusy(true);
    customerSales(partner.id, offset).then((p) => setPages((x) => (offset === 0 ? [p] : [...x, p])))
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
        <div><span>{t("totalSales")}</span><strong>{money(sum.totalSales)}</strong></div>
        <div><span>{t("openOrders")}</span><strong>{sum.openOrders}</strong></div>
        <div><span>{t("pendingDeliveries")}</span><strong>{t("units", { n: sum.toDeliver })}</strong></div>
      </div>
      <p className="page-sub cpanel-explain">{t("salesExplain")}</p>
      {rows.length === 0 ? <div className="cpanel-state">{t("noSales")}</div> : (
        <table className="cpanel-table">
          <thead><tr><th>{t("reference")}</th><th>{t("source")}</th><th className="r">{t("amount")}</th><th>{t("status")}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/documents/${r.id}`}>{r.docNo ?? t("draft")}</Link>
                  <div className="subline">{day(r.date)}</div>
                </td>
                <td><span className={`pill ${SOURCE_PILL[r.source] ?? ""}`}>{t(`src.${r.source}`)}</span></td>
                <td className="r">{money(r.amount)}</td>
                <td>
                  {r.voided ? <span className="pill reversed">{t("voided")}</span>
                    : r.docType === "SALES_ORDER" && r.status === "POSTED"
                      ? (r.toDeliver ? <span className="pill warn">{t("toDeliver", { n: r.toDeliver })}</span>
                                     : <span className="pill ok">{t("delivered")}</span>)
                      : <span className={`pill ${r.status === "POSTED" ? "posted" : "draft"}`}>{t(`st.${r.status}`)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="cpanel-foot">
        {pages[pages.length - 1].more && (
          <button type="button" className="ghost tiny" disabled={busy} onClick={() => more(rows.length)}>
            {busy ? t("loading") : t("loadMore")}
          </button>
        )}
        <Link href={`/partners/${partner.id}`} className="cpanel-link">{t("viewAll")}</Link>
      </div>
    </>
  );
}

const PAY_PILL: Record<string, string> = { PAID: "ok", PARTIAL: "warn", UNPAID: "draft", OVERDUE: "overdue" };

function Invoices({ partner }: { partner: Partner }) {
  const t = useTranslations("customerPanel");
  const [pages, setPages] = useState<Awaited<ReturnType<typeof customerInvoices>>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openInv, setOpenInv] = useState<string | null>(null);
  const more = (offset: number) => {
    setBusy(true);
    customerInvoices(partner.id, offset).then((p) => setPages((x) => (offset === 0 ? [p] : [...x, p])))
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
        <div><span>{t("totalInvoiced")}</span><strong>{money(sum.invoiced)}</strong></div>
        <div><span>{t("outstanding")}</span><strong>{money(sum.outstanding)}</strong></div>
        <div><span>{t("overdue")}</span><strong className={sum.overdue > 0 ? "bad" : undefined}>{money(sum.overdue)}</strong></div>
        <div><span>{t("unpaidInvoices")}</span><strong>{sum.unpaid}</strong></div>
      </div>
      {rows.length === 0 ? <div className="cpanel-state">{t("noInvoices")}</div> : (
        <table className="cpanel-table">
          <thead><tr><th>{t("invoice")}</th><th className="r">{t("total")}</th><th className="r">{t("balance")}</th><th>{t("status")}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <InvoiceRow key={r.id} partnerId={partner.id} r={r}
                open={openInv === r.id} onToggle={() => setOpenInv((o) => (o === r.id ? null : r.id))} />
            ))}
          </tbody>
        </table>
      )}
      <div className="cpanel-foot">
        {pages[pages.length - 1].more && (
          <button type="button" className="ghost tiny" disabled={busy} onClick={() => more(rows.length)}>
            {busy ? t("loading") : t("loadMore")}
          </button>
        )}
        <Link href={`/partners/${partner.id}`} className="cpanel-link">{t("viewAll")}</Link>
      </div>
    </>
  );
}

function InvoiceRow({ partnerId, r, open, onToggle }: {
  partnerId: string;
  r: Awaited<ReturnType<typeof customerInvoices>>["rows"][number];
  open: boolean; onToggle: () => void;
}) {
  const t = useTranslations("customerPanel");
  return (
    <>
      <tr className={open ? "is-open" : undefined}>
        <td>
          <button type="button" className="cpanel-expand" aria-expanded={open} onClick={onToggle}
            aria-label={t("showPayments")}>
            {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          </button>
          <Link href={`/documents/${r.id}`}>{r.docNo}</Link>
          {r.pos && <span className="pill ok" style={{ marginLeft: 4 }}>{t("src.POS")}</span>}
          <div className="subline">{day(r.date)} · {t("due", { date: day(r.due) })}</div>
        </td>
        <td className="r">{money(r.total)}</td>
        <td className="r">{r.outstanding > 0 ? money(r.outstanding) : "—"}</td>
        <td><span className={`pill ${PAY_PILL[r.status]}`}>{t(`pay.${r.status}`)}</span></td>
      </tr>
      {open && (
        <tr className="cpanel-sub">
          <td colSpan={4}><Settlements partnerId={partnerId} invoiceId={r.id} /></td>
        </tr>
      )}
    </>
  );
}

function Settlements({ partnerId, invoiceId }: { partnerId: string; invoiceId: string }) {
  const t = useTranslations("customerPanel");
  const s = useLoad(() => invoiceSettlements(partnerId, invoiceId));
  if (s.loading) return <Loading />;
  if (s.error) return <Failed error={s.error} />;
  if (!s.data!.length) return <div className="cpanel-state">{t("noPayments")}</div>;
  return (
    <ul className="cpanel-pays">
      {s.data!.map((p) => (
        <li key={p.id + p.docType}>
          <Link href={`/documents/${p.id}`}>{p.docNo}</Link>
          <span className="page-sub">{docLabel(t, p.docType)}{p.channel ? ` · ${p.channel}` : ""} · {day(p.date)}</span>
          <strong>{money(p.amount)}</strong>
        </li>
      ))}
    </ul>
  );
}

function docLabel(t: ReturnType<typeof useTranslations>, type: string | null) {
  if (!type) return "";
  return t.has(`doc.${type}`) ? t(`doc.${type}`) : type.replace(/_/g, " ").toLowerCase();
}

function Timeline({ rows }: { rows: Activity[] }) {
  const t = useTranslations("customerPanel");
  if (!rows.length) return <div className="cpanel-state">{t("noActivity")}</div>;
  return (
    <ol className="cpanel-timeline">
      {rows.map((a, i) => (
        <li key={(a.docId ?? "c") + i} className={`k-${a.kind}`}>
          <div className="cpanel-tl-main">
            <strong>
              {a.kind === "CREATED" ? t("created")
                : a.kind === "VOID" ? t("voidedDoc", { doc: docLabel(t, a.docType) })
                : a.status && a.status !== "POSTED" ? t("drafted", { doc: docLabel(t, a.docType) })
                : docLabel(t, a.docType)}
            </strong>
            {a.docId && <Link href={`/documents/${a.docId}`}>{a.docNo ?? t("draft")}</Link>}
            {a.amount !== null && a.kind !== "CREATED" && <span>{money(a.amount)}</span>}
          </div>
          <div className="cpanel-tl-meta">{stamp(a.at)}{a.user ? ` · ${a.user}` : ""}</div>
        </li>
      ))}
    </ol>
  );
}

function ActivityTab({ partner }: { partner: Partner }) {
  const t = useTranslations("customerPanel");
  const [rows, setRows] = useState<Activity[]>([]);
  const [more, setMore] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | string>("loading");
  const load = (offset: number) => {
    setState("loading");
    customerActivity(partner.id, offset)
      .then((r) => { setRows((x) => (offset === 0 ? r.rows : [...x, ...r.rows])); setMore(r.more); setState("ready"); })
      .catch((e) => setState(String(e?.message ?? e)));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(0); }, []);
  if (state !== "loading" && state !== "ready") return <Failed error={state} />;
  return (
    <>
      {rows.length === 0 && state === "loading" ? <Loading /> : <Timeline rows={rows} />}
      <p className="page-sub cpanel-explain">{t("activityExplain")}</p>
      {more && (
        <div className="cpanel-foot">
          <button type="button" className="ghost tiny" disabled={state === "loading"} onClick={() => load(rows.length)}>
            {state === "loading" ? t("loading") : t("loadMore")}
          </button>
        </div>
      )}
    </>
  );
}

import Link from "next/link";
import { Pencil, Repeat, Trash2, Wallet, TrendingDown, Landmark, CalendarClock } from "lucide-react";
import { KpiCard } from "@/components/kpi-card";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { FA_STATUS_LABEL, type AssetRow } from "@/lib/fixed-assets";
import { sum, type ScheduleRow } from "@/lib/fa-engine";

/** Whole kyat for a group; a unit's share always to the cent, so its columns line up. */
const money = (u: bigint, cents = false) => {
  const v = Number(u) / 10_000;
  return v.toLocaleString("en-US", { minimumFractionDigits: cents || !Number.isInteger(v) ? 2 : 0, maximumFractionDigits: 2 });
};
const num = (s: string) => Number(s).toLocaleString("en-US", { maximumFractionDigits: 2 });
const monthLong = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const day = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const EVENT: Record<string, string> = {
  CREATED: "Added to the register", UPDATED: "Record edited", ACTIVATED: "Put into service", ESTIMATE_CHANGED: "Estimate changed",
  TRANSFERRED: "Transferred", DISPOSED: "Disposed of", DEPRECIATION_POSTED: "Depreciation posted", HISTORY_LINKED: "History linked",
  HISTORY_UNLINKED: "History unlinked", CORRECTED: "Correction posted", EXCEPTION: "Exception", DEACTIVATED: "Made inactive",
  REACTIVATED: "Made active again", SPLIT: "Units split off",
};

export type DetailUnit = { id: string; code: string; cost: bigint; assetId: string; branch: string; status: string };
export type DetailJournal = { m: string; source: string; is_link: boolean; doc_id: string; doc_no: string };
export type DetailEvent = { event_type: string; date: string; by: string | null; from_branch: string | null; to_branch: string | null; detail: any };

/**
 * One asset or one of its units: what it is, what the ledger carries for it,
 * and every month of its life. The unit page is this page with the unit's
 * share of each figure, so the two can never read differently.
 */
export function AssetDetail({ a, rows, journals, events, units, unit, canPost, now }: {
  a: AssetRow & { heading?: string }; rows: ScheduleRow[]; journals: DetailJournal[]; events: DetailEvent[];
  /** Every unit of the group (empty when it is a single asset). */
  units: DetailUnit[];
  /** Showing one unit: its code and cost; the figures in `rows` are already its share. */
  unit?: DetailUnit | null; canPost: boolean; now: string;
}) {
  const m = (u: bigint) => money(u, !!unit);
  const cost = unit ? unit.cost : BigInt(Math.round(Number(a.acquisition_cost) * 10_000));
  const posted = sum(rows.filter((r) => r.state === "POSTED").map((r) => r.amount));
  const next = rows.find((r) => r.state === "PLANNED" && r.month >= now) ?? rows.find((r) => r.state === "PLANNED");
  const postedMonths = rows.filter((r) => r.state === "POSTED").length;
  const byMonth = new Map<string, DetailJournal[]>();
  for (const j of journals) byMonth.set(j.m, [...(byMonth.get(j.m) ?? []), j]);
  const group = units.length > 1 && !unit;
  const unitsTotal = units.reduce((t, u) => t + u.cost, 0n);
  const base = `/fixed-assets/${a.id}`;
  const notes = a.notes ?? "";

  return (
    <div className="fa fad">
      <Breadcrumbs trail={[{ label: "Fixed Assets", href: "/fixed-assets" }, { label: "Asset Register", href: "/fixed-assets/register" },
        ...(unit ? [{ label: a.code, href: base }, { label: unit.code }] : [{ label: a.code }])]} />
      <div className="fa-head">
        <div>
          <h1>{a.name} <span className={`fa-status ${a.status.toLowerCase()}`}>{FA_STATUS_LABEL[a.status]}</span></h1>
          <p>{unit ? `${unit.code} · unit of ${a.code}` : a.code} · {a.category}</p>
        </div>
        {canPost && a.status !== "DISPOSED" && (
          <span className="fa-head-actions">
            {a.status !== "DRAFT" && <Link className="ie-btn" href={`${base}/transfer${unit ? `?unit=${unit.id}` : ""}`}><Repeat size={14} aria-hidden="true" /> Transfer</Link>}
            {a.status !== "DRAFT" && <Link className="ie-btn" href={`${base}/dispose${unit ? `?unit=${unit.id}` : ""}`}><Trash2 size={14} aria-hidden="true" /> Dispose</Link>}
            {!unit && <Link className="ie-btn" href={`${base}/edit`}><Pencil size={14} aria-hidden="true" /> Edit</Link>}
          </span>
        )}
      </div>

      <div className="kpis kpis-tiled kpis-compact fa-kpis">
        <KpiCard icon={<Wallet size={16} aria-hidden="true" />} label={group ? "Group cost" : unit ? "Unit cost" : "Cost"} value={m(cost)} unit="MMK"
          hint={group ? `${units.length} units; each unit's share is on its own page.` : `Acquired ${day(a.acquisition_date)}.`} />
        <KpiCard icon={<TrendingDown size={16} aria-hidden="true" />} label="Posted accumulated depreciation" value={m(posted)} unit="MMK"
          hint="Only what the ledger carries: posted runs, linked history and corrections." />
        <KpiCard icon={<Landmark size={16} aria-hidden="true" />} label="Posted book value" value={m(cost - posted)} unit="MMK"
          hint="Cost less posted accumulated depreciation." />
        <KpiCard icon={<CalendarClock size={16} aria-hidden="true" />} label="Scheduled monthly depreciation" value={next ? m(next.amount) : "—"} unit={next ? "MMK" : undefined}
          hint={next ? `Calculated for ${monthLong(next.month)}.` : "Nothing scheduled: fully depreciated, disposed or not in service."} />
      </div>

      <div className="fa-grid wide-left">
        <section className="card fa-panel">
          <div className="fa-panel-head">
            <h2>Depreciation schedule</h2>
            <span className={`fad-badge${postedMonths ? " posted" : ""}`}>{postedMonths ? `${postedMonths} month${postedMonths === 1 ? "" : "s"} posted` : "Calculated schedule · not posted"}</span>
          </div>
          <p className="fa-muted fad-sub">Straight line over {a.useful_life_months} months{unit ? ", this unit's share of each month" : ""}. Posted months are on the ledger; the rest are calculated.</p>
          {rows.length === 0 ? <p className="fa-muted">No schedule yet: the asset needs an in-service date and to be active.</p> : (
            <div className="fa-sched">
              <table className="ie-table">
                <thead><tr><th>Month</th><th className="r">Scheduled depreciation</th><th className="r">Scheduled closing NBV</th><th>Status</th>{journals.length > 0 && <th>Journal</th>}</tr></thead>
                <tbody>{rows.map((r) => {
                  const js = byMonth.get(r.month) ?? [];
                  const state = r.state === "POSTED" ? "posted" : r.month <= now ? "ready" : "planned";
                  return (
                    <tr key={r.month} className={r.month === now ? "fa-now" : undefined}>
                      <td className="nowrap">{monthLong(r.month)}</td>
                      <td className="r"><strong>{m(r.amount)}</strong></td>
                      <td className="r">{m(r.closing)}</td>
                      <td><span className={`fa-pill ${state}`}>{{ posted: "Posted", ready: "Ready to post", planned: "Planned" }[state]}</span></td>
                      {journals.length > 0 && <td>{js.length ? js.map((j) => (
                        <span key={j.doc_id + j.source} className="fa-jsrc">
                          <Link href={`/documents/${j.doc_id}`} className="fa-jlink">{j.doc_no}</Link>
                          <small>{j.is_link ? "Manual" : "Generated"}</small>
                        </span>)) : "—"}</td>}
                    </tr>);
                })}</tbody>
              </table>
            </div>
          )}
        </section>

        <div className="fa-side">
          {units.length > 1 && (
            <section className="card fa-panel">
              <div className="fa-panel-head"><h2>Individual units</h2><span className="fa-muted">Count: {units.length}</span></div>
              <p className="fa-muted fad-sub">Select units when transferring or disposing.</p>
              <table className="ie-table fad-units">
                <thead><tr><th>Unit code</th><th>Location</th><th>Status</th><th className="r">Cost</th></tr></thead>
                <tbody>{units.map((u) => (
                  <tr key={u.id} className={unit?.id === u.id ? "fad-this" : undefined}>
                    <td><Link href={`/fixed-assets/${u.assetId}/units/${u.id}`} className="fa-jlink">{u.code}</Link></td>
                    <td>{u.branch}</td>
                    <td><span className={`fa-status ${u.status.toLowerCase()}`}>{FA_STATUS_LABEL[u.status as keyof typeof FA_STATUS_LABEL] ?? u.status}</span></td>
                    <td className="r">{m(u.cost)}</td>
                  </tr>))}</tbody>
                {!unit && <tfoot><tr><th colSpan={3}>Total</th><th className="r">{m(unitsTotal)}</th></tr></tfoot>}
              </table>
            </section>
          )}

          <section className="card fa-panel">
            <div className="fa-panel-head"><h2>{unit ? "Unit details" : "Asset details"}</h2></div>
            <dl className="fad-facts">
              <div><dt>Category</dt><dd>{a.heading ?? "—"}</dd></div>
              <div><dt>Subcategory</dt><dd>{a.category}</dd></div>
              <div><dt>Useful life</dt><dd>{a.useful_life_months} months</dd></div>
              <div><dt>Acquired</dt><dd>{day(a.acquisition_date)}</dd></div>
              <div><dt>In service</dt><dd>{day(a.in_service_date)}</dd></div>
              <div><dt>Start</dt><dd>{a.depreciation_start ? monthLong(a.depreciation_start) : rows[0] ? `${monthLong(rows[0].month)} (by the rule)` : "—"}</dd></div>
              {!unit && <div><dt>Quantity</dt><dd>{num(a.quantity)}</dd></div>}
              <div><dt>Residual value</dt><dd>{unit ? m(rows[0]?.residual ?? 0n) : num(a.residual_value)}</dd></div>
              <div><dt>Location</dt><dd>{a.branch}{a.site ? ` · ${a.site}` : ""}</dd></div>
              {a.opening_accumulated && <div><dt>Opening accumulated</dt><dd>{num(a.opening_accumulated)} to {a.opening_through}</dd></div>}
            </dl>
          </section>

          {notes && (
            <section className="card fa-panel">
              <div className="fa-panel-head"><h2>Notes</h2></div>
              {notes.length > 140 ? (
                <details className="fad-notes"><summary><span className="fad-notes-short">{notes.slice(0, 140)}…</span><span className="fad-more">Show more</span></summary><p>{notes}</p></details>
              ) : <p className="fad-notes-text">{notes}</p>}
            </section>
          )}

          <section className="card fa-panel">
            <div className="fa-panel-head"><h2>History</h2></div>
            <ol className="fa-timeline">{events.map((e, k) => (
              <li key={k}><strong>{EVENT[e.event_type] ?? e.event_type}</strong>
                <span>{day(e.date)}{e.by ? ` · ${e.by}` : ""}{e.to_branch && e.from_branch ? ` · ${e.from_branch} → ${e.to_branch}` : ""}
                  {e.event_type === "SPLIT" && e.detail?.units ? ` · ${e.detail.units.join(", ")} → ${e.detail.to}` : ""}
                  {e.event_type === "UPDATED" && e.detail?.changed?.length ? ` · ${e.detail.changed.map((c: any) => c.field.replace(/_/g, " ")).join(", ")}` : ""}</span></li>))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}

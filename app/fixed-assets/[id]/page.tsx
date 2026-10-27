import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Wallet, TrendingDown, Landmark, CalendarClock, Hourglass } from "lucide-react";
import { requirePermission, can } from "@/lib/auth";
import { sql } from "@/lib/db";
import { seenLocations } from "@/lib/branch-scope";
import { assetList, FA_STATUS_LABEL } from "@/lib/fixed-assets";
import { loadSchedules, thisMonth } from "@/lib/fa-schedule";
import { addMonths, sum } from "@/lib/fa-engine";
import { changeEstimate } from "@/lib/fa-actions";
import { KpiCard } from "@/components/kpi-card";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { EstimateForm } from "@/components/estimate-form";

export const metadata = { title: "Asset" };

const kyat = (u: bigint) => Number(u / 10_000n).toLocaleString("en-US");
const num = (s: string) => Number(s).toLocaleString("en-US", { maximumFractionDigits: 0 });
const monthLong = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const EVENT: Record<string, string> = {
  CREATED: "Added to the register", UPDATED: "Record edited", ACTIVATED: "Put into service", ESTIMATE_CHANGED: "Estimate changed",
  TRANSFERRED: "Transferred", DISPOSED: "Disposed of", DEPRECIATION_POSTED: "Depreciation posted", HISTORY_LINKED: "History linked",
  HISTORY_UNLINKED: "History unlinked", CORRECTED: "Correction posted", EXCEPTION: "Exception", DEACTIVATED: "Made inactive", REACTIVATED: "Made active again",
};

/** One asset: what it is, what it is worth to the ledger, and every month of its life. */
export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("accounting.view");
  const co = user.companyId;
  const seen = await seenLocations();
  const [[a], [s]] = await Promise.all([assetList(co, seen, id), loadSchedules(co, { branches: seen, assetId: id })]);
  if (!a) notFound();
  const [journals, events, estimates] = await Promise.all([
    sql`select to_char(d.period_month, 'YYYY-MM') as m, d.source, d.amount::text, doc.id as doc_id, doc.doc_no
          from fa_depreciation d join journal_line jl on jl.id = d.journal_line_id
          join journal_entry je on je.id = jl.journal_entry_id left join document doc on doc.id = je.source_id
         where d.asset_id = ${id} order by d.period_month, d.created_at`,
    sql`select e.event_type, to_char(e.event_date, 'YYYY-MM-DD') as date, e.detail, u.name as by,
               fb.name as from_branch, tb.name as to_branch
          from fa_event e left join app_user u on u.id = e.created_by
          left join location fb on fb.id = e.from_branch_id left join location tb on tb.id = e.to_branch_id
         where e.asset_id = ${id} order by e.event_date desc, e.created_at desc`,
    sql`select to_char(effective_month, 'YYYY-MM') as m, useful_life_months, residual_value::text as residual, reason
          from fa_estimate_change where asset_id = ${id} order by effective_month`,
  ]);
  const rows = s?.rows ?? [];
  const now = thisMonth();
  const postedTotal = sum(rows.filter((r) => r.state === "POSTED").map((r) => r.amount));
  const nbv = (s?.engine.cost ?? 0n) - postedTotal;
  const next = rows.find((r) => r.state === "PLANNED" && r.month >= now);
  const remaining = rows.filter((r) => r.state === "PLANNED" && r.month >= now).length;
  const lastPosted = rows.filter((r) => r.state === "POSTED").at(-1)?.month;
  const byMonth = new Map<string, any[]>();
  for (const j of journals as any[]) byMonth.set(j.m, [...(byMonth.get(j.m) ?? []), j]);
  const latest = (estimates as any[]).at(-1);
  const canPost = can(user, "accounting.post");

  return (
    <div className="fa">
      <Breadcrumbs trail={[{ label: "Fixed Assets", href: "/fixed-assets" }, { label: "Asset Register", href: "/fixed-assets/register" }, { label: a.code }]} />
      <div className="fa-head">
        <div>
          <h1>{a.name} <span className={`fa-status ${a.status.toLowerCase()}`}>{FA_STATUS_LABEL[a.status]}</span></h1>
          <p>{a.code} · {a.category} · {a.branch}{a.site ? ` · ${a.site}` : ""}{a.serial_no ? ` · S/N ${a.serial_no}` : ""}</p>
        </div>
        {canPost && a.status !== "DISPOSED" && (
          <Link className="ie-btn" href={`/fixed-assets/${a.id}/edit`}><Pencil size={14} aria-hidden="true" /> Edit</Link>
        )}
      </div>

      <div className="kpis kpis-tiled kpis-compact fa-kpis fa-kpis-5">
        <KpiCard icon={<Wallet size={16} aria-hidden="true" />} label="Cost" value={num(a.acquisition_cost)} unit="MMK"
          hint={`Acquired ${a.acquisition_date}${a.in_service_date ? `, in service ${a.in_service_date}` : ""}.`} />
        <KpiCard icon={<TrendingDown size={16} aria-hidden="true" />} label="Accumulated" value={kyat(postedTotal)} unit="MMK"
          hint="Posted runs, linked history and corrections." />
        <KpiCard icon={<Landmark size={16} aria-hidden="true" />} label="Net book value" value={kyat(nbv)} unit="MMK"
          hint={`Cost less accumulated depreciation. Residual ${num(latest?.residual ?? a.residual_value)}.`} />
        <KpiCard icon={<CalendarClock size={16} aria-hidden="true" />} label="Next month" value={next ? kyat(next.amount) : "—"} unit={next ? "MMK" : undefined}
          hint={next ? `Planned for ${monthLong(next.month)}.` : "Nothing planned: fully depreciated, disposed or not in service."} />
        <KpiCard icon={<Hourglass size={16} aria-hidden="true" />} label="Months left" value={remaining}
          hint="Planned months from this one to the end of the useful life." />
      </div>

      <div className="fa-grid wide-left">
        <section className="card fa-panel">
          <div className="fa-panel-head">
            <h2>Depreciation schedule</h2>
            <span className="fa-muted">Straight line · {a.useful_life_months} months{latest ? `, now ${latest.useful_life_months}` : ""}</span>
          </div>
          {rows.length === 0 ? <p className="fa-muted">No schedule yet: the asset needs an in-service date and to be active.</p> : (
            <div className="fa-sched">
              <table className="ie-table">
                <thead><tr><th>Month</th><th className="r">Opening NBV</th><th className="r">Depreciation</th><th className="r">Closing NBV</th><th>State</th><th>Journal</th></tr></thead>
                <tbody>{rows.map((r) => {
                  const js = byMonth.get(r.month) ?? [];
                  const state = r.state === "POSTED" ? "posted" : r.month < now ? "due" : r.month === now ? "ready" : "planned";
                  return (
                    <tr key={r.month} className={r.month === now ? "fa-now" : undefined}>
                      <td className="nowrap">{monthLong(r.month)}</td>
                      <td className="r">{kyat(r.opening)}</td>
                      <td className="r"><strong>{kyat(r.amount)}</strong></td>
                      <td className="r">{kyat(r.closing)}</td>
                      <td><span className={`fa-pill ${state}`}>{{ posted: "Posted", due: "Not posted", ready: "Ready to post", planned: "Planned" }[state]}</span></td>
                      <td>{js.length ? js.map((j) => (
                        <Link key={j.doc_id + j.source} href={`/documents/${j.doc_id}`} className="fa-jlink">
                          {j.doc_no}{j.source !== "RUN" ? ` · ${j.source === "HISTORICAL" ? "history" : "correction"}` : ""}</Link>)) : "—"}</td>
                    </tr>);
                })}</tbody>
              </table>
            </div>
          )}
        </section>

        <div className="fa-side">
          {canPost && (a.status === "ACTIVE" || a.status === "INACTIVE") && (
            <section className="card fa-panel">
              <div className="fa-panel-head"><h2>Change of estimate</h2></div>
              <EstimateForm action={changeEstimate} assetId={a.id} life={latest?.useful_life_months ?? a.useful_life_months}
                residual={String(Number(latest?.residual ?? a.residual_value))}
                from={lastPosted ? addMonths(lastPosted, 1) : (rows[0]?.month ?? now)} />
              {(estimates as any[]).length > 0 && (
                <ul className="fa-est-list">{(estimates as any[]).map((e) => (
                  <li key={e.m}><strong>From {monthLong(e.m)}</strong>: {e.useful_life_months} months, residual {num(e.residual)}<span>{e.reason}</span></li>))}
                </ul>
              )}
            </section>
          )}
          <section className="card fa-panel">
            <div className="fa-panel-head"><h2>History</h2></div>
            <ol className="fa-timeline">{(events as any[]).map((e, k) => (
              <li key={k}><strong>{EVENT[e.event_type] ?? e.event_type}</strong>
                <span>{e.date}{e.by ? ` · ${e.by}` : ""}{e.to_branch && e.from_branch ? ` · ${e.from_branch} → ${e.to_branch}` : ""}
                  {e.event_type === "UPDATED" && e.detail?.changed?.length ? ` · ${e.detail.changed.map((c: any) => c.field.replace(/_/g, " ")).join(", ")}` : ""}</span></li>))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}

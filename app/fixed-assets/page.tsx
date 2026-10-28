import Link from "next/link";
import { HelpHint } from "@/components/help-hint";
import { canPostFa } from "@/lib/fa-access";
import { Landmark, Layers, TrendingDown, Wallet, CalendarClock, Hourglass, AlertTriangle, Plus, ArrowRight } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { faOverview } from "@/lib/fa-overview";
import { KpiCard } from "@/components/kpi-card";
import { Breadcrumbs } from "@/components/breadcrumbs";

export const metadata = { title: "Fixed Assets" };

const kyat = (u: bigint) => Number(u / 10_000n).toLocaleString("en-US");
const monthName = (m: string, style: "short" | "long" = "short") =>
  new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: style, timeZone: "UTC" });

/**
 * The asset subledger at a glance: what is held, what it cost, what the
 * ledger has written off, what is due and what would stop it posting. Every
 * figure is read from the register and the posted journals.
 */
export default async function FixedAssetsOverview() {
  const user = await requirePermission("accounting.view");
  const o = await faOverview(user.companyId, await seenLocations());
  const peak = o.trend.reduce((m, t) => (t.posted + t.planned > m ? t.posted + t.planned : m), 1n);

  return (
    <div className="fa">
      <Breadcrumbs trail={[{ label: "Fixed Assets" }, { label: "Overview" }]} />
      <div className="fa-head">
        <div>
          <h1>Fixed Assets <HelpHint label="About Fixed Assets">The shop&apos;s assets, their depreciation and what the ledger carries for them.</HelpHint></h1>
        </div>
        {canPostFa(user) && (
          <Link className="ie-btn primary" href="/fixed-assets/new"><Plus size={15} aria-hidden="true" /> Add asset</Link>
        )}
      </div>

      <div className="kpis kpis-tiled kpis-compact fa-kpis">
        <KpiCard icon={<Landmark size={16} aria-hidden="true" />} label="Registered assets" value={o.counts.total}
          hint={`${o.counts.active} active · ${o.counts.draft} draft · ${o.counts.disposed} disposed.`} />
        <KpiCard icon={<Layers size={16} aria-hidden="true" />} label="Active assets" value={o.counts.active}
          hint="In service and depreciating each month." />
        <KpiCard icon={<Wallet size={16} aria-hidden="true" />} label="Acquisition cost" value={kyat(o.cost)} unit="MMK"
          hint="What the assets still held cost, drafts and disposals left out." />
        <KpiCard icon={<TrendingDown size={16} aria-hidden="true" />} label="Accumulated depreciation" value={kyat(o.accumulated)} unit="MMK"
          hint="Everything the ledger carries for them: posted runs, linked history and corrections." />
        <KpiCard icon={<Landmark size={16} aria-hidden="true" />} label="Net book value" value={kyat(o.nbv)} unit="MMK"
          hint="Cost less accumulated depreciation." />
        <KpiCard icon={<CalendarClock size={16} aria-hidden="true" />} label={`${monthName(o.now, "long")} depreciation`} value={kyat(o.thisMonth)} unit="MMK"
          hint="This month's charge for the active assets, posted or planned." />
        <KpiCard icon={<Hourglass size={16} aria-hidden="true" />} label="Pending depreciation" value={kyat(o.pending.amount)} unit="MMK"
          tone={o.pending.amount > 0n ? "warn" : undefined}
          hint={`Due up to this month and not yet on the ledger, across ${o.pending.assets} assets.`} />
        <KpiCard icon={<AlertTriangle size={16} aria-hidden="true" />} label="Posting exceptions" value={o.exceptionCount}
          tone={o.exceptionCount > 0 ? "bad" : undefined}
          hint="A category whose accounts cannot be posted to, or a run that failed." />
      </div>

      {o.branches.length > 0 && (
        <section className="card fa-mgr">
          <div className="fa-panel-head">
            <div>
              <h2>Company Depreciation Manager</h2>
              <span className="fa-muted">{o.branches.length > 1 ? "All assets · all branches" : "Your branch"} · monthly depreciation, {monthName(o.now, "long")}</span>
            </div>
            <Link className="ie-link" href="/fixed-assets/calendar">Calendar <ArrowRight size={13} aria-hidden="true" /></Link>
          </div>
          <div className="fa-mgr-grid">
            {o.branches.map((b) => (
              <Link key={b.branchId} className="fa-mgr-card" href={`/fixed-assets/calendar?branch=${b.branchId}`}>
                <span className="fa-mgr-name">{b.branch}</span>
                <strong>{kyat(b.amount)}</strong>
                <small>MMK / month · {b.assets} asset{b.assets === 1 ? "" : "s"}</small>
                <span className={`fa-pill ${b.posted >= b.amount ? "posted" : b.posted > 0n ? "partial" : "ready"}`}>
                  {b.posted >= b.amount ? "Posted" : b.posted > 0n ? "Partly posted" : "Ready to post"}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {o.exceptionCount > 0 && (
        <section className="fa-alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>
            {o.exceptions.mapping.map((m) => (
              <p key={m.id}><strong>{m.name}</strong>: account {m.bad.join(", ")} is inactive or not postable, so its depreciation cannot post.</p>
            ))}
            {o.exceptions.failed.map((f) => (
              <p key={f.id}><strong>{f.branch} · {f.month}</strong>: the run failed{f.error ? `: ${f.error}` : ""}.</p>
            ))}
          </div>
        </section>
      )}

      <div className="fa-grid">
        <section className="card fa-panel">
          <div className="fa-panel-head">
            <h2>Depreciation, last 12 months</h2>
            <span className="fa-legend"><i className="posted" /> Posted <i className="planned" /> Not yet posted</span>
          </div>
          <div className="fa-trend" role="img" aria-label="Monthly depreciation, posted and not yet posted">
            {o.trend.map((t) => {
              const h = (v: bigint) => `${Number((v * 1000n) / peak) / 10}%`;
              return (
                <div key={t.month} className="fa-trend-col" title={`${monthName(t.month, "long")}: ${kyat(t.posted)} posted, ${kyat(t.planned)} not yet`}>
                  <span className="fa-trend-bar">
                    <span className="planned" style={{ height: h(t.planned) }} />
                    <span className="posted" style={{ height: h(t.posted) }} />
                  </span>
                  <small>{monthName(t.month)}</small>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card fa-panel">
          <div className="fa-panel-head">
            <h2>By category</h2>
            <Link className="ie-link" href="/fixed-assets/register">Asset register <ArrowRight size={13} aria-hidden="true" /></Link>
          </div>
          {o.categories.length === 0 ? (
            <p className="fa-muted">No assets in service yet.</p>
          ) : (
            <table className="ie-table">
              <thead><tr><th>Category</th><th className="r">Assets</th><th className="r">Cost</th><th className="r">Accum.</th><th className="r">NBV</th></tr></thead>
              <tbody>{o.categories.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}{c.assetClass === "INTANGIBLE" && <span className="subline">Amortised</span>}</td>
                  <td className="r">{c.n}</td><td className="r">{kyat(c.cost)}</td>
                  <td className="r">{kyat(c.accumulated)}</td><td className="r"><strong>{kyat(c.cost - c.accumulated)}</strong></td>
                </tr>))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

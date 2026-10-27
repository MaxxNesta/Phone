import Link from "next/link";
import { canPostFa } from "@/lib/fa-access";
import {
  ChevronLeft, ChevronRight, CheckCircle2, Clock, CalendarDays, AlertTriangle, CircleDashed, MinusCircle, Search,
  ArrowDownRight, ArrowUpRight, Package, Wrench, FileText, Repeat, Trash2, CircleAlert,
} from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { sql } from "@/lib/db";
import { prepareDepreciation, postDepreciation, discardDepreciation } from "@/lib/fa-actions";
import { FaPostControls, type BranchPosting } from "@/components/fa-post-controls";
import { seenLocations, seenBranches } from "@/lib/branch-scope";
import { calendar, type MonthStatus, type CalEvent } from "@/lib/fa-calendar";
import { faBranches, faCategories, FA_STATUS, FA_STATUS_LABEL } from "@/lib/fixed-assets";
import { thisMonth } from "@/lib/fa-schedule";
import { toUnits, addMonths } from "@/lib/fa-engine";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { AutoApply } from "@/components/auto-apply";

export const metadata = { title: "Depreciation Calendar" };

type SP = Record<string, string | undefined>;
const kyat = (s: string) => Number(toUnits(s) / 10_000n).toLocaleString("en-US");
const compactK = (s: string) => {
  const n = Number(toUnits(s) / 10_000n);
  return n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);
};
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const STATUS: Record<MonthStatus, { label: string; icon: React.ReactNode }> = {
  POSTED: { label: "Posted", icon: <CheckCircle2 size={16} aria-hidden="true" /> },
  READY: { label: "Ready to post", icon: <Clock size={16} aria-hidden="true" /> },
  PARTIAL: { label: "Partially posted", icon: <CircleDashed size={16} aria-hidden="true" /> },
  PLANNED: { label: "Planned", icon: <CalendarDays size={16} aria-hidden="true" /> },
  UNRECONCILED: { label: "Unreconciled", icon: <CircleAlert size={16} aria-hidden="true" /> },
  EXCEPTION: { label: "Exception", icon: <AlertTriangle size={16} aria-hidden="true" /> },
  NONE: { label: "No eligible assets", icon: <MinusCircle size={16} aria-hidden="true" /> },
};
const EVENT_ICON: Record<CalEvent["kind"], React.ReactNode> = {
  ACQUIRED: <Package size={12} aria-hidden="true" />, IN_SERVICE: <Wrench size={12} aria-hidden="true" />,
  DUE: <Clock size={12} aria-hidden="true" />, POSTED: <FileText size={12} aria-hidden="true" />,
  TRANSFER: <Repeat size={12} aria-hidden="true" />, DISPOSAL: <Trash2 size={12} aria-hidden="true" />,
  EXCEPTION: <CircleAlert size={12} aria-hidden="true" />,
};
const TABS = [["assets", "Assets"], ["schedule", "Schedule"], ["journal", "Journal"],
              ["impact", "Impact"], ["history", "History"]] as const;

/**
 * Twelve months of depreciation at a glance, one month opened beside them,
 * and the month's events day by day. Every choice is in the address, so a
 * linked journal and back again lands on the same month, day and filters.
 */
export default async function DepreciationCalendar({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requirePermission("accounting.view");
  const co = user.companyId;
  const now = thisMonth();
  const year = Number(sp.year) || Number(now.slice(0, 4));
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) && sp.month.startsWith(String(year)) ? sp.month
    : now.startsWith(String(year)) ? now : `${year}-01`;
  const day = sp.day && sp.day.startsWith(month) ? sp.day : null;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "assets";

  const [branches, categories, seen] = await Promise.all([faBranches(co).then(seenBranches), faCategories(co), seenLocations()]);
  const c = await calendar(co, year, month, {
    branches: seen, branchId: branches.some((b) => b.id === sp.branch) ? sp.branch : undefined,
    categoryId: categories.some((x) => x.id === sp.category) ? sp.category : undefined,
    status: FA_STATUS.includes(sp.status as never) ? sp.status : undefined, q: sp.q,
  });

  /** This page's address with some choices changed. */
  const href = (patch: SP) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) q.set(k, v);
    return `/fixed-assets/calendar?${q}`;
  };
  const sel = c.months.find((m) => m.month === month)!;
  const [yy, mm] = month.split("-").map(Number);
  const first = new Date(Date.UTC(yy, mm - 1, 1));
  const days = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const cells = Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, k) => k - lead + 1);
  const today = new Date(Date.now() + 6.5 * 3600_000).toISOString().slice(0, 10);
  const byDay = new Map<string, CalEvent[]>();
  for (const e of c.events) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const dayEvents = day ? byDay.get(day) ?? [] : [];
  // What the month's vouchers would post, in whole kyat.
  const toPost = Number(c.journal.reduce((s, j) => s + toUnits(j.total), 0n) / 10_000n).toLocaleString("en-US");
  // Review & post, one row per branch with something open or already posted this month.
  const [setting] = await sql`select posting_mode from fa_setting where company_id = ${co}`;
  const postings = new Map<string, BranchPosting>();
  for (const a of c.detail) {
    if (a.state !== "PLANNED") continue;
    const p = postings.get(a.branchId) ?? { branchId: a.branchId, branch: a.branch, amount: "0", assets: 0, run: null };
    p.amount = String(Number(p.amount) + Number(a.amount)); p.assets++;
    postings.set(a.branchId, p);
  }
  for (const r of c.runs.filter((x) => x.status === "DRAFT" || x.status === "POSTED")) {
    const counted = r.status === "POSTED" ? c.detail.filter((a) => a.branchId === r.branch_id && a.state === "POSTED").length : 0;
    const p = postings.get(r.branch_id) ?? { branchId: r.branch_id, branch: r.branch, amount: r.total, assets: counted, run: null };
    p.run = { id: r.id, status: r.status, docId: r.doc_id, docNo: r.doc_no };
    postings.set(r.branch_id, p);
  }
  const prevM = addMonths(month, -1), nextM = addMonths(month, 1);
  const pct = (m: (typeof c.months)[number]) => {
    const e = toUnits(m.expected);
    return e > 0n ? Number((toUnits(m.posted) * 100n) / e) : 0;
  };

  return (
    <div className="fa fac">
      <Breadcrumbs trail={[{ label: "Fixed Assets", href: "/fixed-assets" }, { label: "Depreciation Calendar" }]} />
      <div className="fa-head">
        <div>
          <h1>Depreciation Calendar</h1>
          <p>Each month&apos;s depreciation, what is posted, and the asset events behind it.</p>
        </div>
      </div>

      <form method="get" className="fac-bar">
        <input type="hidden" name="year" value={year} />
        <div className="fac-year">
          <Link href={href({ year: String(year - 1), month: undefined, day: undefined })} aria-label="Previous year" scroll={false}><ChevronLeft size={16} /></Link>
          <strong>{year}</strong>
          <Link href={href({ year: String(year + 1), month: undefined, day: undefined })} aria-label="Next year" scroll={false}><ChevronRight size={16} /></Link>
        </div>
        <Link className="ie-btn" href={href({ year: now.slice(0, 4), month: now, day: today })} scroll={false}>Today</Link>
        <span className="sp" />
        {branches.length > 1 && (
          <select name="branch" defaultValue={sp.branch ?? ""} aria-label="Branch" className={`dt-filter${sp.branch ? " dt-filter-on" : ""}`}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <select name="category" defaultValue={sp.category ?? ""} aria-label="Category" className={`dt-filter${sp.category ? " dt-filter-on" : ""}`}>
          <option value="">All categories</option>
          {categories.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select name="status" defaultValue={sp.status ?? ""} aria-label="Asset status" className={`dt-filter${sp.status ? " dt-filter-on" : ""}`}>
          <option value="">All statuses</option>
          {FA_STATUS.filter((s) => s !== "DRAFT").map((s) => <option key={s} value={s}>{FA_STATUS_LABEL[s]}</option>)}
        </select>
        <label className="dt-search">
          <Search size={15} aria-hidden="true" />
          <input name="q" type="search" defaultValue={sp.q ?? ""} data-live placeholder="Search asset…" aria-label="Search asset" />
        </label>
        {sp.month && <input type="hidden" name="month" value={sp.month} />}
        <AutoApply />
      </form>

      <div className="fac-layout">
        <div className="fac-main">
          <section className="fac-months" aria-label={`${year} by month`}>
            {c.months.map((m, k) => {
              const status = STATUS[m.status];
              return (
                <Link key={m.month} href={href({ month: m.month, day: undefined })} scroll={false}
                  className={`fac-month ${m.status.toLowerCase()}`} aria-current={m.month === month ? "true" : undefined}>
                  <span className="fac-month-top">
                    <strong>{MONTH[k]}</strong>
                    <span className="fac-month-ico" title={status.label}>{status.icon}</span>
                  </span>
                  <span className="fac-month-amt">{m.status === "NONE" ? "—" : kyat(m.expected)}<small> MMK</small></span>
                  <span className="fac-month-meta">
                    <span className={`fa-pill ${m.status.toLowerCase()}`}>{status.label}</span>
                    {m.warnings > 0 && <span className="fac-warn" title={`${m.warnings} warning${m.warnings === 1 ? "" : "s"}`}><AlertTriangle size={11} aria-hidden="true" /> {m.warnings}</span>}
                  </span>
                  <span className="fac-progress" aria-label={`${pct(m)}% posted`}><span style={{ width: `${pct(m)}%` }} /></span>
                  <span className="fac-month-foot">
                    <span>{m.assets} asset{m.assets === 1 ? "" : "s"}</span>
                    {m.status === "PARTIAL" && <span>{kyat(m.remaining)} left</span>}
                  </span>
                </Link>
              );
            })}
          </section>

          <section className="card fac-days">
            <div className="fa-panel-head">
              <h2>{MONTH[mm - 1]} {yy}</h2>
              <span className="fac-key">
                <i className="posted" /> Posted <i className="due" /> Due <i className="asset" /> Asset event <i className="exception" /> Exception
              </span>
            </div>
            <div className="fac-grid" role="grid">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <span key={d} className="fac-dow" role="columnheader">{d}</span>)}
              {cells.map((d, k) => {
                if (d < 1 || d > days) return <span key={k} className="fac-cell out" />;
                const date = `${month}-${String(d).padStart(2, "0")}`;
                const evs = byDay.get(date) ?? [];
                return (
                  <Link key={k} href={href({ day: day === date ? undefined : date })} scroll={false} role="gridcell"
                    className={`fac-cell${date === today ? " today" : ""}`} aria-current={date === day ? "date" : undefined}>
                    <span className="fac-num">{d}</span>
                    {evs.slice(0, 2).map((e, i) => (
                      <span key={i} className={`fac-chip ${e.kind.toLowerCase()}`}>{EVENT_ICON[e.kind]}
                        <span>{e.kind === "DUE" || e.kind === "POSTED" ? compactK(e.amount ?? "0") : e.label}</span></span>
                    ))}
                    {evs.length > 2 && <span className="fac-more">+{evs.length - 2} more</span>}
                  </Link>
                );
              })}
            </div>
          </section>
        </div>

        <aside className="card fac-panel">
          {day ? (
            <>
              <div className="fac-panel-head">
                <div>
                  <h2>{Number(day.slice(8))} {MONTH[mm - 1]} {yy}</h2>
                  <p>{dayEvents.length ? `${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}` : "Nothing happened on this day."}</p>
                </div>
                <Link href={href({ day: undefined })} scroll={false} className="fac-x" aria-label="Back to the month">×</Link>
              </div>
              <ul className="fac-events">
                {dayEvents.map((e, i) => (
                  <li key={i} className={e.kind.toLowerCase()}>
                    <span className="fac-ev-ico">{EVENT_ICON[e.kind]}</span>
                    <span className="fac-ev-body"><strong>{e.label}</strong><span>{e.detail}</span></span>
                    {e.amount && <span className="fac-ev-amt">{kyat(e.amount)}</span>}
                    {e.href && <Link href={e.href} className="fac-ev-go" aria-label="Open">›</Link>}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <div className="fac-mhead">
                <div className="fac-mhead-top">
                  <h2>{MONTH[mm - 1]} {yy} <span className={`fa-pill ${sel.status.toLowerCase()}`}>{STATUS[sel.status].label}</span></h2>
                  <span className="fac-mnav">
                    <Link href={href({ year: prevM.slice(0, 4), month: prevM, day: undefined })} scroll={false} aria-label="Previous month"><ChevronLeft size={16} /></Link>
                    <Link href={href({ year: nextM.slice(0, 4), month: nextM, day: undefined })} scroll={false} aria-label="Next month"><ChevronRight size={16} /></Link>
                  </span>
                </div>
                <p>{sel.assets ? `Monthly depreciation for ${sel.assets} asset${sel.assets === 1 ? "" : "s"}` : "No asset depreciates this month"}</p>
                <div className="fac-mhead-amt">
                  <strong>{kyat(sel.expected)}<small> MMK</small></strong>
                  {tab !== "journal" && sel.status !== "PLANNED" && sel.status !== "NONE" && toUnits(sel.remaining) > 0n && (
                    <Link className="fac-review" href={href({ tab: "journal" })} scroll={false}><FileText size={15} aria-hidden="true" /> Review journal</Link>
                  )}
                </div>
              </div>
              <dl className="fac-sum">
                <div><dt>Eligible assets</dt><dd>{sel.assets}</dd></div>
                <div><dt>Calculated</dt><dd>{kyat(sel.expected)}<small> MMK</small></dd></div>
                <div><dt>Posted</dt><dd className="ok">{kyat(sel.posted)}<small> MMK</small></dd></div>
                <div><dt>Remaining</dt><dd>{kyat(sel.remaining)}<small> MMK</small></dd></div>
              </dl>

              {c.unlinked.length > 0 && (
                <p className="fac-unrec">
                  <CircleAlert size={14} aria-hidden="true" />
                  <span>{c.unlinked.reduce((s, u) => s + u.lines, 0)} manual depreciation entr{c.unlinked.reduce((s, u) => s + u.lines, 0) === 1 ? "y" : "ies"} this month
                    ({kyat(c.unlinked.reduce((s, u) => String(Number(s) + Number(u.amount)), "0"))} MMK) not linked to assets yet. Link before posting, so nothing is recorded twice.</span>
                  <Link href={`/fixed-assets/reconcile?month=${month}`}>Reconcile</Link>
                </p>
              )}

              <nav className="fac-tabs" aria-label="Month detail">
                {TABS.map(([k, l]) => (
                  <Link key={k} href={href({ tab: k === "assets" ? undefined : k })} scroll={false} aria-current={tab === k ? "page" : undefined}>{l}</Link>
                ))}
              </nav>

              {tab === "assets" && (
                c.detail.length === 0 ? <p className="fa-muted">No asset depreciates in this month.</p> : (
                  <table className="fac-grid-table">
                    <thead><tr><th>Asset</th><th className="r">Monthly depreciation</th><th className="r">Book value after</th><th>Status</th></tr></thead>
                    <tbody>{c.detail.map((a) => {
                      const st = a.state === "POSTED" ? ["posted", "Posted"] : a.warning ? ["exception", "Exception"]
                        : sel.status === "PLANNED" ? ["planned", "Planned"] : ["ready", "Ready to post"];
                      return (
                        <tr key={a.id}>
                          <td><Link href={`/fixed-assets/${a.id}`} className="fac-asset"><strong>{a.name}</strong><small>{a.code} · {a.branch}{a.usedAt ? ` · used at ${a.usedAt}` : ""}</small></Link>
                            {a.warning && <small className="fac-warn-line">{a.warning}</small>}</td>
                          <td className="r num">{kyat(a.amount)}</td>
                          <td className="r num">{kyat(a.closing)}</td>
                          <td><span className={`fa-pill ${st[0]}`}>{st[1]}</span></td>
                        </tr>);
                    })}</tbody>
                    <tfoot><tr><td>Total</td><td className="r num">{kyat(sel.expected)}</td><td className="r">—</td><td className="r">{sel.assets} asset{sel.assets === 1 ? "" : "s"}</td></tr></tfoot>
                  </table>
                )
              )}

              {tab === "schedule" && (
                c.schedule.length === 0 ? <p className="fa-muted">Nothing scheduled.</p> : (
                  <table className="ie-table fac-table">
                    <thead><tr><th>Category</th><th className="r">Assets</th><th className="r">Amount</th><th className="r">Posted</th></tr></thead>
                    <tbody>{c.schedule.map((s) => (
                      <tr key={s.category}><td>{s.category}</td><td className="r">{s.assets}</td><td className="r">{kyat(s.amount)}</td><td className="r">{kyat(s.posted)}</td></tr>))}
                    </tbody>
                    <tfoot><tr><td>Total</td><td className="r">{sel.assets}</td><td className="r">{kyat(sel.expected)}</td><td className="r">{kyat(sel.posted)}</td></tr></tfoot>
                  </table>
                )
              )}

              {tab === "journal" && sel.status !== "PLANNED" && sel.status !== "NONE" && (
                <FaPostControls month={month} branches={[...postings.values()]} mode={setting?.posting_mode ?? "REVIEW"}
                  canPost={canPostFa(user)} prepare={prepareDepreciation} post={postDepreciation} discard={discardDepreciation} />
              )}
              {tab === "journal" && (
                c.journal.length === 0 ? <p className="fa-muted">Nothing left to post for this month.</p> : c.journal.map((j) => (
                  <div key={j.branchId} className="fac-jv">
                    <h3>Journal voucher · {j.branch}</h3>
                    <table className="ie-table fac-table">
                      <thead><tr><th>Account</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
                      <tbody>{j.lines.map((l) => (
                        <tr key={l.accountId}><td><span className="mono">{l.code}</span> · {l.name}<small className="subline">{l.assets} asset{l.assets === 1 ? "" : "s"}</small></td>
                          <td className="r">{l.debit !== "0.0000" ? kyat(l.debit) : "—"}</td><td className="r">{l.credit !== "0.0000" ? kyat(l.credit) : "—"}</td></tr>))}
                      </tbody>
                      <tfoot><tr><td>Total</td><td className="r">{kyat(j.total)}</td><td className="r">{kyat(j.total)}</td></tr></tfoot>
                    </table>
                  </div>
                ))
              )}

              {tab === "impact" && (
                <div className="fac-impact">
                  {c.journal.length === 0 ? <p className="fa-muted">Nothing left to post, so no further effect on the books for this month.</p> : <>
                    <p className="fac-impact-row debit"><ArrowDownRight size={15} aria-hidden="true" /><span><strong>Debit</strong> depreciation expense
                      <small>Profit &amp; Loss: an expense of {toPost} MMK lowers this month&apos;s profit.</small></span></p>
                    <p className="fac-impact-row credit"><ArrowUpRight size={15} aria-hidden="true" /><span><strong>Credit</strong> accumulated depreciation
                      <small>Balance Sheet: the contra-asset grows by the same amount, so net book value falls by it. The asset accounts themselves (cost) do not change.</small></span></p>
                    <p className="fac-impact-row"><MinusCircle size={15} aria-hidden="true" /><span><strong>Cash does not change</strong>
                      <small>Depreciation never touches a cash or bank account; the cash-flow statement adds it back as a non-cash charge.</small></span></p>
                    <h3>Exactly what posts</h3>
                    {c.journal.map((j) => (
                      <div key={j.branchId} className="fac-impact-jv">
                        <strong>{j.branch}</strong>
                        {j.lines.map((l) => (
                          <span key={l.accountId}>{l.debit !== "0.0000" ? "Dr" : "Cr"} {l.code} {l.name}<b>{kyat(l.debit !== "0.0000" ? l.debit : l.credit)}</b></span>))}
                      </div>
                    ))}
                  </>}
                </div>
              )}

              {tab === "history" && (
                c.runs.length === 0 && c.links.length === 0 ? <p className="fa-muted">Nothing has been posted or linked for this month yet.</p> : (
                  <ul className="fac-history">
                    {c.runs.map((r) => (
                      <li key={r.id}><span className={`fa-pill ${r.status === "POSTED" ? "posted" : r.status === "FAILED" ? "exception" : "planned"}`}>{r.status.toLowerCase()}</span>
                        <span><strong>{r.branch}</strong> · {kyat(r.total)} MMK <span className="fa-src">Generated</span>
                          <small>{r.posted_at ? `Posted ${r.posted_at}` : `Created ${r.created_at}`}{r.approved_by ? ` · approved by ${r.approved_by}` : r.created_by ? ` · by ${r.created_by}` : ""}{r.error ? ` · ${r.error}` : ""}</small></span>
                        {r.doc_id && <Link href={`/documents/${r.doc_id}`} className="fa-jlink">{r.doc_no}</Link>}</li>))}
                    {c.links.map((l, i) => (
                      <li key={`l${i}`}><span className="fa-pill posted">{l.source === "CORRECTION" ? "correction" : "posted"}</span>
                        <span><strong>{l.code}</strong> · {l.name} · {kyat(l.amount)} MMK <span className="fa-src">Manual</span><small>{l.date}</small></span>
                        {l.doc_id && <Link href={`/documents/${l.doc_id}`} className="fa-jlink">{l.doc_no}</Link>}</li>))}
                  </ul>
                )
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}


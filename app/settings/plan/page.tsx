import Link from "next/link";
import { Crown, Gem, Star, Users, UserCheck, Puzzle, Activity as ActivityIcon, Sparkles, ArrowUpRight } from "lucide-react";
import { sql } from "@/lib/db";
import { getCompany } from "@/lib/queries";
import { requirePermission, can, ROLE_LABEL } from "@/lib/auth";
import { SESSION_IDLE_MINUTES } from "@/lib/auth-core";
import type { Role } from "@/lib/roles";
import { setCompanyPlan, setCompanyModules } from "@/lib/actions";
import { PLAN_LIMITS, PLAN_NAME, PLAN_ORDER, planSwitchable, MODULES, CORE_MODULES, STANDARD_UP_ADDONS, packageSeatsAt, type Plan } from "@/lib/plans";
import { ModuleSwitcher } from "@/components/module-switcher";
import { PlanSwitcher } from "@/components/plan-switcher";
import { ordersAndDeliveriesOn, serialTrackingOn, sparePartsOn } from "@/lib/features";
import { DISPLAY_TZ } from "@/lib/format";

export const metadata = { title: "Package & seats" };

/**
 * The account at a glance, in five tabs that never mix: what the package
 * includes (Package), how many people may sign in and who holds each place
 * (Seats), the people themselves with when they were last in (Members), and
 * the sign-in log (Activity). All of it is set by the provider and read-only
 * here; editing people stays on Settings → Users.
 */
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "package", label: "Package" },
  { key: "seats", label: "Seats" },
  { key: "members", label: "Members", needs: "users.manage" },
  { key: "activity", label: "Activity", needs: "users.manage" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const SEAT_NAME: Record<string, string> = { sales: "Sales", purchases: "Purchases", inventory: "Inventory", accounting: "Accounting" };
const PLAN_ICON = { ENTERPRISE: Crown, BUSINESS: Gem, STARTER: Star } as const;
// Online: seen in the last 5 minutes; away: a session still open but quiet.
const ONLINE_MIN = 5;

const when = (d: unknown) => d ? new Date(d as string).toLocaleString("en-GB", {
  timeZone: DISPLAY_TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
const ago = (d: unknown) => {
  if (!d) return "Never";
  const mins = Math.round((Date.now() - new Date(d as string).getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
};
const span = (a: unknown, b: unknown) => {
  if (!a || !b) return "";
  const m = Math.max(0, Math.round((new Date(b as string).getTime() - new Date(a as string).getTime()) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

export default async function PackageAndSeats({ searchParams }: { searchParams: Promise<{ tab?: string; page?: string }> }) {
  const user = await requirePermission("settings.manage");
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;
  const sp = await searchParams;
  const seePeople = can(user, "users.manage");
  const tabs = TABS.filter((t) => !("needs" in t) || seePeople);
  const tab: TabKey = (tabs.find((t) => t.key === sp.tab)?.key ?? "overview") as TabKey;

  const co = company.id;
  // Everyone, with their seat, level, branch and — from the sign-in log
  // (0202) and open sessions — when they were last in. One query: the latest
  // sign-in per person comes off user_sign_in (user_id, signed_in_at desc).
  const [[row], people, [have]] = await Promise.all([
    sql`select plan, package_seats, module_seats from company where id = ${co}`,
    sql`
      select u.id, u.name, u.initials, u.email, u.role, u.seat, u.seat_plan, u.is_active,
             u.password_hash is not null as can_sign_in, b.name as branch,
             coalesce(ls.signed_in_at, u.last_login_at) as signed_in_at, ls.signed_out_at, ls.ended_by,
             -- Only a session still live counts: open, and used within the idle limit.
             (select max(s.last_seen_at) from user_session s
               where s.user_id = u.id and s.expires_at > now()
                 and s.last_seen_at > now() - make_interval(mins => ${SESSION_IDLE_MINUTES})) as seen_at
        from app_user u
        left join location b on b.id = u.branch_id
        left join lateral (select signed_in_at, signed_out_at, ended_by from user_sign_in l
                            where l.user_id = u.id order by signed_in_at desc limit 1) ls on true
       where u.company_id = ${co}
       order by u.is_active desc, u.name`,
    // What the company holds, read against the package's limits.
    sql`select count(*) filter (where parent_id is null)::int as branches,
               count(*) filter (where is_stock_location and not is_quarantine and not is_transit)::int as warehouses
          from location where company_id = ${co} and is_active`,
  ]) as [any[], any[], any[]];

  const plan = row.plan as Plan;
  const PlanIcon = PLAN_ICON[plan];
  const holders = (people as any[]).filter((u) => u.is_active && u.can_sign_in);
  const levelOf = (u: any) => (u.seat_plan ?? plan) as Plan;
  const seatOf = (u: any) => (u.seat ?? "package") as string;
  const badge = (u: any) => seatOf(u) === "package" ? `${PLAN_NAME[levelOf(u)]} seat` : `${SEAT_NAME[seatOf(u)]} seat`;

  // Seats by kind: package seats per level (the company's own level brings its
  // included one), then module seats. Levels above the company's are closed.
  const rank = PLAN_ORDER.indexOf(plan);
  const pkgSeats = PLAN_ORDER.map((p, i) => ({
    key: p, name: `${PLAN_NAME[p]} seats`, plan: p,
    total: packageSeatsAt(p, plan, row.package_seats),
    included: p === plan ? (PLAN_LIMITS[p].users ?? 1) : 0,
    held: holders.filter((u) => seatOf(u) === "package" && levelOf(u) === p),
    closed: i > rank,
  })).filter((s) => !s.closed || s.total > 0 || s.held.length > 0);
  const modSeats = Object.keys(SEAT_NAME).map((k) => ({
    key: k, name: `${SEAT_NAME[k]} seats`,
    total: Number(row.module_seats?.[k] ?? 0),
    held: holders.filter((u) => seatOf(u) === k),
  }));
  const seatTotal = pkgSeats.reduce((t, s) => t + s.total, 0) + modSeats.reduce((t, s) => t + s.total, 0);
  const statusOf = (u: any) => {
    if (!u.is_active) return "inactive";
    if (!u.can_sign_in) return "nologin";
    if (u.seen_at && Date.now() - new Date(u.seen_at).getTime() < ONLINE_MIN * 60000) return "online";
    if (u.seen_at) return "away";
    return u.signed_in_at ? "offline" : "never";
  };
  const STATUS: Record<string, string> = { online: "Online", away: "Away", offline: "Signed out", never: "Never signed in", inactive: "Inactive", nologin: "No sign-in" };
  const counts: Record<string, number> = holders.reduce((m, u) => { const s = statusOf(u); m[s] = (m[s] ?? 0) + 1; return m; }, {} as Record<string, number>);
  const addons = (company.modules ?? []).filter((m) => !(CORE_MODULES as string[]).includes(m)).length;
  const roles: Record<string, number> = holders.reduce((m, u) => { m[u.role] = (m[u.role] ?? 0) + 1; return m; }, {} as Record<string, number>);
  const tabHref = (k: string) => `/settings/plan${k === "overview" ? "" : `?tab=${k}`}`;

  return (
    <div className="acct">
      <header className="acct-head">
        <div className="acct-title">
          <span className={`acct-plan-icon ${plan.toLowerCase()}`}><PlanIcon size={20} strokeWidth={2.2} aria-hidden="true" /></span>
          <div>
            <span className="eyebrow">Settings · Account</span>
            <h1>Package &amp; seats</h1>
            <p className="page-sub">{PLAN_NAME[plan]} package · {holders.length} of {seatTotal} seats in use · set by your provider</p>
          </div>
        </div>
        {seePeople && <Link href="/settings/users" className="btn ghost">Manage people <ArrowUpRight size={14} aria-hidden="true" /></Link>}
      </header>

      <nav className="acct-tabs" aria-label="Package and seats">
        {tabs.map((t) => (
          <Link key={t.key} href={tabHref(t.key)} className={tab === t.key ? "on" : undefined} aria-current={tab === t.key ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <>
          <div className="acct-kpis">
            <div className="acct-kpi"><span className="acct-kpi-icon"><PlanIcon size={16} aria-hidden="true" /></span>
              <span className="acct-kpi-label">Package</span><strong>{PLAN_NAME[plan]}</strong></div>
            <div className="acct-kpi"><span className="acct-kpi-icon"><Users size={16} aria-hidden="true" /></span>
              <span className="acct-kpi-label">Seats in use</span><strong>{holders.length}<small> / {seatTotal}</small></strong></div>
            <div className="acct-kpi"><span className="acct-kpi-icon"><UserCheck size={16} aria-hidden="true" /></span>
              <span className="acct-kpi-label">Online now</span><strong>{counts.online ?? 0}</strong></div>
            <div className="acct-kpi"><span className="acct-kpi-icon"><Puzzle size={16} aria-hidden="true" /></span>
              <span className="acct-kpi-label">Add-ons</span><strong>{addons}</strong></div>
          </div>

          <div className="acct-grid">
            <section className="card acct-card">
              <div className="acct-card-head"><h2>Seat usage</h2><Link href={tabHref("seats")} className="acct-link">Details</Link></div>
              <div className="acct-bars">
                {[...pkgSeats.filter((s) => !s.closed), ...modSeats.filter((s) => s.total > 0 || s.held.length > 0)].map((s) => (
                  <SeatBar key={s.key} name={s.name} used={s.held.length} total={s.total} quiet />
                ))}
              </div>
            </section>
            {seePeople && (
              <section className="card acct-card">
                <div className="acct-card-head"><h2>Member status</h2><Link href={tabHref("members")} className="acct-link">Members</Link></div>
                <ul className="acct-status">
                  {(["online", "away", "offline", "never"] as const).map((k) => (
                    <li key={k}><span className={`acct-dot ${k}`} aria-hidden="true" />{STATUS[k]}
                      <strong>{counts[k] ?? 0}</strong></li>
                  ))}
                </ul>
              </section>
            )}
            <section className="card acct-card">
              <div className="acct-card-head"><h2>Roles</h2></div>
              <ul className="acct-status">
                {Object.entries(roles).sort((a, b) => b[1] - a[1]).map(([r, n]) => (
                  <li key={r}>{ROLE_LABEL[r as Role] ?? r}<strong>{n}</strong></li>
                ))}
                {Object.keys(roles).length === 0 && <li className="page-sub">Nobody can sign in yet.</li>}
              </ul>
            </section>
          </div>
        </>
      )}

      {tab === "package" && (
        <>
          <PlanSwitcher current={plan} limits={PLAN_LIMITS} have={have as { branches: number; warehouses: number }}
            locked={!planSwitchable} action={setCompanyPlan} />
          <ModuleSwitcher all={MODULES} current={company.modules ?? MODULES.map((m) => m.key)}
            core={plan === "STARTER" ? CORE_MODULES : [...CORE_MODULES, "logistics"]} planName={PLAN_NAME[plan]}
            needsStandard={plan === "STARTER" ? STANDARD_UP_ADDONS : []}
            locked={!planSwitchable} action={setCompanyModules} />
          <section className="card">
            <div className="card-head"><h2>Features</h2></div>
            <table className="feat-table">
              <tbody>
                {[
                  { on: serialTrackingOn(company), name: "IMEI & serial numbers", what: "Each phone or device named by its IMEI or serial on receipt, sale and warranty. Off: every product is counted by quantity." },
                  { on: ordersAndDeliveriesOn(company), name: "Orders & deliveries", what: "Sales orders, deliveries and deliver-later. Off: every invoice hands the goods over at the counter." },
                  { on: sparePartsOn(company), name: "Spare parts", what: "Part numbers (OEM, equivalents, supplier codes) that find a part when typed, a selling price per pack, and each product's packs shown as a ladder: 1 CTN = 10 BOX = 120 PCS." },
                ].map((f) => (
                  <tr key={f.name}>
                    <td><strong>{f.name}</strong><div className="subline">{f.what}</div></td>
                    <td className="num"><span className={`pill ${f.on ? "ok" : "neutral"}`}>{f.on ? "On" : "Off"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {tab === "seats" && (
        <>
          <p className="page-sub acct-lead">
            A seat is one person who can sign in. Package seats can hold any role, at a level up to the company&apos;s
            package; module seats hold only their module&apos;s roles. Seats are added by your provider.
          </p>
          <h2 className="acct-section">Package seats</h2>
          <div className="acct-seat-grid">
            {pkgSeats.map((s) => (
              <SeatCardView key={s.key} name={s.name} total={s.total} held={s.held} included={s.included}
                icon={PLAN_ICON[s.plan]} tone={s.plan.toLowerCase()}
                note={s.closed ? `Upgrade the company to ${PLAN_NAME[s.plan]} first` : undefined} />
            ))}
          </div>
          <h2 className="acct-section">Module seats</h2>
          <div className="acct-seat-grid">
            {modSeats.map((s) => (
              <SeatCardView key={s.key} name={s.name} total={s.total} held={s.held} included={0} />
            ))}
          </div>
        </>
      )}

      {tab === "members" && seePeople && (
        <section className="card">
          <div className="tablewrap">
            <table className="acct-table">
              <thead><tr><th>Person</th><th>Seat</th><th>Role</th><th>Status</th><th>Last signed in</th><th>Last signed out</th><th /></tr></thead>
              <tbody>
                {(people as any[]).map((u) => {
                  const st = statusOf(u);
                  return (
                    <tr key={u.id} className={u.is_active ? undefined : "off"}>
                      <td>
                        <span className="acct-person">
                          <span className="acct-avatar">{u.initials}</span>
                          <span><strong>{u.name}</strong><span className="subline">{u.email ?? "—"}{u.branch ? ` · ${u.branch}` : ""}</span></span>
                        </span>
                      </td>
                      <td>{u.can_sign_in && u.is_active
                        ? <span className={`acct-seat-pill ${seatOf(u) === "package" ? levelOf(u).toLowerCase() : "module"}`}>{badge(u)}</span>
                        : <span className="page-sub">—</span>}</td>
                      <td>{ROLE_LABEL[u.role as Role] ?? u.role}</td>
                      <td><span className="acct-state"><span className={`acct-dot ${st}`} aria-hidden="true" />{STATUS[st]}</span>
                        {st === "online" || st === "away" ? <span className="subline">seen {ago(u.seen_at)}</span> : null}</td>
                      <td>{when(u.signed_in_at)}</td>
                      <td>{u.signed_out_at ? <>{when(u.signed_out_at)}<span className="subline">{u.ended_by === "TIMEOUT" ? "timed out" : u.ended_by === "REVOKED" ? "ended by admin" : "signed out"}</span></>
                        : u.signed_in_at ? <span className="page-sub">Still signed in</span> : "—"}</td>
                      <td className="r"><Link href={`/settings/users?u=${u.id}`} className="acct-link">Manage</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "activity" && seePeople && <SignInLog co={co} page={Math.max(1, Number(sp.page) || 1)} />}
    </div>
  );
}

/** `quiet`: no "ask your provider" note (the Overview's bars; the Seats tab has it). */
function SeatBar({ name, used, total, quiet }: { name: string; used: number; total: number; quiet?: boolean }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : used > 0 ? 100 : 0;
  const full = total > 0 && used >= total;
  return (
    <div className="acct-bar">
      <div className="acct-bar-top"><span>{name}</span><strong>{used}<small> / {total} used</small></strong></div>
      <div className="acct-track"><span className={full ? "full" : undefined} style={{ width: `${pct}%` }} /></div>
      {full && !quiet && <span className="acct-hint"><Sparkles size={13} aria-hidden="true" /> All in use — ask your provider for more</span>}
    </div>
  );
}

function SeatCardView({ name, total, held, included, icon: Icon, tone, note }: {
  name: string; total: number; held: any[]; included: number;
  icon?: typeof Crown; tone?: string; note?: string;
}) {
  return (
    <section className={`card acct-seat${note ? " closed" : ""}`}>
      <div className="acct-seat-head">
        {Icon && <span className={`acct-plan-icon sm ${tone}`}><Icon size={14} aria-hidden="true" /></span>}
        <h3>{name}</h3>
        <strong>{held.length}<small> / {total}</small></strong>
      </div>
      <SeatBar name={included ? `${included} included${total > included ? ` + ${total - included} bought` : ""}` : total ? `${total} bought` : "None bought"}
        used={held.length} total={total} />
      {note ? <p className="acct-hint">{note}</p> : held.length > 0 ? (
        <ul className="acct-holders">
          {held.map((u) => <li key={u.id} title={u.email ?? undefined}><span className="acct-avatar xs">{u.initials}</span>{u.name}</li>)}
        </ul>
      ) : <p className="page-sub">Nobody in these seats.</p>}
    </section>
  );
}

const PAGE = 40;

/** The sign-in log (0202), newest first, a page at a time on (company_id, signed_in_at desc). */
async function SignInLog({ co, page }: { co: string; page: number }) {
  const rows = await sql`
    select l.signed_in_at, l.signed_out_at, l.ended_by, u.name, u.initials, u.role
      from user_sign_in l join app_user u on u.id = l.user_id
     where l.company_id = ${co}
     order by l.signed_in_at desc
     limit ${PAGE + 1} offset ${(page - 1) * PAGE}` as unknown as any[];
  const more = rows.length > PAGE;
  return (
    <section className="card">
      <div className="card-head"><h2><ActivityIcon size={16} aria-hidden="true" /> Sign-in log</h2>
        <span className="page-sub">Times only — no addresses or devices are kept.</span></div>
      {rows.length === 0 ? <div className="card-body page-sub">No sign-ins recorded yet. They are kept from now on.</div> : (
        <div className="tablewrap">
          <table className="acct-table">
            <thead><tr><th>Person</th><th>Signed in</th><th>Signed out</th><th>How it ended</th><th className="r">Length</th></tr></thead>
            <tbody>
              {rows.slice(0, PAGE).map((r, i) => (
                <tr key={i}>
                  <td><span className="acct-person"><span className="acct-avatar xs">{r.initials}</span><strong>{r.name}</strong></span></td>
                  <td>{when(r.signed_in_at)}</td>
                  <td>{r.signed_out_at ? when(r.signed_out_at) : <span className="acct-state"><span className="acct-dot online" aria-hidden="true" />Still signed in</span>}</td>
                  <td>{r.ended_by === "SIGN_OUT" ? "Signed out" : r.ended_by === "TIMEOUT" ? "Timed out" : r.ended_by === "REVOKED" ? "Ended by admin" : "—"}</td>
                  <td className="r">{span(r.signed_in_at, r.signed_out_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(page > 1 || more) && (
        <div className="acct-pager">
          {page > 1 ? <Link href={`/settings/plan?tab=activity&page=${page - 1}`} className="btn ghost tiny">Newer</Link> : <span />}
          {more && <Link href={`/settings/plan?tab=activity&page=${page + 1}`} className="btn ghost tiny">Older</Link>}
        </div>
      )}
    </section>
  );
}

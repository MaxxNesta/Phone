import Link from "next/link";
import {
  ScanLine, ShoppingCart, Undo2, Percent, Package, Ship, Boxes, Smartphone, Tags, Users as UsersIcon,
  BookOpen, FileX, BarChart3, Landmark, Briefcase, Wallet, HandCoins, PieChart, Truck, Settings, UserCog, Receipt,
  Check, Minus, Search, Plus, type LucideIcon,
} from "lucide-react";
import { sql } from "@/lib/db";
import { requirePermission, ROLE_LABEL, ROLE_PERMISSIONS, previewAllowed } from "@/lib/auth";
import type { Role } from "@/lib/roles";
import { UserForm } from "@/components/user-form";
import { dateTime } from "@/lib/format";
import { getCompany } from "@/lib/queries";
import { hasModule, PLAN_NAME, userLimit, type Module } from "@/lib/plans";
import { previewRole } from "@/lib/preview-actions";

export const metadata = { title: "Users" };

/**
 * What a person can do, area by area: one row per thing they might open,
 * whether they can view it and whether they can work in it. Read-only:
 * the role decides, so changing what someone can do means changing their role.
 */
type Row = { label: string; icon: LucideIcon; view: string | null; work: string | null; module?: Module };
const GROUPS: { name: string; module?: Module; rows: Row[] }[] = [
  { name: "Sales", module: "sales", rows: [
    { label: "Counter sale", icon: ScanLine, view: "pos.sell", work: "pos.sell" },
    { label: "Sales invoices and receipts", icon: ShoppingCart, view: "sales.view", work: "sales.post" },
    { label: "Returns and credit notes", icon: Undo2, view: "sales.view", work: "sales.return" },
    { label: "Discounts above the limit", icon: Percent, view: null, work: "discount.unlimited" },
  ] },
  { name: "Purchases", module: "purchases", rows: [
    { label: "Orders, receipts and bills", icon: Package, view: "purchase.view", work: "purchase.post" },
    { label: "Landed cost", icon: Ship, view: "cost.view", work: "purchase.post", module: "landed_cost" },
  ] },
  { name: "Inventory", module: "inventory", rows: [
    { label: "Stock and IMEIs", icon: Boxes, view: "inventory.view", work: "inventory.manage" },
    { label: "Products", icon: Smartphone, view: "inventory.view", work: "items.manage" },
    { label: "Costs and margins", icon: Tags, view: "cost.view", work: null },
  ] },
  { name: "Customers and suppliers", rows: [
    { label: "Partners", icon: UsersIcon, view: "sales.view", work: "partners.manage" },
  ] },
  { name: "Accounting", module: "accounting", rows: [
    { label: "Cash, bank and journals", icon: BookOpen, view: "accounting.view", work: "accounting.post" },
    { label: "Void and correct documents", icon: FileX, view: null, work: "documents.void" },
    { label: "Reports", icon: BarChart3, view: "reports.view", work: null },
    { label: "Fixed assets", icon: Landmark, view: "accounting.view", work: "accounting.post", module: "fixed_assets" },
    { label: "Equity", icon: PieChart, view: "accounting.view", work: "accounting.post", module: "equity" },
  ] },
  { name: "HR & Payroll", module: "hr", rows: [
    { label: "Employees", icon: Briefcase, view: "hr.employees.view", work: "hr.employees.edit" },
    { label: "Salaries and payroll", icon: Wallet, view: "hr.salary.view", work: "hr.payroll.post" },
    { label: "Salary advances", icon: HandCoins, view: "hr.advances", work: "hr.advances" },
  ] },
  { name: "Settings", rows: [
    { label: "Company settings", icon: Settings, view: "settings.manage", work: "settings.manage" },
    { label: "Users", icon: UserCog, view: "users.manage", work: "users.manage" },
    { label: "Receipt templates", icon: Receipt, view: "receipts.manage", work: "receipts.manage" },
    { label: "Logistics", icon: Truck, view: "settings.manage", work: "settings.manage", module: "logistics" },
  ] },
];

export default async function Users({ searchParams }: { searchParams: Promise<{ u?: string; q?: string; new?: string }> }) {
  const admin = await requirePermission("users.manage");
  const sp = await searchParams;
  const [users, branches, company, [seat]] = await Promise.all([
    sql`select u.id, u.name, u.initials, u.email, u.role, u.is_active, u.last_login_at, u.branch_id, u.sees_all_branches, b.name as branch_name
          from app_user u left join location b on b.id = u.branch_id
         where u.company_id = ${admin.companyId} order by u.is_active desc, u.name`,
    sql`select id, code, name from location
         where company_id = ${admin.companyId} and parent_id is null and is_active order by code`,
    getCompany(),
    sql`select extra_users from company where id = ${admin.companyId}`,
  ]);
  const people = users as any[];
  const manyBranches = branches.length > 1;
  const q = (sp.q ?? "").trim().toLowerCase();
  const shown = q ? people.filter((u) => `${u.name} ${u.email ?? ""} ${ROLE_LABEL[u.role as Role] ?? ""}`.toLowerCase().includes(q)) : people;
  const adding = sp.new === "1";
  const picked = adding ? null : people.find((u) => u.id === sp.u) ?? shown[0] ?? null;
  const seats = company ? userLimit(company.plan, Number(seat?.extra_users ?? 0)) : 0;
  const active = people.filter((u) => u.is_active).length;
  const perms = picked ? (ROLE_PERMISSIONS[picked.role as Role] as string[]) : [];
  const has = (p: string | null) => !!p && perms.includes(p);
  const canPreview = previewAllowed();
  const href = (o: Record<string, string | undefined>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: sp.q, ...o })) if (v) s.set(k, v);
    return `/settings/users${s.size ? `?${s}` : ""}`;
  };
  const scope = (u: any) => !manyBranches ? null
    : u.branch_name ? `${u.branch_name}${u.sees_all_branches ? " · sees all branches" : ""}`
    : ["ADMIN", "MANAGER"].includes(u.role) ? "All branches" : "Branch not set";

  return (
    <>
      <div className="page-head hero">
        <span className="eyebrow">Settings · Account</span>
        <h1>Users</h1>
        <p className="page-sub">
          {active} of {seats} user seats in use{company ? ` · ${PLAN_NAME[company.plan]} package` : ""}
          {active >= seats ? " · add a seat in Settings → Package to add another person" : ""}
        </p>
      </div>

      <div className="ppl">
        {/* The people. */}
        <aside className="card ppl-list">
          <form className="ppl-search" role="search">
            <Search size={15} aria-hidden="true" />
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Search people…" aria-label="Search people" />
          </form>
          <Link href={href({ new: "1" })} className={`ppl-add${adding ? " on" : ""}`}><Plus size={15} aria-hidden="true" /> Add a person</Link>
          <ul>
            {shown.map((u) => (
              <li key={u.id}>
                <Link href={href({ u: u.id })} className={`ppl-row${picked?.id === u.id ? " on" : ""}${u.is_active ? "" : " off"}`}>
                  <span className="ppl-avatar">{u.initials ?? u.name.slice(0, 2).toUpperCase()}</span>
                  <span className="ppl-who">
                    <strong>{u.name}</strong>
                    <span>{ROLE_LABEL[u.role as Role] ?? u.role}{u.is_active ? "" : " · inactive"}</span>
                  </span>
                </Link>
              </li>
            ))}
            {shown.length === 0 && <li className="page-sub ppl-empty">Nobody matches.</li>}
          </ul>
        </aside>

        {/* The selected person, or the form to add one. */}
        <section className="card ppl-detail">
          {adding ? (
            <>
              <div className="ppl-head"><div><h2>Add a person</h2><span className="page-sub">They sign in with their email and this password.</span></div></div>
              <div className="card-body"><UserForm branches={branches as never} /></div>
            </>
          ) : picked ? (
            <>
              <div className="ppl-head">
                <span className="ppl-avatar lg">{picked.initials ?? picked.name.slice(0, 2).toUpperCase()}</span>
                <div className="ppl-head-who">
                  <h2>{picked.name}{!picked.is_active && <span className="pill reversed">inactive</span>}</h2>
                  <span className="page-sub">
                    {ROLE_LABEL[picked.role as Role] ?? picked.role}
                    {scope(picked) ? ` · ${scope(picked)}` : ""}
                    {` · last sign-in ${picked.last_login_at ? dateTime(picked.last_login_at) : "never"}`}
                  </span>
                </div>
                <div className="ppl-head-actions">
                  {canPreview && picked.role !== "ADMIN" && (
                    <form action={previewRole}>
                      <input type="hidden" name="role" value={picked.role} />
                      <input type="hidden" name="branch" value={picked.sees_all_branches ? "" : picked.branch_id ?? ""} />
                      <button type="submit" className="btn">View as {picked.name.split(" ")[0]}</button>
                    </form>
                  )}
                  <details className="ppl-edit">
                    <summary className="btn">Edit</summary>
                    <div className="ppl-edit-pop">
                      <UserForm branches={branches as never} user={{ id: picked.id, name: picked.name, email: picked.email ?? "", role: picked.role, is_active: picked.is_active, branch_id: picked.branch_id, sees_all_branches: picked.sees_all_branches }} />
                    </div>
                  </details>
                </div>
              </div>

              <div className="perm">
                <p className="perm-note">What {/^[AEIOU]/.test(ROLE_LABEL[picked.role as Role]) ? "an" : "a"} {ROLE_LABEL[picked.role as Role]} can do. The role decides; to change it, edit the person’s role.</p>
                {GROUPS.filter((g) => !g.module || hasModule(company, g.module)).map((g) => {
                  const rows = g.rows.filter((r) => !r.module || hasModule(company, r.module));
                  if (rows.length === 0) return null;
                  return (
                    <table key={g.name} className="perm-table">
                      <colgroup><col /><col className="perm-col" /><col className="perm-col" /></colgroup>
                      <thead><tr><th>{g.name}</th><th>View</th><th>Work in</th></tr></thead>
                      <tbody>
                        {rows.map((r) => {
                          const Icon = r.icon;
                          const v = has(r.view) || has(r.work), w = has(r.work);
                          return (
                            <tr key={r.label}>
                              <td><span className="perm-label"><Icon size={16} aria-hidden="true" />{r.label}</span></td>
                              <td><Tick on={r.view === null ? null : v} /></td>
                              <td><Tick on={r.work === null ? null : w} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="card-body page-sub">Nobody yet. Add a person to begin.</div>
          )}
        </section>
      </div>
    </>
  );
}

/** A read-only tick: yes, no, or nothing to grant here. */
function Tick({ on }: { on: boolean | null }) {
  if (on === null) return <span className="tick na" aria-label="not applicable" />;
  return (
    <span className={`tick${on ? " yes" : ""}`}>
      <span className="tick-box">{on ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : <Minus size={10} aria-hidden="true" />}</span>
      {on ? "Yes" : "No"}
    </span>
  );
}

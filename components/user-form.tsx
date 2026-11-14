"use client";

import { useActionState, useState } from "react";
import { saveUser } from "@/lib/auth-actions";
import { ROLES, ROLE_LABEL } from "@/lib/roles";
import { useNotice } from "@/components/toast";

/** Roles that may work across every branch. Kept with ALL_BRANCH_ROLES in auth-core. */
const ACROSS_BRANCHES = ["ADMIN", "MANAGER"];

/** Seat types and their roles, as lib/plans.ts SEATS (kept here so the form stays a client module). */
const SEAT_OPTS: { key: string; name: string; roles: string[] | null }[] = [
  { key: "package", name: "Package seat", roles: null },
  { key: "sales", name: "Sales seat", roles: ["CASHIER", "SALESPERSON"] },
  { key: "purchases", name: "Purchases seat", roles: ["PURCHASER"] },
  { key: "inventory", name: "Inventory seat", roles: ["INVENTORY"] },
];

const LEVELS: [string, string][] = [["STARTER", "Essential"], ["BUSINESS", "Standard"], ["ENTERPRISE", "Advanced"]];

export function UserForm({ user, branches = [], free, companyPlan = "ENTERPRISE" }: {
  /** The company's package: no seat above it. */
  companyPlan?: string;
  /** Seats free by type, shown beside each choice. */
  free?: Record<string, number>;
  user?: { id: string; name: string; email: string; role: string; is_active: boolean; branch_id?: string | null; sees_all_branches?: boolean; seat?: string; seat_plan?: string | null };
  branches?: { id: string; code: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(saveUser, null);
  useNotice(state);
  const [role, setRole] = useState(user?.role ?? "CASHIER");
  const [seat, setSeat] = useState(user?.seat ?? "package");
  const allowed = SEAT_OPTS.find((s) => s.key === seat)?.roles ?? null;
  const roleOk = !allowed || allowed.includes(role);
  const across = ACROSS_BRANCHES.includes(role);
  const k = user?.id ?? "new";
  return (
    <form action={action} className="form" style={{ maxWidth: 420 }}>
      {state && "error" in state && <div className="alert" role="alert">{state.error}</div>}
      {user && <input type="hidden" name="id" value={user.id} />}
      <div className="field">
        <label htmlFor={`un-${k}`}>Name</label>
        <input id={`un-${k}`} name="name" required defaultValue={user?.name} />
      </div>
      <div className="field">
        <label htmlFor={`ue-${k}`}>Email</label>
        <input id={`ue-${k}`} name="email" type="email" required defaultValue={user?.email} />
      </div>
      {/* The seat first: a module seat holds only its module's roles. */}
      <div className="field">
        <label htmlFor={`us-${k}`}>Seat</label>
        <select id={`us-${k}`} name="seat" value={seat}
                onChange={(e) => {
                  const next = e.target.value; setSeat(next);
                  const r = SEAT_OPTS.find((s) => s.key === next)?.roles;
                  if (r && !r.includes(role)) setRole(r[0]);
                }}>
          {SEAT_OPTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}{free && s.key in free ? ` · ${free[s.key]} free` : ""}
            </option>
          ))}
        </select>
      </div>
      {seat === "package" && (
        <div className="field">
          <label htmlFor={`ul-${k}`}>Package level</label>
          <select id={`ul-${k}`} name="seat_plan" defaultValue={user?.seat_plan ?? companyPlan}>
            {LEVELS.map(([v, label], i) => {
              const above = i > LEVELS.findIndex(([x]) => x === companyPlan);
              return (
                <option key={v} value={v} disabled={above}>
                  {label}{above ? " · upgrade the company first" : free && `pkg:${v}` in free ? ` · ${free[`pkg:${v}`]} free` : ""}
                </option>
              );
            })}
          </select>
          <span className="hint">What this person sees. It can’t be above the company’s package.</span>
        </div>
      )}
      <div className="field">
        <label htmlFor={`ur-${k}`}>Role</label>
        <select id={`ur-${k}`} name="role" value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.filter((r) => !allowed || allowed.includes(r)).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        {!roleOk && <span className="hint">This seat can’t hold that role.</span>}
      </div>
      {/* Where this person works. Everyone but an administrator or a manager
          belongs to one branch and works only there; with one branch there is
          nothing to choose. */}
      {branches.length > 1 ? (
        <div className="field">
          <label htmlFor={`ub-${k}`}>Branch</label>
          <select id={`ub-${k}`} name="branch_id" key={across ? "all" : "one"}
                  defaultValue={user?.branch_id ?? (across ? "" : branches[0].id)} required={!across}>
            {across && <option value="">All branches</option>}
            {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
          </select>
        </div>
      ) : branches.length === 1 ? (
        <input type="hidden" name="branch_id" value={branches[0].id} />
      ) : null}
      {/* Seeing is separate from posting: someone can sell at one branch and
          still read every branch's figures, if an administrator allows it. */}
      {branches.length > 1 && (
        <label className="pos-check">
          <input type="checkbox" name="sees_all_branches" defaultChecked={user?.sees_all_branches ?? false} />
          Can see every branch&apos;s documents and reports
        </label>
      )}
      <div className="field">
        <label htmlFor={`up-${k}`}>{user ? "New password (leave blank to keep)" : "Password"}</label>
        <input id={`up-${k}`} name="password" type="password" minLength={8} required={!user} autoComplete="new-password" />
      </div>
      <label className="pos-check">
        <input type="checkbox" name="is_active" defaultChecked={user?.is_active ?? true} /> Can sign in
      </label>
      <button className="btn" disabled={pending}>{user ? "Save" : "Add user"}</button>
    </form>
  );
}

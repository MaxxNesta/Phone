"use client";

import { useActionState, useState } from "react";
import { saveUser } from "@/lib/auth-actions";
import { ROLES, ROLE_LABEL } from "@/lib/roles";

/** Roles that may work across every branch. Kept with ALL_BRANCH_ROLES in auth-core. */
const ACROSS_BRANCHES = ["ADMIN", "MANAGER"];

export function UserForm({ user, branches = [] }: {
  user?: { id: string; name: string; email: string; role: string; is_active: boolean; branch_id?: string | null };
  branches?: { id: string; code: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(saveUser, null);
  const [role, setRole] = useState(user?.role ?? "CASHIER");
  const across = ACROSS_BRANCHES.includes(role);
  const k = user?.id ?? "new";
  return (
    <form action={action} className="form" style={{ maxWidth: 420 }}>
      {state && "error" in state && <div className="alert" role="alert">{state.error}</div>}
      {state && "ok" in state && <div className="alert ok" role="status">{state.ok}</div>}
      {user && <input type="hidden" name="id" value={user.id} />}
      <div className="field">
        <label htmlFor={`un-${k}`}>Name</label>
        <input id={`un-${k}`} name="name" required defaultValue={user?.name} />
      </div>
      <div className="field">
        <label htmlFor={`ue-${k}`}>Email</label>
        <input id={`ue-${k}`} name="email" type="email" required defaultValue={user?.email} />
      </div>
      <div className="field">
        <label htmlFor={`ur-${k}`}>Role</label>
        <select id={`ur-${k}`} name="role" value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
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

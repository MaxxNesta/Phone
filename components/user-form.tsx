"use client";

import { useActionState } from "react";
import { saveUser } from "@/lib/auth-actions";
import { ROLES, ROLE_LABEL } from "@/lib/roles";

export function UserForm({ user }: {
  user?: { id: string; name: string; email: string; role: string; is_active: boolean };
}) {
  const [state, action, pending] = useActionState(saveUser, null);
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
        <select id={`ur-${k}`} name="role" defaultValue={user?.role ?? "CASHIER"}>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </div>
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

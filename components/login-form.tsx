"use client";

import { useActionState } from "react";
import { signIn, createFirstAdmin } from "@/lib/auth-actions";

export function LoginForm({ firstRun, next }: { firstRun: boolean; next: string }) {
  const [state, action, pending] = useActionState(firstRun ? createFirstAdmin : signIn, null);

  return (
    <form action={action} className="form">
      {firstRun && (
        <p className="page-sub">
          Nobody can sign in yet. Create the administrator account; everyone else
          is added from Settings → Users.
        </p>
      )}
      {state && "error" in state && <div className="alert" role="alert">{state.error}</div>}
      <input type="hidden" name="next" value={next} />
      {firstRun && (
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input id="name" name="name" required autoComplete="name" />
        </div>
      )}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="username" autoFocus />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required minLength={firstRun ? 8 : undefined}
          autoComplete={firstRun ? "new-password" : "current-password"} />
        {firstRun && <span className="hint">At least 8 characters</span>}
      </div>
      <div className="actions">
        <button className="btn" disabled={pending}>
          {pending ? "…" : firstRun ? "Create administrator" : "Sign in"}
        </button>
      </div>
    </form>
  );
}

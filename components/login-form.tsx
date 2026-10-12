"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { signIn, createFirstAdmin } from "@/lib/auth-actions";

export function LoginForm({ firstRun, next }: { firstRun: boolean; next: string }) {
  const [state, action, pending] = useActionState(firstRun ? createFirstAdmin : signIn, null);
  // Typing a password on a phone keyboard blind is where most failed sign-ins
  // come from; showing it is the person's choice and never the default.
  const [reveal, setReveal] = useState(false);

  return (
    <form action={action} className="form login-form">
      {firstRun && (
        <p className="page-sub">
          Nobody can sign in yet. This account runs the company; everyone else is
          added from Settings → Users.
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
        <input id="email" name="email" type="email" required autoComplete="username" autoFocus
          placeholder="name@company.com" inputMode="email" autoCapitalize="none" spellCheck={false} />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <div className="login-password">
          <input id="password" name="password" type={reveal ? "text" : "password"} required
            minLength={firstRun ? 8 : undefined}
            autoComplete={firstRun ? "new-password" : "current-password"} />
          <button type="button" className="login-reveal" onClick={() => setReveal(!reveal)}
            aria-label={reveal ? "Hide password" : "Show password"} aria-pressed={reveal}>
            {reveal ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        </div>
        {firstRun && <span className="hint">At least 8 characters</span>}
      </div>
      <button className="btn login-submit" disabled={pending}>
        {pending
          ? (firstRun ? "Creating account…" : "Signing in…")
          : (firstRun ? "Create administrator" : "Sign in")}
      </button>
    </form>
  );
}

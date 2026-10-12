import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { currentUser, authRequired } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (!authRequired() || await currentUser()) redirect("/");
  const [co] = await sql`select name from company order by created_at limit 1`;
  if (!co) redirect("/setup");
  const [any] = await sql`select 1 as yes from app_user where password_hash is not null limit 1`;
  const { next } = await searchParams;
  const firstRun = !any;

  // The screen says what it is for, and where: a title, the company it opens,
  // and — the one question a locked-out person has — how to get back in.
  return (
    <div className="login-wrap">
      <div className="login-mark" aria-hidden="true">{String(co.name).trim().charAt(0).toUpperCase()}</div>
      <h1 className="login-title">{firstRun ? "Create the administrator" : "Sign in"}</h1>
      <p className="login-sub">{firstRun ? `The first account for ${co.name}` : `to ${co.name}`}</p>
      <div className="card login-card">
        <div className="card-body">
          <LoginForm firstRun={firstRun} next={next ?? "/"} />
        </div>
      </div>
      {!firstRun && (
        <p className="login-help">
          Forgot your password? An administrator can reset it in Settings&nbsp;→&nbsp;Users.
        </p>
      )}
    </div>
  );
}

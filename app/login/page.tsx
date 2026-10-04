import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await currentUser()) redirect("/");
  const [co] = await sql`select name from company order by created_at limit 1`;
  if (!co) redirect("/setup");
  const [any] = await sql`select 1 as yes from app_user where password_hash is not null limit 1`;
  const { next } = await searchParams;

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="card-head">
          <h2>{co.name}</h2>
        </div>
        <div className="card-body">
          <LoginForm firstRun={!any} next={next ?? "/"} />
        </div>
      </div>
    </div>
  );
}

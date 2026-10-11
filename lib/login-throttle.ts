import type { Sql } from "postgres";

/**
 * How many failed sign-ins are tolerated, and for how long they count.
 *
 * Five per email is generous for a person who mistyped and nothing for a
 * script; twenty per address leaves room for a shop where several people
 * share one connection. Either limit refuses until the window has passed.
 */
export const LOGIN_LIMITS = { perEmail: 5, perIp: 20, windowMinutes: 15 };

/** Whether sign-in should be refused before the password is even checked. */
export async function tooManyFailures(sql: Sql, email: string, ip: string | null): Promise<boolean> {
  const [r] = await sql`
    select
      count(*) filter (where email = ${email})::int as by_email,
      count(*) filter (where ${ip}::text is not null and ip = ${ip})::int as by_ip
      from login_failure
     where failed_at > now() - make_interval(mins => ${LOGIN_LIMITS.windowMinutes})
       and (email = ${email} or (${ip}::text is not null and ip = ${ip}))`;
  return r.by_email >= LOGIN_LIMITS.perEmail || r.by_ip >= LOGIN_LIMITS.perIp;
}

export async function recordFailure(sql: Sql, email: string, ip: string | null) {
  await sql`insert into login_failure (email, ip) values (${email}, ${ip})`;
  // Housekeeping: nothing older than a day is ever read.
  await sql`delete from login_failure where failed_at < now() - interval '1 day'`;
}

/** A correct password clears the email's slate; the address keeps its count. */
export async function clearFailures(sql: Sql, email: string) {
  await sql`delete from login_failure where email = ${email}`;
}

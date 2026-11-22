// Give this shop's console_agent role (0217) a fresh password and print the
// connection string to paste into the console's "Add shop" form. Run it when
// a shop is connected, and again to rotate the password (the old one stops
// working at once).
//
//   npx tsx --env-file=.env scripts/console-agent.mjs          (prints the URL)
//
// console_agent can only run fn_console_state, fn_console_usage and
// fn_apply_entitlement; it reads no table. The URL is shown once and stored
// nowhere here — the console keeps it encrypted.
import { randomBytes } from "node:crypto";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set"); process.exit(2); }
const local = /localhost|127\.0\.0\.1/.test(url);
const sql = postgres(url, { max: 1, prepare: false, ssl: local ? false : "require", onnotice: () => {} });
try {
  const [r] = await sql`select 1 as ok from pg_roles where rolname = 'console_agent'`;
  if (!r) throw new Error("console_agent does not exist here: apply migration 0217 first.");
  // 24 random characters from [A-Za-z0-9_-]: safe inside the quoted literal.
  const password = randomBytes(18).toString("base64url");
  await sql.unsafe(`alter role console_agent with login password '${password}'`);
  const u = new URL(url);
  u.username = "console_agent";
  u.password = password;
  if (!local && !u.searchParams.has("sslmode")) u.searchParams.set("sslmode", "require");
  console.log(u.toString());
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}

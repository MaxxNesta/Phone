// Sign-in is refused after too many failures, per email and per address.
//
//   ./node_modules/.bin/tsx scripts/test-login-throttle.mjs
//
// Found by security testing: nothing limited password guesses.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.DATABASE_URL && existsSync(join(root, ".env"))) {
  for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
    if (m) { process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, ""); break; }
  }
}
const url = process.env.DATABASE_URL;
const sql = postgres(url, { ssl: url.includes("localhost") ? false : "require",
  prepare: !url.includes("-pooler."), onnotice: () => {}, max: 2 });
const T = await import("../lib/login-throttle.ts");

let bad = 0;
const check = (label, ok, detail = "") => {
  if (!ok) bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};
const tag = Date.now().toString(36);
const email = `throttle-${tag}@test.invalid`, other = `other-${tag}@test.invalid`;
const ip = `203.0.113.${Number.parseInt(tag.slice(-2), 36) % 250}`, ip2 = `198.51.100.${Number.parseInt(tag.slice(-3, -1), 36) % 250}`;
const { perEmail, perIp } = T.LOGIN_LIMITS;

try {
  console.log("\n  one email, one address\n");
  check("a fresh email may try", !(await T.tooManyFailures(sql, email, ip)));
  for (let i = 0; i < perEmail - 1; i++) await T.recordFailure(sql, email, ip);
  check(`  ${perEmail - 1} failures: still allowed`, !(await T.tooManyFailures(sql, email, ip)));
  await T.recordFailure(sql, email, ip);
  check(`  ${perEmail} failures: refused`, await T.tooManyFailures(sql, email, ip));
  check("  from another address too: the email is what is guarded", await T.tooManyFailures(sql, email, ip2));
  check("  another email from a clean address is unaffected", !(await T.tooManyFailures(sql, other, ip2)));

  console.log("\n  a correct password\n");
  await T.clearFailures(sql, email);
  check("clears the email's failures", !(await T.tooManyFailures(sql, email, ip2)));

  console.log("\n  many emails from one address\n");
  for (let i = 0; i < perIp; i++) await T.recordFailure(sql, `spray-${i}-${tag}@test.invalid`, ip2);
  check(`${perIp} failures across emails: the address is refused`, await T.tooManyFailures(sql, `new-${tag}@test.invalid`, ip2));
  check("  a request with no address is judged by email alone", !(await T.tooManyFailures(sql, `new-${tag}@test.invalid`, null)));

  console.log("\n  the window\n");
  await sql`update login_failure set failed_at = now() - interval '16 minutes' where email = ${other} or ip = ${ip2}`;
  for (let i = 0; i < perEmail; i++) await T.recordFailure(sql, other, null);
  await sql`update login_failure set failed_at = now() - interval '16 minutes' where email = ${other}`;
  check("failures older than the window no longer count", !(await T.tooManyFailures(sql, other, ip2)));
} catch (e) {
  bad++;
  console.error("\n  CRASH", e);
} finally {
  await sql`delete from login_failure where email like ${"%" + tag + "@test.invalid"}`;
  await sql.end();
}
console.log(bad ? `\n  ${bad} FAILED\n` : "\n  all passed\n");
process.exit(bad ? 1 : 0);

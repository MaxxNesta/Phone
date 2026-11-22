// Set one person's password, on whatever DATABASE_URL points at.
//   DATABASE_URL=... node scripts/reset-admin-password.mjs admin@gmail.com 'NewPassword'
// Same hash scheme as lib/auth-core.ts hashPassword. Their open sessions end.
import postgres from "postgres";
import { scryptSync, randomBytes } from "node:crypto";

const [email, password] = process.argv.slice(2);
if (!email || !password) { console.error("usage: reset-admin-password.mjs <email> <password>"); process.exit(2); }
const salt = randomBytes(16);
const hash = `scrypt$${salt.toString("base64")}$${scryptSync(password, salt, 64).toString("base64")}`;
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
try {
  const [c] = await sql`select name from company order by created_at limit 1`;
  const r = await sql`update app_user set password_hash = ${hash} where email = ${email} and is_active returning id`;
  if (r.length) await sql`delete from user_session where user_id = ${r[0].id}`;
  console.log(`${c?.name}: ${r.length} updated`);
} finally {
  await sql.end();
}

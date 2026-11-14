// Test accounts with known passwords — DEV only.
//
// One sign-in per role, so every role can be tried with sign-in on. The
// passwords live HERE, in plain sight, on purpose: run this again and every
// account is back to the password below, with nothing to look up in the
// database (which only ever stores a scrambled hash of it).
//
// Never for pilot or production: it refuses any database but DEV.
//
//   npx tsx --env-file=.env scripts/test-accounts.mjs            create or reset all
//   npx tsx --env-file=.env scripts/test-accounts.mjs --clean    also delete old inactive test users nothing refers to
import postgres from "postgres";
import { scryptSync, randomBytes } from "node:crypto";

export const ACCOUNTS = [
  { name: "admin",            email: "admin@gmail.com",       role: "ADMIN",       password: "Admin@2026" },
  { name: "Test Manager",     email: "manager@mtk.test",      role: "MANAGER",     password: "Manager@2026" },
  { name: "Test Cashier",     email: "cashier@mtk.test",      role: "CASHIER",     password: "Cashier@2026" },
  { name: "Test Salesperson", email: "sales@mtk.test",        role: "SALESPERSON", password: "Sales@2026" },
  { name: "Test Inventory",   email: "inventory@mtk.test",    role: "INVENTORY",   password: "Inventory@2026" },
  { name: "Test Purchaser",   email: "purchaser@mtk.test",    role: "PURCHASER",   password: "Purchaser@2026" },
  { name: "Test Accountant",  email: "accountant@mtk.test",   role: "ACCOUNTANT",  password: "Accountant@2026" },
];

// The same scheme as lib/auth-core.ts hashPassword.
const hash = (pw) => {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${scryptSync(pw, salt, 64).toString("base64")}`;
};
const initials = (name) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 3).toUpperCase() || "U";

const url = process.env.DATABASE_URL;
if (!url?.includes("ep-winter-leaf")) {
  console.error("Refused: test accounts are for the DEV database only.");
  process.exit(2);
}
const sql = postgres(url, { max: 1, prepare: false });
try {
  const [co] = await sql`select id, plan from company order by created_at limit 1`;
  // Branch-bound roles need a branch: the first one.
  const [branch] = await sql`select id from location where company_id = ${co.id} and parent_id is null and is_active order by code limit 1`;
  for (const a of ACCOUNTS) {
    const across = a.role === "ADMIN" || a.role === "MANAGER";
    await sql`
      insert into app_user (company_id, name, initials, email, password_hash, role, is_active, branch_id, sees_all_branches, seat, seat_plan)
      values (${co.id}, ${a.name}, ${initials(a.name)}, ${a.email}, ${hash(a.password)}, ${a.role}, true,
              ${across ? null : branch?.id ?? null}, ${across}, 'package', null)
      on conflict (company_id, name) do update set
        email = excluded.email, password_hash = excluded.password_hash, role = excluded.role, is_active = true,
        branch_id = excluded.branch_id, sees_all_branches = excluded.sees_all_branches, seat = 'package', seat_plan = null`;
  }
  // Enough package seats at the company's level for every test account.
  const [{ n }] = await sql`select count(*)::int as n from app_user
    where company_id = ${co.id} and is_active and password_hash is not null and seat = 'package' and seat_plan is null`;
  await sql`update company set package_seats = coalesce(package_seats, '{}'::jsonb) || jsonb_build_object(plan, greatest(${n} - 1, 0))
             where id = ${co.id}`;

  if (process.argv.includes("--clean")) {
    // Inactive users nothing points at: old accounts from test runs.
    const refs = await sql`select conrelid::regclass::text as t, a.attname as c from pg_constraint k
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
      where k.confrelid = 'app_user'::regclass and k.contype = 'f' and conrelid::regclass::text not in ('user_session', 'user_preference')`;
    const unused = refs.map((r) => `not exists (select 1 from ${r.t} x where x.${r.c} = u.id)`).join(" and ");
    await sql.unsafe(`delete from user_session s using app_user u where s.user_id = u.id and not u.is_active and u.company_id = $1 and ${unused}`, [co.id]);
    await sql.unsafe(`delete from user_preference p using app_user u where p.user_id = u.id and not u.is_active and u.company_id = $1 and ${unused}`, [co.id]);
    const gone = await sql.unsafe(`delete from app_user u where not u.is_active and u.company_id = $1 and ${unused} returning u.name`, [co.id]);
    console.log(`Removed ${gone.length} inactive test users nothing referred to.`);
  }

  console.log("\nTest accounts (DEV) — sign in with email and password:");
  for (const a of ACCOUNTS) console.log(`  ${a.role.padEnd(12)} ${a.email.padEnd(24)} ${a.password}`);
  const [left] = await sql`select count(*)::int as active, count(*) filter (where not is_active)::int as inactive from app_user where company_id = ${co.id}`;
  console.log(`\nUsers now: ${left.active} active, ${left.inactive} inactive.`);
} catch (e) {
  console.error(e.message); process.exitCode = 1;
} finally {
  await sql.end();
}

// Set a company's package, add-on modules and seats — for testing only.
//
// The app shows these read-only; customers never change them. This is how the
// developer moves DEV between packages to test each one. It refuses any
// database but DEV unless --force is given (and pilot/production should be
// changed only when a customer has actually bought something).
//
//   npx tsx --env-file=.env scripts/set-package.mjs --show
//   npx tsx --env-file=.env scripts/set-package.mjs --plan STANDARD
//   npx tsx --env-file=.env scripts/set-package.mjs --addons hr,equity,fixed_assets
//   npx tsx --env-file=.env scripts/set-package.mjs --seats ENTERPRISE=0,BUSINESS=2,STARTER=0 --module-seats sales=1,purchases=0,inventory=0
//
// Packages: ESSENTIAL | STANDARD | ADVANCED (stored as STARTER | BUSINESS | ENTERPRISE).
import postgres from "postgres";

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set"); process.exit(2); }
if (!url.includes("ep-winter-leaf") && !args.includes("--force")) {
  console.error("Refused: this is not the DEV database. Pass --force only for a real purchase.");
  process.exit(2);
}
const PLAN = { ESSENTIAL: "STARTER", STANDARD: "BUSINESS", ADVANCED: "ENTERPRISE", STARTER: "STARTER", BUSINESS: "BUSINESS", ENTERPRISE: "ENTERPRISE" };
const ADDONS = ["landed_cost", "fixed_assets", "hr", "equity", "logistics"];
const CORE = ["sales", "purchases", "inventory", "accounting"];
const pairs = (s) => Object.fromEntries((s ?? "").split(",").filter(Boolean).map((p) => p.split("=")).map(([k, v]) => [k.trim(), Number(v)]));

const sql = postgres(url, { max: 1, prepare: false });
try {
  const [c] = await sql`select id, plan from company order by created_at limit 1`;
  if (!c) throw new Error("No company");
  const plan = opt("plan") ? PLAN[opt("plan").toUpperCase()] : undefined;
  if (opt("plan") && !plan) throw new Error("Package must be ESSENTIAL, STANDARD or ADVANCED");
  if (plan) await sql`update company set plan = ${plan} where id = ${c.id}`;
  if (opt("addons") !== undefined) {
    const picked = opt("addons").split(",").map((s) => s.trim()).filter(Boolean);
    const bad = picked.filter((m) => !ADDONS.includes(m));
    if (bad.length) throw new Error(`Not add-ons: ${bad.join(", ")} (add-ons are ${ADDONS.join(", ")})`);
    await sql`update company set modules = ${[...CORE, ...picked]} where id = ${c.id}`;
  }
  if (opt("seats")) {
    const s = pairs(opt("seats"));
    for (const k of Object.keys(s)) if (!["STARTER", "BUSINESS", "ENTERPRISE"].includes(PLAN[k.toUpperCase()])) throw new Error(`Not a level: ${k}`);
    const norm = Object.fromEntries(Object.entries(s).map(([k, v]) => [PLAN[k.toUpperCase()], v]));
    await sql`update company set package_seats = ${sql.json(norm)} where id = ${c.id}`;
  }
  if (opt("module-seats")) {
    await sql`update company set module_seats = ${sql.json(pairs(opt("module-seats")))} where id = ${c.id}`;
  }
  const [now] = await sql`select plan, modules, package_seats, module_seats,
    (select count(*)::int from app_user u where u.company_id = c.id and u.is_active and u.password_hash is not null) as signing_in
    from company c where id = ${c.id}`;
  console.log(now);
} catch (e) {
  console.error(e.message); process.exitCode = 1;
} finally {
  await sql.end();
}

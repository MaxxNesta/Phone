// Who sees what, with sign-in on — DEV ONLY.
//
//   BASE=http://localhost:3301 node loadtest/roles-probe.mjs   (app started with AUTH_REQUIRED=true)
//
// One user and session per role, then every page in the list fetched as each:
// is it let in or turned away, and does a role without cost.view see the test
// phone's cost (2,000,000 — its price is 2,500,000)? Also the signed-out and
// forged-cookie cases. Needs loadtest/run.json from setup.mjs.
import { readFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import postgres from "postgres";

const BASE = process.env.BASE ?? "http://localhost:3301";
const RUN = JSON.parse(readFileSync("loadtest/run.json", "utf8"));
const url = process.env.DATABASE_URL
  ?? readFileSync(".env", "utf8").match(/^\s*DATABASE_URL\s*=\s*"?(.+?)"?\s*$/m)[1];
if (!url.includes("ep-winter-leaf")) { console.error("Not the dev database — refusing."); process.exit(1); }
const sql = postgres(url, { ssl: "require", prepare: false, max: 2, onnotice: () => {} });

const ROLES = (process.env.ROLES ?? "CASHIER,SALESPERSON,INVENTORY,ACCOUNTANT,MANAGER,ADMIN").split(",");
const TAG = `${RUN.run}-${Date.now().toString(36)}`;
const token = {};
for (const role of ROLES) {
  const [u] = await sql`
    insert into app_user (company_id, name, initials, role, email)
    values (${RUN.companyId}, ${`${TAG} ${role}`}, 'RP', ${role}, ${`${TAG.toLowerCase()}-${role.toLowerCase()}@probe.invalid`})
    returning id`;
  const t = randomBytes(32).toString("base64url");
  await sql`insert into user_session (user_id, token_hash, expires_at)
            values (${u.id}, ${createHash("sha256").update(t).digest("hex")}, now() + interval '2 hours')`;
  token[role] = t;
}

const [doc] = await sql`select id from document where company_id = ${RUN.companyId} and doc_type = 'GOODS_RECEIPT' order by created_at desc limit 1`;
const PAGES = [
  "/", "/pos", "/items", "/items/stock", `/items/${RUN.phoneId}`, "/inventory", "/inventory/phones",
  "/inventory/intelligence", "/inventory/intelligence/export", "/inventory/movements", "/inventory/replenishment",
  "/inventory/negative-stock", "/warehouses", "/sales/reports", "/sales/new", `/documents/${doc.id}`,
  `/documents/${doc.id}/print`, "/purchases", "/finance/income-statement", "/reports/price-history",
  "/settings", "/settings/users",
];
const get = async (path, cookie, tries = 3) => {
  try { return await get1(path, cookie); }
  catch (e) { if (tries <= 1) return { status: "ERR", to: "", body: "" }; await new Promise((r) => setTimeout(r, 3000)); return get(path, cookie, tries - 1); }
};
const get1 = (path, cookie) => fetch(BASE + path, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" })
  .then(async (r) => ({ status: r.status, to: r.headers.get("location") ?? "", body: r.status === 200 ? await r.text() : "" }));
const COST = /2,000,000|2000000(?!\d)/;

console.log(`\n  signed out`);
for (const p of ["/", "/finance/income-statement", `/documents/${doc.id}`, "/inventory/intelligence/export"]) {
  const r = await get(p);
  console.log(`  ${r.status === 200 ? "OPEN " : "shut "} ${r.status} ${p} ${r.to.replace(BASE, "")}`);
}
const forged = await get("/", `erp_session=${randomBytes(32).toString("base64url")}`);
console.log(`  ${forged.status === 200 ? "OPEN " : "shut "} ${forged.status} / with a forged session ${forged.to.replace(BASE, "")}`);

for (const role of ROLES) {
  console.log(`\n  ${role}`);
  for (const p of PAGES) {
    const r = await get(p, `erp_session=${token[role]}`);
    const leak = r.status === 200 && COST.test(r.body);
    const state = r.status === 200 ? "in   " : r.to.includes("denied") ? "denied" : `${r.status}`;
    console.log(`    ${state.padEnd(6)} ${leak ? "COST " : "     "} ${p}`);
    if (leak && process.env.CONTEXT) {
      // The words around the figure, tags stripped: a cost column, or the same number meaning something else?
      const text = r.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      const i = text.search(COST);
      console.log(`             …${text.slice(Math.max(0, i - 90), i + 30)}…`);
    }
  }
}

await sql`update user_session set expires_at = now() where user_id in (select id from app_user where email like ${"%@probe.invalid"})`;
await sql`update app_user set is_active = false where email like ${"%@probe.invalid"}`;
await sql.end();

// Role-by-role HTTP check: every sensitive page, download and document URL,
// requested as nobody and as each role, against a server running with
// sign-in on. DEV only. Makes five throwaway users, one throwaway branch and
// their sessions, and removes them all at the end.
//
//   npx next build && AUTH_REQUIRED=true npx next start -p 3000      (one terminal)
//   BASE=http://localhost:3000 node --env-file=.env scripts/check-http-roles.mjs
//
// Against a production build, not `next dev`: in development React attaches
// every awaited server value to the page for its DevTools, so a filtered list
// still carries the unfiltered rows and the content checks fail falsely.
// DUMP=<dir> saves the body of each failed page there.
//
// Not a test-*.mjs: the regression runner has no server with sign-in on.

import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";

const BASE = process.env.BASE ?? "http://localhost:3000";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 2, onnotice: () => {} });
const [co] = await sql`select id, name from company order by created_at limit 1`;
if (!/\bDEV\b/.test(co.name)) throw new Error("DEV only");

const main = (await sql`select id from location where company_id = ${co.id} and parent_id is null and is_active order by code limit 1`)[0].id;
const sales = (await sql`select id, doc_no from document where company_id = ${co.id} and doc_type = 'SALES_INVOICE' and status = 'POSTED' order by posted_at desc limit 1`)[0];
const purch = (await sql`select id, doc_no from document where company_id = ${co.id} and doc_type = 'PURCHASE_INVOICE' and status = 'POSTED' order by posted_at desc limit 1`)[0];
if (!sales || !purch) throw new Error("Needs one posted sales invoice and one posted purchase invoice on DEV");
// What an interrupted run left behind.
const old = (await sql`select id from app_user where company_id = ${co.id} and name like 'ZZSEC %'`).map((r) => r.id);
await sql`delete from user_session where user_id = any(${old})`;
await sql`delete from app_user where id = any(${old})`;
await sql`delete from location where company_id = ${co.id} and code = 'ZZSEC'`;
const [b2] = await sql`insert into location (company_id, code, name) values (${co.id}, 'ZZSEC', 'ZZ security test branch') returning id`;

const people = {
  admin: ["ADMIN", null], salesperson: ["SALESPERSON", main], inventory: ["INVENTORY", main],
  accountant: ["ACCOUNTANT", main], cashierB: ["CASHIER", b2.id],
};
const token = {};
const ids = [];
for (const [who, [role, branch]] of Object.entries(people)) {
  const [u] = await sql`insert into app_user (company_id, name, initials, email, role, branch_id)
    values (${co.id}, ${"ZZSEC " + who}, 'ZZ', ${"zzsec-" + who.toLowerCase() + "@test.invalid"}, ${role}, ${branch}) returning id`;
  ids.push(u.id);
  token[who] = randomBytes(32).toString("base64url");
  await sql`insert into user_session (user_id, token_hash, expires_at)
    values (${u.id}, ${createHash("sha256").update(token[who]).digest("hex")}, now() + interval '1 hour')`;
}

let pass = 0, fail = 0;
const rows = [];
async function get(who, path) {
  const headers = who ? { cookie: `erp_session=${token[who]}` } : {};
  const r = await fetch(BASE + path, { headers, redirect: "manual" });
  const body = r.status === 200 ? await r.text() : "";
  return { status: r.status, to: r.headers.get("location") ?? "", body };
}
/** expect: "ok" (200), "login", "denied" (redirect home with ?denied), "404", "blocked" (anything but 200), or a function. */
async function check(who, path, expect, what) {
  const r = await get(who, path);
  let ok;
  if (typeof expect === "function") ok = r.status === 200 && expect(r.body);
  else if (expect === "ok") ok = r.status === 200;
  else if (expect === "login") ok = r.status >= 300 && r.status < 400 && r.to.includes("/login");
  else if (expect === "denied") ok = r.status >= 300 && r.status < 400 && r.to.includes("denied=");
  else if (expect === "404") ok = r.status === 404;
  else if (expect === "blocked") ok = r.status !== 200;
  else if (expect.startsWith("to:")) ok = r.status >= 300 && r.status < 400 && r.to.includes(expect.slice(3));
  ok ? pass++ : fail++;
  // On a failed content check, show where the unwanted text sits, so the cause is visible.
  if (!ok && process.env.DUMP) (await import("node:fs")).writeFileSync(process.env.DUMP + "/" + (who ?? "anon") + path.replace(/[^a-z0-9]+/gi, "_") + ".html", `status ${r.status} needle ${expect.needle}
` + r.body);
  if (!ok && typeof expect === "function" && expect.needle && r.body.includes(expect.needle)) {
    const i = r.body.indexOf(expect.needle);
    rows.push("      …" + r.body.slice(Math.max(0, i - 240), i + 60).replace(/\s+/g, " ") + "…");
  }
  rows.push(`${ok ? "PASS" : "FAIL"}  ${(who ?? "anonymous").padEnd(12)} ${path.padEnd(52)} ${what}  [${r.status}${r.to ? " → " + r.to.replace(BASE, "") : ""}]`);
}
// Every page carries the whole translation bundle, so a label's words are in
// the HTML whether or not its card is drawn: checks look for the rendered card.
const has = (s) => (b) => b.includes(s);
const lacks = (s) => Object.assign((b) => !b.includes(s), { needle: s });

try {
  const S = `/documents/${sales.id}`, P = `/documents/${purch.id}`;
  // Nobody signed in.
  for (const p of ["/", "/sales", "/purchases", "/items/stock", "/finance/balance-sheet", "/inventory/intelligence/export",
                   "/products/export", "/inventory/export", S, `${S}/print`, "/search?q=DP", "/documents", "/fixed-assets", "/equity/shareholders"])
    await check(null, p, "login", "signed out → sign-in page");
  await check(null, "/api/company-logo", "blocked", "logo needs a session");
  await check(null, `/documents/${sales.id}.pdf`, "blocked", "path with an extension skips middleware, page must still refuse");

  // Salesperson at the main branch: sales, no cost, no purchases.
  await check("salesperson", "/", "to:/sales", "lands on Sales overview");
  await check("salesperson", "/sales", lacks('kpi-label">Gross profit'), "Sales overview without gross profit card");
  await check("salesperson", "/purchases", "denied", "no purchases");
  await check("salesperson", "/items/stock", lacks("Avg. cost"), "stock without cost");
  await check("salesperson", "/inventory/intelligence", "denied", "no margin report");
  await check("salesperson", "/inventory/intelligence/export", "denied", "no margin download");
  await check("salesperson", "/overview", "denied", "no whole-business overview");
  await check("salesperson", "/documents/history", "denied", "no void/amend history");
  await check("salesperson", "/finance/balance-sheet", "denied", "no financial statements");
  await check("salesperson", "/finance/income-statement", "denied", "no P&L");
  await check("salesperson", "/settings/users", "denied", "no user admin");
  await check("salesperson", S, "ok", "own sales invoice opens");
  await check("salesperson", P, "404", "purchase invoice by URL refused");
  await check("salesperson", "/documents", lacks(purch.doc_no), "documents list hides purchases");
  await check("salesperson", "/search?q=DP2026", lacks(purch.doc_no), "search hides purchases");

  // Inventory clerk: purchases without payables, stock without cost.
  await check("inventory", "/", "to:/purchases", "lands on Purchases overview");
  await check("inventory", "/purchases", lacks('kpi-label">Payables owed'), "Purchases overview without payables card");
  await check("inventory", "/items/stock", lacks("Avg. cost"), "stock without cost");
  await check("inventory", "/sales", "denied", "no sales");
  await check("inventory", "/payables", "denied", "no payables");
  await check("inventory", P, "ok", "purchase invoice opens");
  await check("inventory", S, "404", "sales invoice by URL refused");

  // Accountant: books and cost, no till.
  await check("accountant", "/finance/balance-sheet", "ok", "balance sheet");
  await check("accountant", "/items/stock", has("Avg. cost"), "stock with cost");
  await check("accountant", "/inventory/intelligence", "ok", "margin report");
  await check("accountant", "/purchases", has('kpi-label">Payables owed'), "Purchases overview with payables card");
  await check("accountant", "/pos", "denied", "no till");
  await check("accountant", "/settings/users", "denied", "no user admin");

  // Administrator: everything.
  await check("admin", "/", has("Accounting health"), "main dashboard with accounting health");
  await check("admin", "/items/stock", has("Avg. cost"), "stock with cost");
  await check("admin", "/settings/users", "ok", "user admin");
  await check("admin", "/sales", has('kpi-label">Gross profit'), "Sales overview with gross profit card");

  // A cashier at another branch: nothing of the main branch.
  await check("cashierB", S, "404", "other branch's sales invoice by URL refused");
  await check("cashierB", `${S}/print`, "404", "other branch's print view refused");
  await check("cashierB", "/sales", lacks(sales.doc_no), "Sales overview hides other branch");
  await check("cashierB", "/documents", lacks(sales.doc_no), "documents list hides other branch");
  await check("cashierB", `/search?q=${sales.doc_no}`, lacks(`/documents/${sales.id}`), "search hides other branch");
} finally {
  await sql`delete from user_session where user_id = any(${ids})`;
  await sql`delete from app_user where id = any(${ids})`;
  await sql`delete from location where id = ${b2.id}`;
  await sql.end();
}
console.log(rows.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

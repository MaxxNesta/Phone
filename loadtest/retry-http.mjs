// Retries over HTTP — DEV ONLY. The same POS sale sent several times at once
// (a double click, a till retrying a request it thinks failed) and again after
// it went through: each must be one sale.
//
//   BASE=<deployed dev url> VJWT=<_vercel_jwt> node loadtest/retry-http.mjs
//
// Needs loadtest/run.json from setup.mjs. Action ids are read off the build.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const BASE = process.env.BASE, VJWT = process.env.VJWT ?? "";
const RUN = JSON.parse(readFileSync("loadtest/run.json", "utf8"));
const url = process.env.DATABASE_URL
  ?? readFileSync(".env", "utf8").match(/^\s*DATABASE_URL\s*=\s*"?(.+?)"?\s*$/m)[1];
if (!url.includes("ep-winter-leaf")) { console.error("Not the dev database — refusing."); process.exit(1); }
const sql = postgres(url, { ssl: "require", prepare: false, max: 2, onnotice: () => {} });

const cookie = (i = 0) => `erp_session=${RUN.users[i]}${VJWT ? `; _vercel_jwt=${VJWT}` : ""}`;

// The id React wrote into the client bundle for this action.
async function actionId(path, name) {
  const html = await (await fetch(BASE + path, { headers: { Cookie: cookie() } })).text();
  const chunks = [...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+\.js)"/g)].map((m) => m[1]);
  for (const c of chunks) {
    const js = await (await fetch(BASE + c, { headers: { Cookie: cookie() } })).text();
    const m = js.match(new RegExp(`\\("([0-9a-f]{40,})"[^)]*?"${name}"\\)`));
    if (m) return m[1];
  }
  throw new Error(`no action id for ${name} on ${path}`);
}

const POS = await actionId("/pos", "posPostSale");
const sell = (sale, user = 0) => fetch(BASE + "/pos", {
  method: "POST",
  headers: { Cookie: cookie(user), "Next-Action": POS, Accept: "text/x-component",
             "Content-Type": "text/plain;charset=UTF-8", Origin: BASE },
  body: JSON.stringify([sale]),
}).then(async (r) => ({ status: r.status, body: await r.text() }));

const saleOf = (itemId, attempt, serials) => ({
  partnerId: null, locationId: RUN.warehouseId, salesmanId: null, priceIncludesTax: false,
  memo: `RETRY ${RUN.run}`, attempt,
  lines: [{ itemId, qty: 1, unitPrice: serials ? 2500000 : 15000, discountPct: 0, taxCodeId: null,
             serials: serials ?? [], warrantyMonths: serials ? 12 : null }],
  payments: [{ accountId: RUN.cashAccountId, amount: serials ? 2500000 : 15000 }],
});
const posted = async (attempt) => (await sql`
  select count(*)::int n from document where company_id = ${RUN.companyId}
     and doc_type = 'SALES_INVOICE' and reference = ${"POS:" + attempt}`)[0].n;

let bad = 0;
const check = (label, ok, detail = "") => { if (!ok) bad++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`); };

console.log(`\n  ${BASE}\n`);
for (const [what, itemId, serials] of [["a case", RUN.caseId, null], ["a phone", RUN.phoneId, [RUN.imeis[Math.floor(Math.random() * RUN.imeis.length)]]]]) {
  const attempt = randomUUID();
  const sale = saleOf(itemId, attempt, serials);
  const replies = await Promise.all(Array.from({ length: 6 }, (_, i) => sell(sale, i)));
  const n = await posted(attempt);
  // What each request was told: one "posted", the rest the same sale or a clear refusal.
  for (const r of replies) console.log("     ", r.body.split("\n").filter((l) => l.startsWith("1:")).join(" ").slice(0, 160));
  check(`${what}, the same sale sent 6 times at once, is one sale`, n === 1,
    `${n} posted; HTTP ${replies.map((r) => r.status).join(",")}`);
  const again = await sell(sale);
  check(`  and sent again afterwards it is still one`, (await posted(attempt)) === 1, `HTTP ${again.status}`);
}
await sql.end();
console.log(bad ? `\n  ${bad} FAILED\n` : "\n  all passed\n");
process.exit(bad ? 1 : 0);

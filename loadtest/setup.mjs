// Load-test setup — DEV ONLY. Creates tagged users, sessions, a supplier, a
// customer, a quantity item and an IMEI phone, stocks them through the real
// posting engine, and writes loadtest/run.json for k6.
//
//   npx tsx loadtest/setup.mjs
//
// Everything it makes carries the run tag (LT<timestamp>) in its code, name
// or memo, so verify.mjs and cleanup.mjs can find it again.

import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";

const url = process.env.DATABASE_URL
  ?? readFileSync(".env", "utf8").match(/^\s*DATABASE_URL\s*=\s*"?(.+?)"?\s*$/m)[1];
process.env.DATABASE_URL = url;
// The guard: dev's Neon endpoint, never pilot (ep-billowing-boat) or production (ep-flat-cloud).
if (!url.includes("ep-winter-leaf")) {
  console.error("Refusing: DATABASE_URL is not the dev database (ep-winter-leaf).");
  process.exit(1);
}

const { sql } = await import("../lib/db.ts");
const { postGoodsReceipt } = await import("../lib/posting.ts");

const RUN = "LT" + new Date().toISOString().replace(/\D/g, "").slice(2, 12);
const USERS = Number(process.env.LT_USERS ?? 52);
const PHONES = Number(process.env.LT_PHONES ?? 4000);
const RACE_PAIRS = Number(process.env.LT_RACE ?? 20);

const [co] = await sql`select id, name from company order by created_at limit 1`;
const [wh] = await sql`select id, code from location where company_id = ${co.id} and code = 'MAIN-WH'`;
const [cash] = await sql`select id from account where company_id = ${co.id} and code = '1000'`;
const [uom] = await sql`select id from uom where company_id = ${co.id} order by code limit 1`;
const [grp] = await sql`select id from item_group where company_id = ${co.id} and name = 'iPhone' and parent_id is null`;
const [retail] = await sql`select id from price_level where company_id = ${co.id} and code = 'RETAIL'`;
const today = new Date().toISOString().slice(0, 10);

// Users and their sessions: one account per virtual user, each with its own cookie.
const users = [];
for (let i = 1; i <= USERS; i++) {
  const [u] = await sql`
    insert into app_user (company_id, name, initials, role, email)
    values (${co.id}, ${`${RUN} user ${i}`}, 'LT', 'ADMIN', ${`${RUN.toLowerCase()}-${i}@loadtest.invalid`})
    returning id`;
  const token = randomBytes(32).toString("base64url");
  await sql`insert into user_session (user_id, token_hash, expires_at)
            values (${u.id}, ${createHash("sha256").update(token).digest("hex")}, now() + interval '12 hours')`;
  users.push(token);
}

const [supp] = await sql`
  insert into business_partner (company_id, code, name, is_supplier, payment_terms_days)
  values (${co.id}, ${RUN + "-S"}, ${RUN + " supplier"}, true, 30) returning id`;
const [cust] = await sql`
  insert into business_partner (company_id, code, name, is_customer, payment_terms_days, price_level_id)
  values (${co.id}, ${RUN + "-C"}, ${RUN + " customer"}, true, 30, ${retail.id}) returning id`;

const mkItem = async (code, name, serial) => (await sql`
  insert into item (company_id, item_group_id, code, serial, name, base_uom_id, is_stocked, tracks_serial, identity)
  values (${co.id}, ${grp.id}, ${code}, ${code}, ${name}, ${uom.id}, true, ${serial}, ${serial ? "IMEI" : "NONE"})
  returning id`)[0].id;
const caseId = await mkItem(RUN + "-CASE", `${RUN} case`, false);
const phoneId = await mkItem(RUN + "-PHONE", `${RUN} phone`, true);
for (const [id, price] of [[caseId, 15000], [phoneId, 2500000]]) {
  await sql`insert into item_price (company_id, item_id, price_level_id, uom_id, currency, price)
            values (${co.id}, ${id}, ${retail.id}, ${uom.id}, 'MMK', ${price})`;
}

// IMEIs that pass the Luhn check, unique to this run.
const luhn = (body) => {
  let sum = 0;
  for (let i = 0; i < 14; i++) { let d = Number(body[13 - i]); if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return body + ((10 - (sum % 10)) % 10);
};
// 35 + seven digits of the run + a five-digit counter = the 14 digits before the check digit.
const stamp = RUN.slice(-7);
if (PHONES + RACE_PAIRS > 99999) throw new Error("At most 99,999 phones per run.");
const imeis = Array.from({ length: PHONES + RACE_PAIRS }, (_, i) => luhn("35" + stamp + String(i).padStart(5, "0")));

// Stock, through the posting engine: plenty of cases, and every phone by IMEI.
const gr = await sql.begin((tx) => postGoodsReceipt({
  companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: today,
  memo: `LOADTEST ${RUN} opening stock`, reference: `${RUN}-OPEN`,
  lines: [
    { itemId: caseId, qty: 1_000_000, unitCost: 5000 },
    // In lines of 4,000: one GR line's IMEIs go in one insert, and Postgres
    // caps a statement at 65,534 parameters (9 per phone) — found here.
    ...Array.from({ length: Math.ceil(imeis.length / 4000) }, (_, k) => imeis.slice(k * 4000, (k + 1) * 4000))
      .map((chunk) => ({ itemId: phoneId, qty: chunk.length, unitCost: 2000000, serials: chunk })),
  ],
}, tx));

const run = {
  run: RUN, companyId: co.id, warehouseId: wh.id, cashAccountId: cash.id,
  supplierId: supp.id, customerId: cust.id, caseId, phoneId, openingGr: gr.id,
  users, imeis: imeis.slice(0, PHONES), raceImeis: imeis.slice(PHONES), today,
};
writeFileSync("loadtest/run.json", JSON.stringify(run));
console.log(`${RUN}: ${USERS} users, ${PHONES} sellable phones, ${RACE_PAIRS} race phones, opening GR ${gr.docNo}`);
await sql.end();

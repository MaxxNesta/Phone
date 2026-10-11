// After a load test: ends the test sessions and retires what the runs made.
// Posted documents stay — they are the books, and removing them would mean
// wiping dev's transactions — but they are tagged (memo LOADTEST…, reference
// POS:LT… / LT…) and the items, partners and accounts they used are
// deactivated so they leave every list and picker.
//   node loadtest/cleanup.mjs
import postgres from "postgres";
import { readFileSync } from "node:fs";

const url = process.env.DATABASE_URL
  ?? readFileSync(".env", "utf8").match(/^\s*DATABASE_URL\s*=\s*"?(.+?)"?\s*$/m)[1];
if (!url.includes("ep-winter-leaf")) { console.error("Not the dev database — refusing."); process.exit(1); }
const sql = postgres(url, { ssl: "require", max: 1, prepare: false });

const s = await sql`delete from user_session where user_id in
                      (select id from app_user where name ~ '^LT[0-9]{10} user ') returning id`;
const u = await sql`update app_user set is_active = false where name ~ '^LT[0-9]{10} user ' and is_active returning id`;
const i = await sql`update item set is_active = false where serial ~ '^LT[0-9]{10}-(CASE|PHONE)$' and is_active returning id`;
const p = await sql`update business_partner set is_active = false where code ~ '^LT[0-9]{10}-[SC]$' and is_active returning id`;
console.log(`sessions ended ${s.length}, users deactivated ${u.length}, items deactivated ${i.length}, partners deactivated ${p.length}`);
await sql.end();

// Throwaway: "historical" fixed-asset journals on DEV, posted the ordinary way,
// for trying Journal Reconciliation.
//   ALLOW_DESTRUCTIVE_TESTS=1 npx tsx scripts/_demo-fa-history.mjs
// Removed with the rest of DEV's transactions by scripts/_demo-fa.mjs --remove.
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1, onnotice: () => {} });
const [co] = await sql`select id, name from company order by created_at limit 1`;
if (!/\bDEV\b/.test(co.name)) throw new Error("DEV only");
const P = await import("../lib/posting.ts");
const acc = async (code) => (await sql`select id from account where company_id = ${co.id} and code = ${code}`)[0].id;
const [b2] = await sql`select id from location where company_id = ${co.id} and parent_id is null and name = 'Branch 2'`;
const jv = (docDate, memo, lines) => P.postJournalVoucher({ companyId: co.id, docDate, memo, locationId: b2.id,
  lines: lines.map(([code, amount]) => ({ accountId: code, amount })) });
const [a11301, a12109, a66301, a31105] = await Promise.all(["11301", "12109", "66301", "31105"].map(acc));
const r1 = await jv("2025-04-01", "Generator 25kVA purchased (owner contribution, booked at year start)", [[a11301, 12_000_000], [a31105, -12_000_000]]);
const r2 = await jv("2025-04-30", "Depreciation Apr 2025, generator", [[a66301, 190_000], [a12109, -190_000]]);
// One journal for two assets: generator and solar set, December 2025.
const r3 = await jv("2025-12-31", "Depreciation Dec 2025, generator & solar", [[a66301, 290_000], [a12109, -290_000]]);
console.log("posted", r1.docNo, r2.docNo, r3.docNo);
await sql.end(); process.exit(0);

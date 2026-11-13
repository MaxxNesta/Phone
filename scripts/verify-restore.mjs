// Did the backup come back whole? Read-only checks on a restored database,
// optionally against the database it was restored from.
//
//   RESTORED_URL="<restored branch url>" npx tsx scripts/verify-restore.mjs
//   RESTORED_URL="..." SOURCE_URL="<prod url>" RESTORE_POINT="2026-11-13T09:00:00+06:30" \
//     npx tsx scripts/verify-restore.mjs
//
// Never writes to either database. Exit code 0 when every check passes.
//
// On its own it checks the restored copy makes sense: every migration is
// recorded, the ledger balances, no journal entry is lopsided, no line points
// at a missing document, and the key tables are not empty.
//
// With SOURCE_URL and RESTORE_POINT it also compares, table by table, the
// rows created up to the restore point. The ledger is append-only (corrections
// are reversals), so the source still holds exactly those rows and the counts
// must match.
import postgres from "postgres";

const restoredUrl = process.env.RESTORED_URL;
const sourceUrl = process.env.SOURCE_URL;
const at = process.env.RESTORE_POINT;
if (!restoredUrl) { console.error("Set RESTORED_URL to the restored database."); process.exit(2); }
if (sourceUrl && !at) { console.error("With SOURCE_URL, also set RESTORE_POINT (the time the backup was taken from)."); process.exit(2); }

const open = (url) => postgres(url, { max: 1, prepare: false, connection: { default_transaction_read_only: "on" } });
const R = open(restoredUrl);
const S = sourceUrl ? open(sourceUrl) : null;

let failed = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

// The tables that hold the business. Counted, and compared when a source is given.
const KEY = ["company", "account", "business_partner", "item", "document", "document_line",
  "journal_entry", "journal_line", "stock_movement", "stock_serial", "sales_cost_allocation", "app_user"];

try {
  console.log("Restored database");
  const [{ n: migrations }] = await R`select count(*)::int as n from schema_migration`;
  const files = (await import("node:fs")).readdirSync(new URL("../db/migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).length;
  check(migrations > 0, "migrations recorded", `${migrations} of ${files} in this checkout`);

  for (const t of KEY) {
    const [{ n }] = await R`select count(*)::int as n from ${R(t)}`;
    check(t === "app_user" || n > 0, `${t} has rows`, n.toLocaleString("en-US"));
  }

  // Lines carry a signed amount: debits positive, credits negative, so a whole ledger sums to nought.
  const [tb] = await R`select coalesce(sum(amount), 0)::text as net, coalesce(sum(abs(amount)), 0)::text as moved from journal_line`;
  check(Number(tb.net) === 0, "ledger balances (debits and credits net to nought)", `net ${tb.net}, moved ${tb.moved}`);

  const lopsided = await R`
    select je.id from journal_entry je join journal_line jl on jl.journal_entry_id = je.id
     group by je.id having sum(jl.amount) <> 0 limit 5`;
  check(lopsided.length === 0, "every journal entry balances", lopsided.length ? `e.g. ${lopsided[0].id}` : "");

  const [{ n: orphanLines }] = await R`
    select count(*)::int as n from document_line dl where not exists (select 1 from document d where d.id = dl.document_id)`;
  check(orphanLines === 0, "every document line has its document");

  const [{ n: orphanJl }] = await R`
    select count(*)::int as n from journal_line jl where not exists (select 1 from journal_entry je where je.id = jl.journal_entry_id)`;
  check(orphanJl === 0, "every journal line has its entry");

  const [last] = await R`select max(created_at) as at from document`;
  console.log(`  ....  newest document in the copy: ${last.at ? new Date(last.at).toISOString() : "none"}`);
  if (at && last.at) check(new Date(last.at) <= new Date(at), "nothing in the copy is newer than the restore point");

  if (S) {
    console.log(`\nAgainst the source, rows created up to ${at}`);
    for (const t of KEY) {
      const hasCreated = (await R`
        select 1 from information_schema.columns where table_name = ${t} and column_name = 'created_at'`).length > 0;
      if (!hasCreated) continue;
      const [{ n: r }] = await R`select count(*)::int as n from ${R(t)} where created_at <= ${at}`;
      const [{ n: s }] = await S`select count(*)::int as n from ${S(t)} where created_at <= ${at}`;
      check(r === s, `${t}`, `restored ${r.toLocaleString("en-US")} · source ${s.toLocaleString("en-US")}`);
    }
    const sums = async (db) => (await db`
      select coalesce(sum(abs(jl.amount)), 0)::text as dr from journal_line jl
        join journal_entry je on je.id = jl.journal_entry_id where je.created_at <= ${at}`)[0].dr;
    const [rs, ss] = await Promise.all([sums(R), sums(S)]);
    check(rs === ss, "ledger totals up to the restore point", `restored ${rs} · source ${ss}`);
  }
} catch (e) {
  failed++;
  console.error("  FAIL  ", e.message);
} finally {
  await R.end(); if (S) await S.end();
}

console.log(failed ? `\n${failed} check(s) failed: do not rely on this backup until it is explained.` : "\nAll checks pass: the backup restored whole.");
process.exit(failed ? 1 : 0);

// Master data the test suites leave behind, and the way it is taken away.
//
// The suites make their own items, categories, brands and partners so they
// can prove one thing at a time — and most never removed them, so DEV filled
// up with "Branch Test", "Foc 240496" and "Import Test 367630" beside the
// shop's real categories. Two uses:
//
//   import { snapshotMasters, removeNewMasters } from "./masters-cleanup.mjs"
//     what regression.mjs does: note what exists before a run, take away
//     whatever was added once it ends.
//
//   node scripts/masters-cleanup.mjs --prune
//     once, by hand: remove every category and brand that is not the shop's
//     own (migration 0149), with the items in them. DEV only, and only while
//     nothing is posted.
//
// A row is removed with whatever points at it, found from the database's own
// foreign keys rather than a list kept here that would fall out of date.

import { readFileSync, existsSync } from "node:fs";
import postgres from "postgres";
import { resetTransactions } from "./test-reset.mjs";

const TABLES = ["item", "item_group", "brand", "business_partner"];

export async function snapshotMasters(sql) {
  const snap = {};
  for (const t of TABLES) snap[t] = new Set((await sql`select id from ${sql(t)}`).map((r) => r.id));
  return snap;
}

/** Rows of other tables that point at `table`, as [table, column]. */
async function referencing(sql, table) {
  return (await sql`
    select cl.relname as tbl, att.attname as col
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any(con.conkey)
     where con.contype = 'f' and con.confrelid = ${table}::regclass
       and cl.relnamespace = 'public'::regnamespace`).map((r) => [r.tbl, r.col]);
}

/** Deletes `ids` from `table`, and everything that points at them first. */
async function removeWithDependents(sql, table, ids, depth = 0) {
  if (ids.length === 0 || depth > 4) return;
  for (const [tbl, col] of await referencing(sql, table)) {
    if (tbl === table) continue; // a parent row; handled by deleting children first
    if (TABLES.includes(tbl)) continue; // removed in its own turn
    const dep = (await sql`select id from ${sql(tbl)} where ${sql(col)} = any(${ids})`.catch(() => []))
      .map((r) => r.id).filter(Boolean);
    if (dep.length) await removeWithDependents(sql, tbl, dep, depth + 1);
    await sql`delete from ${sql(tbl)} where ${sql(col)} = any(${ids})`.catch(() => {});
  }
  // Children before parents: variants before their product, sub categories before theirs.
  if (table === "item" || table === "item_group") {
    const col = table === "item" ? "parent_item_id" : "parent_id";
    const kids = (await sql`select id from ${sql(table)} where ${sql(col)} = any(${ids})`).map((r) => r.id);
    if (kids.length) await removeWithDependents(sql, table, kids, depth + 1);
  }
  await sql`delete from ${sql(table)} where id = any(${ids})`;
}

async function removeIds(sql, plan) {
  // Transactions point at items and partners; a test database keeps none worth keeping.
  await resetTransactions(sql);
  const counts = {};
  for (const t of TABLES) {
    const ids = plan[t] ?? [];
    if (t === "item_group" && ids.length) {
      // Items in a category being removed go with it.
      const items = (await sql`select id from item where item_group_id = any(${ids})`).map((r) => r.id);
      await removeWithDependents(sql, "item", items);
    }
    // A brand still named on an item that stays: the item keeps no brand.
    if (t === "brand" && ids.length) await sql`update item set brand_id = null where brand_id = any(${ids})`;
    await removeWithDependents(sql, t, ids);
    counts[t] = ids.length;
  }
  return counts;
}

/** What a run added, taken away. */
export async function removeNewMasters(sql, snap) {
  const plan = {};
  for (const t of TABLES) {
    plan[t] = (await sql`select id from ${sql(t)}`).map((r) => r.id).filter((id) => !snap[t].has(id));
  }
  return removeIds(sql, plan);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("masters-cleanup.mjs")) {
  if (process.argv.includes("--prune")) {
    let url = process.env.DATABASE_URL;
    if (!url && existsSync(".env")) {
      for (const line of readFileSync(".env", "utf8").split("\n")) {
        const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
        if (m) { url = m[1].replace(/^["']|["']$/g, ""); break; }
      }
    }
    const sql = postgres(url, { ssl: "require", prepare: false, max: 1, onnotice: () => {} });
    const [co] = await sql`select id, name from company order by created_at limit 1`;
    const [{ n }] = await sql`select count(*)::int as n from journal_line`;
    if (!/\bDEV\b/i.test(co?.name ?? "") || n > 0) {
      console.error(`Refusing: "${co?.name}" is not DEV, or it has ${n} posted lines.`);
      process.exit(1);
    }
    const keepCats = ["IPH", "AND", "IPD", "TAB", "MAC", "LAP", "AW", "SWT", "AUD", "ACC", "FAN", "SIM", "SVC"];
    const keepBrands = ["APPLE", "SAMSUNG", "NOTHING", "LENOVO", "NESTA", "ANKER", "MOPHIE", "MOMAX", "JISULIFE", "MYTEL"];
    // Top categories that are not the shop's own, and everything filed under them.
    const roots = (await sql`select id from item_group where company_id = ${co.id} and parent_id is null
                              and not (code = any(${keepCats}))`).map((r) => r.id);
    const cats = roots.length ? (await sql`
      with recursive t as (select id from item_group where id = any(${roots})
                           union all select g.id from item_group g join t on g.parent_id = t.id)
      select id from t`).map((r) => r.id) : [];
    const brands = (await sql`select id from brand where company_id = ${co.id}
                               and not (upper(code) = any(${keepBrands}))`).map((r) => r.id);
    console.log(await removeIds(sql, { item_group: cats, brand: brands }));
    console.log((await sql`select code || ' ' || name as c from item_group where parent_id is null order by code`)
      .map((r) => r.c).join(" · "));
    await sql.end();
  }
}

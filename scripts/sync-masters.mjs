// Brings pilot or production up to DEV's master data: customers, suppliers
// and the catalogue.
//
//   TARGET_URL="<pilot or production>" node scripts/sync-masters.mjs           what would change
//   TARGET_URL="<pilot or production>" node scripts/sync-masters.mjs --apply   change it
//
// The source is DEV (.env), refused unless its company is called DEV. Nothing
// on the target is deleted and no transaction is touched: rows are inserted
// or updated, in one transaction that rolls back on any error.
//
// Partners and items keep DEV's ids on every database (the first copy, on
// 2026-10-31, kept them), so they are matched by id. The tables they point
// at — brands, categories, units, price levels, variant attributes and
// options, accounts — were made on each database with ids of their own, so
// those are matched by code and every reference is translated.

import { readFileSync } from "node:fs";
import postgres from "postgres";

const apply = process.argv.includes("--apply");
const devUrl = readFileSync(".env", "utf8").match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/m)[1].replace(/^["']|["']$/g, "");
const targetUrl = process.env.TARGET_URL;
if (!targetUrl) { console.error("TARGET_URL is not set"); process.exit(1); }
if (new URL(targetUrl).host === new URL(devUrl).host) { console.error("The target is DEV itself."); process.exit(1); }

const open = (url) => postgres(url, { ssl: "require", prepare: false, max: 1, onnotice: () => {} });
const src = open(devUrl), dst = open(targetUrl);

const [sco] = await src`select id, name from company order by created_at limit 1`;
if (!/\bDEV\b/.test(sco.name)) { console.error(`Refusing: the source is "${sco.name}", not DEV.`); process.exit(1); }
const [tco] = await dst`select id, name from company order by created_at limit 1`;
console.log(`\n  ${sco.name} → ${tco.name}${apply ? "" : "   (dry run: nothing is written)"}\n`);

const rows = (t) => src`select * from ${src(t)} where company_id = ${sco.id}`;
const columns = async (db, t) => (await db`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${t}`).map((r) => r.column_name);
const report = {};
const note = (t, k) => { report[t] ??= { inserted: 0, updated: 0, unchanged: 0, skipped: [] }; if (typeof k === "string") report[t][k]++; else report[t].skipped.push(k.why); };

class DryRun extends Error {}

try {
  await dst.begin(async (tx) => {
    const by = async (t, key) => new Map((await tx`select * from ${tx(t)} where company_id = ${tco.id}`).map((r) => [key(r), r]));
    const tcols = {};
    const colsOf = async (t) => (tcols[t] ??= await columns(tx, t));

    /** Inserts a row copied from DEV, keeping DEV's id where the target has not used it. */
    const insert = async (t, row) => {
      const cols = (await colsOf(t)).filter((c) => c in row);
      const out = Object.fromEntries(cols.map((c) => [c, row[c]]));
      const [hit] = await tx`select 1 from ${tx(t)} where id = ${row.id}`;
      if (hit) delete out.id;
      const [made] = await tx`insert into ${tx(t)} ${tx(out)} returning id`;
      return made.id;
    };

    /** A lookup table matched by code (or by a key), the missing rows copied over. */
    const lookup = async (t, key, fix = (r) => r, fallback = null, only = null) => {
      const have = await by(t, key);
      const byName = fallback ? new Map([...have.values()].map((r) => [fallback(r), r])) : null;
      const map = new Map();
      for (const r of await rows(t)) {
        if (only && !only.has(r.id)) continue;
        const hit = have.get(key(fix({ ...r }))) ?? byName?.get(fallback(fix({ ...r })));
        if (hit) { map.set(r.id, hit.id); note(t, "unchanged"); continue; }
        map.set(r.id, await insert(t, { ...fix({ ...r }), company_id: tco.id }));
        note(t, "inserted");
      }
      return map;
    };

    const brand = await lookup("brand", (r) => r.code, undefined, (r) => r.name.toLowerCase());
    const uom = await lookup("uom", (r) => r.code);
    // Only the price levels a partner is on: the target keeps its own list otherwise.
    const level = await lookup("price_level", (r) => r.code, undefined, null,
      new Set((await src`select price_level_id from business_partner where company_id = ${sco.id} and price_level_id is not null`).map((r) => r.price_level_id)));
    const category = await lookup("partner_category", (r) => r.code);
    // Categories: a parent before its children, so each child's parent is already mapped.
    const groupRows = await rows("item_group");
    const depth = (g) => { let d = 0, p = g.parent_id; while (p) { d++; p = groupRows.find((x) => x.id === p)?.parent_id; } return d; };
    groupRows.sort((a, b) => depth(a) - depth(b));
    const haveGroups = await by("item_group", (r) => r.code);
    const group = new Map();
    for (const g of groupRows) {
      const hit = haveGroups.get(g.code);
      if (hit) { group.set(g.id, hit.id); note("item_group", "unchanged"); continue; }
      group.set(g.id, await insert("item_group", { ...g, company_id: tco.id, parent_id: g.parent_id ? group.get(g.parent_id) : null }));
      note("item_group", "inserted");
    }
    const attribute = await lookup("variant_attribute", (r) => r.code);
    const option = await lookup("variant_option", (r) => `${r.attribute_id}|${r.code}`,
      (r) => ({ ...r, attribute_id: attribute.get(r.attribute_id) ?? r.attribute_id }),
      // Same value under another code (Black and BK): one option, not two.
      (r) => `${r.attribute_id}|${r.name.toLowerCase()}`);
    const accounts = new Map((await tx`select id, code from account where company_id = ${tco.id}`).map((r) => [r.code, r.id]));
    const srcAccounts = new Map((await src`select id, code from account where company_id = ${sco.id}`).map((r) => [r.id, r.code]));
    const account = (id) => (id ? accounts.get(srcAccounts.get(id)) ?? null : null);

    /** Partners and items: matched by id, references translated, inserted or brought up to date. */
    const upsert = async (t, list, translate) => {
      const cols = await colsOf(t);
      const have = new Map((await tx`select * from ${tx(t)} where id = any(${list.map((r) => r.id)})`).map((r) => [r.id, r]));
      const codes = new Map((await tx`select id, code from ${tx(t)} where company_id = ${tco.id}`).map((r) => [r.code, r.id]));
      const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
      for (const r of list) {
        const row = translate({ ...r, company_id: tco.id });
        const keep = cols.filter((c) => c in row && c !== "created_at");
        const old = have.get(r.id);
        if (!old) {
          if (codes.has(r.code)) { note(t, { why: `${r.code} exists there under another id` }); continue; }
          await tx`insert into ${tx(t)} ${tx(Object.fromEntries(keep.map((c) => [c, row[c]])))}`;
          note(t, "inserted");
          continue;
        }
        const changed = keep.filter((c) => c !== "id" && !same(old[c] instanceof Date ? old[c].toISOString() : old[c], row[c] instanceof Date ? row[c].toISOString() : row[c]));
        if (!changed.length) { note(t, "unchanged"); continue; }
        await tx`update ${tx(t)} set ${tx(Object.fromEntries(changed.map((c) => [c, row[c]])), ...changed)} where id = ${r.id}`;
        note(t, "updated");
        for (const c of changed) { report[t].columns ??= {}; report[t].columns[c] = (report[t].columns[c] ?? 0) + 1; }
      }
    };

    await upsert("business_partner", await rows("business_partner"), (r) => ({
      ...r,
      price_level_id: r.price_level_id ? level.get(r.price_level_id) : null,
      category_id: r.category_id ? category.get(r.category_id) : null,
      supplier_category_id: r.supplier_category_id ? category.get(r.supplier_category_id) : null,
      ar_control_id: account(r.ar_control_id), ap_control_id: account(r.ap_control_id),
    }));

    // Products before their variants.
    const items = (await rows("item")).sort((a, b) => (a.parent_item_id ? 1 : 0) - (b.parent_item_id ? 1 : 0));
    await upsert("item", items, (r) => ({
      ...r,
      item_group_id: group.get(r.item_group_id) ?? null,
      brand_id: r.brand_id ? brand.get(r.brand_id) : null,
      base_uom_id: uom.get(r.base_uom_id),
      // DEV's import batches and users do not exist there.
      import_batch_id: null, duplicate_ack_by: null,
    }));

    // Which attributes and options each product carries: made to match DEV's.
    const ids = items.map((i) => i.id);
    for (const [t, col, map] of [["item_variant_attribute", "attribute_id", attribute], ["item_variant_option", "option_id", option]]) {
      const want = (await src`select * from ${src(t)} where item_id = any(${ids})`).map((r) => ({ ...r, [col]: map.get(r[col]) }));
      const have = await tx`select * from ${tx(t)} where item_id = any(${ids})`;
      const key = (r) => `${r.item_id}|${r[col]}|${r.sort_order ?? ""}`;
      const a = new Set(want.map(key)), b = new Set(have.map(key));
      if (want.length === have.length && [...a].every((k) => b.has(k))) { report[t] = { unchanged: want.length }; continue; }
      await tx`delete from ${tx(t)} where item_id = any(${ids})`;
      if (want.length) await tx`insert into ${tx(t)} ${tx(want)}`;
      report[t] = { replaced: want.length, before: have.length };
    }

    for (const [t, r] of Object.entries(report)) {
      const skipped = r.skipped?.length ? `  skipped ${r.skipped.length}: ${r.skipped.slice(0, 5).join("; ")}` : "";
      const cols = r.columns ? `  columns: ${Object.entries(r.columns).map(([c, n]) => `${c} ${n}`).join(", ")}` : "";
      delete r.skipped; delete r.columns;
      console.log(`  ${t.padEnd(24)} ${JSON.stringify(r)}${skipped}${cols}`);
    }
    if (!apply) throw new DryRun();
  });
  console.log(apply ? "\n  applied\n" : "");
} catch (e) {
  if (!(e instanceof DryRun)) { console.error(`\n  failed, nothing written: ${e.message}\n`); process.exitCode = 1; }
  else console.log("\n  dry run: rolled back\n");
}
await src.end(); await dst.end();

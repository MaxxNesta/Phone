// Variant codes (migration 0146): numbered under a model code, or typed by hand.
//
//   ALLOW_DESTRUCTIVE_TESTS=1 ./node_modules/.bin/tsx scripts/test-variant-codes.mjs
//
// What this proves:
//   - a composed code is still the category code, a hyphen, the piece
//   - a code marked manual is kept exactly as typed (upper-cased): IPC010
//   - the next number under a model code is one past the highest in use,
//     ignoring codes that only start with the prefix (IPC010A, IPCX01)
//   - a code typed twice is refused by the database
//   - renaming a composed variant to the shop's own code works and survives
//     a change of category

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

import { takeTestLock, releaseTestLock } from "./test-lock.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.DATABASE_URL && existsSync(join(root, ".env"))) {
  for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
    if (m) { process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, ""); break; }
  }
}
const url = process.env.DATABASE_URL;
const sql = postgres(url, { ssl: url.includes("localhost") ? false : "require",
  prepare: !url.includes("-pooler."), onnotice: () => {}, max: 1 });

await takeTestLock(sql, "test-variant-codes.mjs");
const { firstFreeNumber, modelItemCode } = await import("../lib/item-code.ts");

let bad = 0;
const check = (label, ok, detail = "") => {
  if (!ok) bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};
const clean = async (co) => {
  await sql`delete from item where company_id = ${co} and (code like 'ZQ%' or serial like 'ZQ%')`;
  await sql`delete from item_group where company_id = ${co} and segment in ('ZQ', 'ZR')`;
};

let co;
try {
  [co] = await sql`select id, name from company order by created_at limit 1`;
  if (!/\bDEV\b/i.test(String(co.name)) || process.env.ALLOW_DESTRUCTIVE_TESTS !== "1") {
    throw new Error(`"${co.name}" must be a DEV database and ALLOW_DESTRUCTIVE_TESTS=1 set.`);
  }
  console.log(`\n  ${co.name}\n`);
  await clean(co.id);
  const [grp] = await sql`insert into item_group (company_id, segment, name) values (${co.id}, 'ZQ', 'Code test') returning id, code`;
  const [other] = await sql`insert into item_group (company_id, segment, name) values (${co.id}, 'ZR', 'Code test 2') returning id, code`;
  const [uom] = await sql`select id from uom where company_id = ${co.id} limit 1`;
  const add = (serial, manual = false, group = grp.id) => sql`
    insert into item (company_id, item_group_id, serial, name, base_uom_id, code_is_manual)
    values (${co.id}, ${group}, ${serial}, ${"Code test " + serial}, ${uom.id}, ${manual})
    returning id, code`.then((r) => r[0]);

  const composed = await add("001");
  check("a composed code is category, hyphen, piece", composed.code === `${grp.code}-001`, composed.code);

  const typed = await add("zq010", true);
  check("a manual code is kept as typed, upper-cased", typed.code === "ZQ010", typed.code);
  await add("ZQ007", true);
  await add("ZQ010A", true);
  await add("ZQX01", true);
  const nextZq = await firstFreeNumber(sql, co.id, "ZQ");
  check("next under ZQ is one past the highest number", nextZq === 11, String(nextZq));
  check("  and it is written with three digits", modelItemCode("ZQ", 11) === "ZQ011");
  check("a prefix nobody uses starts at 1", (await firstFreeNumber(sql, co.id, "ZQNEW")) === 1);

  let refused = null;
  try { await add("ZQ010", true); } catch (e) { refused = String(e.message); }
  check("the same code twice is refused", /duplicate|unique/i.test(refused ?? ""), refused ?? "allowed");

  await sql`update item set serial = 'ZQ050', code_is_manual = true where id = ${composed.id}`;
  const [renamed] = await sql`select code from item where id = ${composed.id}`;
  check("a composed variant renamed to the shop's code", renamed.code === "ZQ050", renamed.code);
  await sql`update item set item_group_id = ${other.id} where id = ${composed.id}`;
  const [moved] = await sql`select code from item where id = ${composed.id}`;
  check("  keeps it when moved to another category", moved.code === "ZQ050", moved.code);
} catch (err) {
  bad++;
  console.error("\n  ERROR", err);
} finally {
  if (co) await clean(co.id).catch(() => {});
  await releaseTestLock(sql);
  await sql.end();
  console.log(bad ? `\n  ${bad} FAILED\n` : "\n  all passed\n");
  process.exit(bad ? 1 : 0);
}

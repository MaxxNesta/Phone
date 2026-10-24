// The shop's Apple Watch list, as master data: products, Size and Colour
// values, and every variant with the code and name the shop already uses.
// Prices and stock are not here — they go on price levels and receipts.
//
//   node scripts/import-iwatch.mjs            show what would be created
//   node scripts/import-iwatch.mjs --apply    create it
//
// Idempotent: a variant whose code exists is left alone, a value that exists
// is reused (42MM finds 42mm). 42 beside 42MM is the same physical size, kept
// as its own variant on purpose (the shop's history), acknowledged as such.
// Tracking: Optional serial.

import { readFileSync, existsSync } from "node:fs";
import postgres from "postgres";

let url = process.env.DATABASE_URL;
if (!url && existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
    if (m) { url = m[1].replace(/^["']|["']$/g, ""); break; }
  }
}
const apply = process.argv.includes("--apply");
const sql = postgres(url, { ssl: "require", prepare: false, max: 1, onnotice: () => {} });

// Code, name exactly as the shop has it.
const LIST = [
  ["IW001", "iWatch Series 11 - 42MM - Black"],
  ["IW002", "iWatch Series 11 - 42MM - Silver"],
  ["IW003", "iWatch Series 11 - 42MM - Gold"],
  ["IW004", "iWatch Series 11 - 46MM - Black"],
  ["IW005", "iWatch Series 11 - 46MM - Silver"],
  ["IW006", "iWatch Series 11 - 46MM - Gold"],
  ["IW007", "iWatch Series 11 - 42 - black"],
  ["IW008", "iWatch Series 11 - 42 - Silver"],
  ["IW009", "IWatch Series 11 - 42 - Gold"],
  ["IW010", "IWatch Series 11 - 46 - black"],
  ["IW011", "iWatch Series 11 - 46 - Silver"],
  ["IW012", "iWatch Series 11 - 46 - Gold"],
  ["IW013", "iWatch Series 10 - 46MM - gold"],
  ["IW014", "iWatch Series 11 - 46MM - Space Gray"],
  ["IW015", "iWatch Series 11 - 42MM - Space Gray"],
];

const parse = (name) => {
  const [model, size, colour] = name.split(/\s+-\s+/).map((s) => s.trim());
  return { model: model.replace(/^iwatch/i, "iWatch"), size, colour };
};

try {
  const [co] = await sql`select id, name from company order by created_at limit 1`;
  console.log(`\n  ${co.name}${apply ? "" : "  (dry run — add --apply to create)"}\n`);

  const [grp] = await sql`select id, name from item_group where company_id = ${co.id} and parent_id is null
                           and (code = 'AW' or lower(name) = 'apple watch') order by (code = 'AW') desc limit 1`;
  if (!grp) throw new Error("No Apple Watch category.");
  const [brand] = await sql`select id from brand where company_id = ${co.id} and (code = 'APPLE' or lower(name) = 'apple') limit 1`;
  const [uom] = await sql`select id, code from uom where company_id = ${co.id} and is_active
                           order by (code = 'PCS') desc, (code = 'EA') desc, code limit 1`;
  const [owner] = await sql`select id from app_user where company_id = ${co.id} and role = 'ADMIN' and is_active order by created_at limit 1`;
  const attr = async (re) => (await sql`select id, name from variant_attribute where company_id = ${co.id} and is_active
                                          and (name ~* ${re} or code ~* ${re}) order by sort_order limit 1`)[0];
  const size = await attr("^size$");
  const colour = await attr("^colou?r$");
  if (!size || !colour) throw new Error("Size and Colour attributes are needed.");
  console.log(`  category ${grp.name} · unit ${uom.code} · Size + ${colour.name}\n`);

  // A value by what it is called, case aside: 42MM finds 42mm, Black finds black.
  const options = new Map();
  const option = async (a, name) => {
    const key = `${a.id}|${name.toLowerCase()}`;
    if (options.has(key)) return options.get(key);
    let [o] = await sql`select id, name, physical_value from variant_option
                         where attribute_id = ${a.id} and lower(name) = ${name.toLowerCase()} and is_active`;
    if (!o) {
      const display = a === colour ? name.replace(/\b\w/g, (c) => c.toUpperCase()) : name;
      console.log(`  + value ${a.name}: ${display}`);
      if (apply) {
        // The code is the name squeezed, made unique: 42 is taken by 42mm's code, so 42-2.
        const base = display.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "V";
        const taken = new Set((await sql`select code from variant_option where attribute_id = ${a.id}`).map((r) => r.code));
        let code = base;
        for (let n = 2; taken.has(code); n++) code = `${base}-${n}`;
        [o] = await sql`insert into variant_option (company_id, attribute_id, code, name, sort_order)
          values (${co.id}, ${a.id}, ${code}, ${display},
                  coalesce((select max(sort_order) + 1 from variant_option where attribute_id = ${a.id}), 0))
          returning id, name, physical_value`;
      } else {
        // Worked out as the trigger would on insert, so the dry run pairs twins the same way.
        const [{ v }] = await sql`select fn_variant_physical(${a.id}, ${display}) as v`;
        o = { id: `new:${key}`, name: display, physical_value: v };
      }
    }
    options.set(key, o);
    return o;
  };

  const rows = [];
  for (const [code, name] of LIST) {
    const p = parse(name);
    rows.push({ code, name, model: p.model, size: await option(size, p.size), colour: await option(colour, p.colour) });
  }

  const byModel = Map.groupBy ? Map.groupBy(rows, (r) => r.model)
    : rows.reduce((m, r) => m.set(r.model, [...(m.get(r.model) ?? []), r]), new Map());
  let made = 0, skipped = 0;
  for (const [model, list] of byModel) {
    const productCode = "IW-" + model.replace(/^iWatch\s+/i, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    let [parent] = await sql`select id from item where company_id = ${co.id} and code = ${productCode}`;
    console.log(`\n  ${model}  (${productCode})${parent ? " — exists" : ""}`);
    if (!parent && apply) {
      [parent] = await sql`insert into item (company_id, item_group_id, brand_id, serial, code_is_manual, name,
                             base_uom_id, is_stocked, identity)
        values (${co.id}, ${grp.id}, ${brand?.id ?? null}, ${productCode}, true, ${model}, ${uom.id}, true, 'OPTIONAL')
        returning id`;
      await sql`insert into item_variant_attribute ${sql([
        { item_id: parent.id, attribute_id: size.id, sort_order: 0 },
        { item_id: parent.id, attribute_id: colour.id, sort_order: 1 }])}`;
    }
    // Which of these is the same physical thing as one before it.
    const seen = new Map();
    for (const r of list) {
      const key = `${r.size.physical_value}|${r.colour.physical_value}`;
      const twinOf = seen.get(key);
      if (!twinOf) seen.set(key, r.code);
      const [exists] = await sql`select name from item where company_id = ${co.id} and code = ${r.code}`;
      if (exists) { skipped++; console.log(`    = ${r.code}  already there: ${exists.name}`); continue; }
      console.log(`    + ${r.code}  ${r.name}${twinOf ? `   (same configuration as ${twinOf}, kept separate)` : ""}`);
      if (!apply) continue;
      const [v] = await sql`insert into item (company_id, item_group_id, brand_id, parent_item_id, serial, code_is_manual,
                              name, name_is_custom, base_uom_id, is_stocked, identity, valuation_method,
                              duplicate_ack_by, duplicate_ack_at)
        values (${co.id}, ${grp.id}, ${brand?.id ?? null}, ${parent.id}, ${r.code}, true, ${r.name}, true, ${uom.id}, true,
                'OPTIONAL', 'FIFO', ${twinOf ? owner?.id ?? null : null}, ${twinOf ? new Date() : null})
        returning id`;
      await sql`insert into item_variant_option ${sql([{ item_id: v.id, option_id: r.size.id }, { item_id: v.id, option_id: r.colour.id }])}`;
      made++;
    }
  }
  console.log(`\n  ${apply ? "created" : "would create"} ${apply ? made : rows.length - skipped} variants, ${skipped} already there\n`);
} catch (e) {
  console.error("\n  error:", e.message, "\n");
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

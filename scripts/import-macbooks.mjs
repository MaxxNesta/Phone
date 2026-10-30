// The shop's MacBook list, as master data: products, Size / Chip / Memory /
// Storage / Region / Colour values, and every variant with the code and name
// the shop already uses. Prices and stock are not here — they go on price
// levels and receipts.
//
//   node scripts/import-macbooks.mjs            show what would be created
//   node scripts/import-macbooks.mjs --apply    create it
//
// Idempotent: a variant whose code exists is left alone; a value that exists
// is reused. "(16/512)" is memory / storage. A value the name doesn't give
// (no size on the M5 Air, no region on most) is simply left off the variant.
// Tracking: serial number.

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
  ["IPB001", "MacBook Air M5 (16/512) Sky Blue"],
  ["IPB002", "MacBook Air M5 (16/512) Silver"],
  ["IPB003", "MacBook Air M5(16/512) Star Light"],
  ["IPB004", "MacBook Air M5 (16/512) Mid Night"],
  ["IPM001", "MacBook Air 13\" (16/256) M4 chip ZP/A-sky blue"],
  ["IPM002", "MacBook Air 13\" (16/256) M4 chip ZP/A-star light"],
  ["IPM003", "MacBook Air 13\" (16/256) M4 chip ZP/A-midnight"],
  ["IPM004", "MacBook Air 13\" (16/256) M4 chip LL/A-sky blue"],
  ["IPM005", "MacBook Neo (8/256) Indigo Blue"],
  ["IPM006", "MacBook Neo (8/256) Silver"],
  ["IPM007", "MacBook Neo (8/512) Silver"],
  ["IPM008", "MacBook Neo (8/512) Indigo Blue"],
  ["IPM009", "MacBook Neo (8/256) Blush(Pink)"],
  ["IPM010", "MacBook Neo (8/512) Yellow"],
  ["IPM011", "MacBook Neo (8/256) Yellow"],
  ["IPM012", "MacBook Neo (8/256) Pink"],
  ["IPM013", "MacBook Neo (8/512) Pink"],
];

// The shop's spellings that mean one colour.
const COLOUR = { "star light": "Starlight", "mid night": "Midnight", "blush(pink)": "Blush" };
const title = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** 'MacBook Air 13" (16/256) M4 chip ZP/A-sky blue' → model and its values. */
const parse = (name) => {
  const m = name.match(/^(.*?)\s*\((\d+)\s*\/\s*(\d+)\s*(GB|TB)?\)\s*(.*)$/i);
  if (!m) throw new Error(`Cannot read "${name}"`);
  let head = m[1], rest = m[5];
  const chip = (head + " " + rest).match(/\b(M\d+(?:\s+(?:Pro|Max))?)\b/)?.[1] ?? null;
  head = head.replace(/\bM\d+\b/, "");
  rest = rest.replace(/\bM\d+(\s+chip)?\b/i, "");
  const size = head.match(/(\d+)\s*(?:"|-?inch)/i)?.[1] ?? null;
  const model = head.replace(/(\d+)\s*(?:"|-?inch)/i, "").replace(/\s+/g, " ").trim();
  const region = rest.match(/\b([A-Z]{1,2}\/A)\b/)?.[1] ?? null;
  const c = rest.replace(/\b[A-Z]{1,2}\/A\b/, "").replace(/^[\s-]+|[\s-]+$/g, "").trim();
  return { model, chip, size: size && `${size}-inch`, memory: `${m[2]} GB`,
           storage: m[3] === "1" || m[3] === "2" ? `${m[3]} TB` : `${m[3]} GB`, region,
           colour: COLOUR[c.toLowerCase()] ?? title(c) };
};

try {
  const [co] = await sql`select id, name from company order by created_at limit 1`;
  console.log(`\n  ${co.name}${apply ? "" : "  (dry run — add --apply to create)"}\n`);

  const [grp] = await sql`select id, name from item_group where company_id = ${co.id} and parent_id is null
                           and (code = 'MAC' or lower(name) = 'macbook') order by (code = 'MAC') desc limit 1`;
  if (!grp) throw new Error("No MacBook category.");
  const [brand] = await sql`select id from brand where company_id = ${co.id} and (code = 'APPLE' or lower(name) = 'apple') limit 1`;
  const [uom] = await sql`select id, code from uom where company_id = ${co.id} and is_active
                           order by (code = 'PCS') desc, (code = 'EA') desc, code limit 1`;
  const byCode = async (code) => (await sql`select id, name from variant_attribute where company_id = ${co.id} and code = ${code}`)[0];
  const A = { size: await byCode("SIZE"), chip: await byCode("CHIP"), memory: await byCode("MEM"),
              storage: await byCode("STO"), region: await byCode("REG"), colour: await byCode("COL") };
  for (const [k, a] of Object.entries(A)) if (!a) throw new Error(`No ${k} attribute.`);
  console.log(`  category ${grp.name} · unit ${uom.code}\n`);

  // A value found by what it physically is: 16 GB, 13-inch, ZP/A, Sky Blue.
  const options = new Map();
  const option = async (a, value) => {
    if (!value) return null;
    const key = `${a.id}|${value.toLowerCase()}`;
    if (options.has(key)) return options.get(key);
    let [o] = await sql`select id, name, physical_value from variant_option
                         where attribute_id = ${a.id} and is_active
                           and (lower(name) = ${value.toLowerCase()} or physical_value = fn_variant_physical(${a.id}, ${value}))
                         order by (lower(name) = ${value.toLowerCase()}) desc limit 1`;
    if (!o) {
      console.log(`  + value ${a.name}: ${value}`);
      if (apply) {
        const base = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "V";
        const taken = new Set((await sql`select code from variant_option where attribute_id = ${a.id}`).map((r) => r.code));
        let code = base;
        for (let n = 2; taken.has(code); n++) code = `${base}-${n}`;
        [o] = await sql`insert into variant_option (company_id, attribute_id, code, name, sort_order)
          values (${co.id}, ${a.id}, ${code}, ${value},
                  coalesce((select max(sort_order) + 1 from variant_option where attribute_id = ${a.id}), 0))
          returning id, name, physical_value`;
      } else {
        const [{ v }] = await sql`select fn_variant_physical(${a.id}, ${value}) as v`;
        o = { id: `new:${key}`, name: value, physical_value: v };
      }
    }
    options.set(key, o);
    return o;
  };

  const rows = [];
  for (const [code, name] of LIST) {
    const p = parse(name);
    const values = {};
    for (const k of Object.keys(A)) values[k] = await option(A[k], p[k]);
    rows.push({ code, name, model: p.model, values });
  }

  const byModel = new Map();
  for (const r of rows) byModel.set(r.model, [...(byModel.get(r.model) ?? []), r]);
  let made = 0, skipped = 0;
  for (const [model, list] of byModel) {
    const productCode = "MAC-" + model.replace(/^MacBook\s*/i, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    // The attributes this model's variants actually use, in the usual order.
    const used = Object.keys(A).filter((k) => list.some((r) => r.values[k]));
    let [parent] = await sql`select id, name from item where company_id = ${co.id} and code = ${productCode}`;
    if (parent && parent.name !== model) throw new Error(`${productCode} is already "${parent.name}", not "${model}".`);
    console.log(`\n  ${model}  (${productCode}) · ${used.map((k) => A[k].name).join(" + ")}${parent ? " — exists" : ""}`);
    if (!parent && apply) {
      [parent] = await sql`insert into item (company_id, item_group_id, brand_id, serial, code_is_manual, name,
                             base_uom_id, is_stocked, identity)
        values (${co.id}, ${grp.id}, ${brand?.id ?? null}, ${productCode}, true, ${model}, ${uom.id}, true, 'SERIAL')
        returning id`;
      await sql`insert into item_variant_attribute ${sql(used.map((k, i) => ({ item_id: parent.id, attribute_id: A[k].id, sort_order: i })))}`;
    }
    const seen = new Map();
    for (const r of list) {
      const key = used.map((k) => r.values[k]?.physical_value ?? "").join("|");
      if (seen.has(key)) throw new Error(`${r.code} is the same configuration as ${seen.get(key)}.`);
      seen.set(key, r.code);
      const [exists] = await sql`select name from item where company_id = ${co.id} and code = ${r.code}`;
      if (exists) { skipped++; console.log(`    = ${r.code}  already there: ${exists.name}`); continue; }
      console.log(`    + ${r.code}  ${r.name}   [${used.map((k) => r.values[k]?.name).filter(Boolean).join(" · ")}]`);
      if (!apply) continue;
      const [v] = await sql`insert into item (company_id, item_group_id, brand_id, parent_item_id, serial, code_is_manual,
                              name, name_is_custom, base_uom_id, is_stocked, identity, valuation_method)
        values (${co.id}, ${grp.id}, ${brand?.id ?? null}, ${parent.id}, ${r.code}, true, ${r.name}, true, ${uom.id}, true,
                'SERIAL', 'FIFO')
        returning id`;
      await sql`insert into item_variant_option ${sql(used.filter((k) => r.values[k]).map((k) => ({ item_id: v.id, option_id: r.values[k].id })))}`;
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

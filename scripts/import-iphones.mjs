// The shop's iPhone list, as master data: models, Storage / Region / Color
// values, and every variant with the code and name the shop already uses.
// Prices and stock are not here — they go on price levels and receipts.
//
//   node scripts/import-iphones.mjs            show what would be created
//   node scripts/import-iphones.mjs --apply    create it
//
// Idempotent: a variant whose code exists is left alone; a value that exists
// is reused (a bare "256" is the storage 256 GB already on the list, found by
// what it physically is). Tracking: IMEI.

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
  ["IPA126", "IPhone Air (256) CH/A -Gold"],
  ["IPA127", "IPhone Air (256) CH/A -White"],
  ["IPA128", "iPhone Air (256) CH/A -Black"],
  ["IPA129", "IPhone Air (256) CH/A -Blue"],
  ["IPC001", "IPhone 15 (128GB) CH/A - Pink"],
  ["IPC002", "IPhone 15 (128GB) CH/A - Blue"],
  ["IPC003", "IPhone 15 (128GB) CH/A - Black"],
  ["IPC004", "IPhone 16 (128GB) CH/A - Green"],
  ["IPC005", "IPhone 16 (128GB) CH/A - Pink"],
  ["IPC006", "IPhone 16 Pro (128GB) CH/A - Black"],
  ["IPC007", "IPhone 16 PRO(128GB) CH/A - Silver/White"],
  ["IPC008", "IPhone 16 Pro (128GB) CH/A - Desert Titanium"],
  ["IPC009", "IPhone 16 Pro (128GB) CH/A - Natural Titanium"],
  ["IPC010", "IPhone 17 (256GB) CH/A - Black"],
  ["IPC011", "IPhone 17 (256GB) CH/A - White/Silver"],
  ["IPC012", "IPhone 17 (256GB) CH/A - Blue"],
  ["IPC013", "IPhone 17 (256GB) CH/A - Lavender"],
  ["IPC014", "IPhone 17 (256GB) CH/A - Green"],
  ["IPC016", "IPhone 17 Pro (256GB) CH/A - Silver"],
  ["IPC017", "IPhone 17 Pro (256GB) CH/A - Orange"],
  ["IPC018", "IPhone 17 Pro Max (256GB) CH/A - White/Silver"],
  ["IPC019", "IPhone 17 Pro Max (256GB) CH/A - Orange"],
  ["IPC020", "IPhone 17 Pro (512GB) CH/A - Silver"],
  ["IPC021", "IPhone 17 Pro (512GB) CH/A - Orange"],
  ["IPC022", "IPhone 17 Pro Max (512GB) CH/A - Silver"],
  ["IPC023", "IPhone 16 (128GB) CH/A - Blue"],
  ["IPC024", "IPhone 16 (128GB) CH/A - Black"],
  ["IPC025", "IPhone 16 (128GB) CH/A - White"],
  ["IPC026", "IPhone 17 Pro Max (512GB) CH/A - Orange"],
  ["IPC027", "IPhone 17 Pro Max (1TB) CH/A - Silver"],
  ["IPC028", "IPhone 17 Pro Max (1TB) CH/A - Orange"],
  ["IPC029", "IPhone 16 Plus (128GB) CH/A - Blue"],
  ["IPC030", "IPhone 16 Plus (128GB) CH/A - White"],
  ["IPC031", "IPhone 16 Plus (128GB) CH/A - Green"],
  ["IPC032", "IPhone 17 Pro Max (256GB) CH/A - blue"],
  ["IPC033", "IPhone 17 Pro Max (512GB) CH/A - blue"],
  ["IPC034", "IPhone 16 Pro Max (256GB) CH/A - black"],
  ["IPC035", "IPhone 16 Pro Max (256GB) CH/A - desert"],
  ["IPC036", "IPhone 16 Pro Max (256GB) CH/A - natural"],
  ["IPC037", "IPhone 16 Pro Max (256GB) CH/A - white"],
  ["IPC038", "IPhone 16 Pro (128GB) CH/A - White"],
  ["IPC039", "IPhone 17 Air (256GB) CH/A - Blue"],
  ["IPC040", "IPhone 17 Air (256GB) CH/A - Gold"],
  ["IPC041", "IPhone 17 Air (256GB) CH/A - White"],
  ["IPC042", "IPhone 17 Air (256GB) CH/A - Black"],
  ["IPC043", "IPhone 14 (128GB) CH/A - Black"],
  ["IPC044", "iPhone 16 plus (128GB) CH/A pink"],
  ["IPC045", "IPhone 16 Plus (128GB) CH/A black"],
  ["IPC046", "iPhone 16 Plus (256GB) CH/A green"],
  ["IPC047", "iPhone 13 (128GB) CH/A black"],
  ["IPC111", "IPhone 17 Pro Max (512GB)  CH/A Orange ( Activated)"],
  ["IPC112", "IPhone 17 (256GB) CH/A Lanvander ( Activated)"],
  ["IPC113", "IPhone 17 Pro Max (512GB) CH/A Silver ( Activated)"],
  ["IPC114", "IPhone 17 Pro Max (256GB) CH/A Silver (Activated)"],
  ["IPC115", "IPhone 17 Pro Max (256GB) CH/A Blue (Activated)"],
  ["IPC116", "IPhone 17 pro max (256GB) CH/A Orange (activated)"],
  ["IPC117", "iPhone 17 (256GB) CH/A Activate White"],
  ["IPC118", "iPhone 17 (256GB) CH/A Activate Black"],
  ["IPC119", "iPhone 17 Pro (256GB) CH/A Actiivate Silver"],
  ["IPC120", "IPhone 16 (128GB) CH/A Blue (Activated)"],
  ["IPC121", "IPhone 16 (128GB) CH/A Green (Activated)"],
  ["IPC122", "IPhone 16 (128GB) CH/A White (Activated)"],
  ["IPC123", "IPhone 16 (128GB) CH/A Pink (Activated)"],
  ["IPC124", "IPhone 16 (128GB) CH/A Black (Activated)"],
  ["IPC125", "iPhone 17 Pro (256GB) CH/A Orange ( Activated)"],
  ["IPC126", "IPhone 18 Pro (256GB) CH/A - Black"],
  ["IPC127", "IPhone 18 Pro (256GB) CH/A - White"],
  ["IPC128", "IPhone 18 Pro(256GB) CH/A - Burgundey"],
  ["IPC129", "IPhone 18 Pro (512GB) CH/A - Black"],
  ["IPC130", "IPhone 18 Pro (512GB) CH/A - White"],
  ["IPC131", "Iphone 18 Pro (512GB) CH/A - Burgundy"],
  ["IPC132", "IPhone 18 Pro (1TB) CH/A - Burgundy"],
  ["IPC133", "IPhone 18 Pro Max (256GB) CH/A - Black"],
  ["IPC134", "IPhone 18 Pro Max (256GB) CH/A - White"],
  ["IPC135", "IPhone 18 Pro Max (256GB) CH/A - Burgundy"],
  ["IPC136", "IPhone 18 Pro Max (512GB) CH/A - Black"],
  ["IPC137", "IPhone 18 Pro Max (512GB) CH/A - White"],
  ["IPC138", "IPhone 18 Pro Max (512GB) CH/A - Glacier"],
  ["IPC139", "IPhone 18 Pro Max (512GB) CH/A - Burgundy"],
  ["IPC140", "IPhone 18 Pro Max (1TB) CH/A - Black"],
  ["IPC141", "IPhone 18 Pro Max (1TB) CH/A - White"],
  ["IPC142", "IPhone 18 Pro Max (1TB) CH/A - Glacier"],
  ["IPC143", "IPhone 18 Pro Max (1TB) CH/A - Burgundy"],
  ["IPC144", "IPhone 18 Pro Max (512GB) CH/A - Burgundy (Activated)"],
  ["IPC145", "IPhone 18 Pro Max (256GB) CH/A - Burgundy (Activated)"],
  ["IPC146", "IPhone 18 Pro Max (256GB) CH/A - Glacier"],
  ["IPC147", "IPhone 18 Pro Max (1TB) ZA/A - Burgundy"],
  ["IPC148", "IPhone 18 Pro Max (512) ZA/A - Burgundy"],
  ["IPC149", "IPhone 18 Pro Max (256) ZA/A - Burgundy"],
  ["IPC47", "IPhone 16 e (128) CH/A Black"],
  ["IPC48", "IPhone 16 e (128) CH/A White"],
  ["IPL001", "iPhone 17 Air (256GB) LL/A - blue"],
  ["IPQ001", "IPhone 17 Pro (256GB) QN/A - Silver"],
  ["IPX001", "IPhone 17 Pro Max (256GB) X/A - Silver"],
  ["IPZ001", "IPhone 17 (256GB) ZA/A - Silver/White"],
  ["IPZ002", "IPhone 17 (256GB) ZA/A - Green"],
  ["IPZ003", "IPhone 17 (256GB) ZA/A - Black"],
  ["IPZ004", "IPhone 17 Pro (256GB) ZA/A - Silver"],
  ["IPZ005", "IPhone 17 Pro (256GB) ZA/A - Orange"],
  ["IPZ006", "IPhone 17 Pro Max (256GB) ZA/A - Orange"],
  ["IPZ007", "IPhone 17 Pro Max (256GB) ZA/A - Silver"],
  ["IPZ008", "IPhone 17 Pro Max (512GB) ZA/A - Orange"],
  ["IPZ009", "IPhone 17 Pro Max (512GB) ZA/A - Silver"],
  ["IPZ010", "IPhone 17 Pro Max (256GB) ZA/A - Blue"],
  ["IPZ011", "IPhone 17 Pro Max (256GB) ZP/A - Orange"],
];

// The shop's spellings that mean a colour already on the list.
const COLOUR = { "lanvander": "Lavender", "burgundey": "Burgundy", "white/silver": "Silver/White" };

/** "IPhone 16 PRO(128GB) CH/A - Silver/White" → model, storage, region, colour, activated. */
const parse = (name) => {
  // "(Activated)", "Activate", "Actiivate" anywhere in the name: the Activated value.
  const act = /\(?\s*\bacti+vated?\b\s*\)?/i;
  const activated = act.test(name);
  // The dash before the colour is optional: "CH/A pink" reads like "CH/A - Pink".
  const m = name.replace(act, " ").match(/^(.*?)\s*\(([^)]+)\)\s*(\S+)\s*(?:-\s*)?(.+?)\s*$/);
  if (!m) throw new Error(`Cannot read "${name}"`);
  const model = m[1].trim().replace(/^iphone/i, "iPhone").replace(/(\d)\s+e$/i, "$1e")
    .replace(/\b(pro|max|plus|air)\b/gi, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  const colour = m[4].trim();
  return { model, storage: m[2].trim(), region: m[3].trim(), colour: COLOUR[colour.toLowerCase()] ?? colour, activated };
};

try {
  const [co] = await sql`select id, name from company order by created_at limit 1`;
  console.log(`\n  ${co.name}${apply ? "" : "  (dry run — add --apply to create)"}\n`);

  const [grp] = await sql`select id, name from item_group where company_id = ${co.id} and parent_id is null
                           and (code = 'IPH' or lower(name) = 'iphone') order by (code = 'IPH') desc limit 1`;
  if (!grp) throw new Error("No iPhone category.");
  const [brand] = await sql`select id from brand where company_id = ${co.id} and (code = 'APPLE' or lower(name) = 'apple') limit 1`;
  const [uom] = await sql`select id, code from uom where company_id = ${co.id} and is_active
                           order by (code = 'PCS') desc, (code = 'EA') desc, code limit 1`;
  const [owner] = await sql`select id from app_user where company_id = ${co.id} and role = 'ADMIN' and is_active order by created_at limit 1`;
  const attr = async (re) => (await sql`select id, name from variant_attribute where company_id = ${co.id} and is_active
                                          and (name ~* ${re} or code ~* ${re}) order by sort_order limit 1`)[0];
  const storage = await attr("^(storage|capacity|sto)$");
  const region = await attr("^(region|reg)$");
  const colour = await attr("^(colou?r|col)$");
  if (!storage || !region || !colour) throw new Error("Storage, Region and Color attributes are needed.");
  // Activated or standard (0153): every model declares it; a variant is Activated when its name says so.
  const [activation] = await sql`select id from variant_attribute where company_id = ${co.id} and code = 'ACT'`;
  const [activatedOption] = activation
    ? await sql`select id from variant_option where attribute_id = ${activation.id} and code = 'ACTIVATED'` : [];
  if (LIST.some(([, n]) => parse(n).activated) && !activatedOption) throw new Error("No Activated value to give activated phones.");
  console.log(`  category ${grp.name} · unit ${uom.code} · ${storage.name} + ${region.name} + ${colour.name}\n`);

  const options = new Map();
  const created = [];
  const option = async (a, value) => {
    const key = `${a.id}|${value.toLowerCase()}`;
    if (options.has(key)) return options.get(key);
    let o;
    if (a === storage) {
      // Found by what it physically is: 256 and 256 GB are one storage.
      [o] = await sql`select id, name, physical_value from variant_option
                       where attribute_id = ${a.id} and is_active
                         and physical_value = fn_variant_physical(${a.id}, ${value})`;
    } else if (a === region) {
      // CH/A finds "CH/A", and the older "CH/A – China".
      [o] = await sql`select id, name, physical_value from variant_option
                       where attribute_id = ${a.id} and is_active
                         and lower(regexp_replace(name, '\\s+[–—-]\\s+.*$', '')) = ${value.toLowerCase()}`;
    } else {
      [o] = await sql`select id, name, physical_value from variant_option
                       where attribute_id = ${a.id} and lower(name) = ${value.toLowerCase()} and is_active`;
    }
    if (!o) {
      console.log(`  + value ${a.name}: ${value}`);
      if (apply) {
        const base = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "V";
        const taken = new Set((await sql`select code from variant_option where attribute_id = ${a.id}`).map((r) => r.code));
        let code = base;
        for (let n = 2; taken.has(code); n++) code = `${base}-${n}`;
        [o] = await sql`insert into variant_option (company_id, attribute_id, code, name, sort_order)
          values (${co.id}, ${a.id}, ${code}, ${a === storage ? value.replace(/(\d)\s*(GB|TB)$/i, "$1 $2") : value.replace(/\b\w/g, (c) => c.toUpperCase())},
                  coalesce((select max(sort_order) + 1 from variant_option where attribute_id = ${a.id}), 0))
          returning id, name, physical_value`;
      } else {
        const [{ v }] = await sql`select fn_variant_physical(${a.id}, ${value}) as v`;
        o = { id: `new:${key}`, name: value, physical_value: v };
      }
      created.push(value);
    } else if (value.toLowerCase() !== o.name.toLowerCase()) {
      console.log(`  = ${a.name}: "${value}" is the existing "${o.name}"`);
    }
    options.set(key, o);
    return o;
  };

  const rows = [];
  for (const [code, name] of LIST) {
    const p = parse(name);
    rows.push({ code, name, model: p.model, activated: p.activated, storage: await option(storage, p.storage),
                region: await option(region, p.region), colour: await option(colour, p.colour) });
  }

  const byModel = new Map();
  for (const r of rows) byModel.set(r.model, [...(byModel.get(r.model) ?? []), r]);
  let made = 0, skipped = 0;
  for (const [model, list] of byModel) {
    const productCode = "IPH-" + model.replace(/^iPhone\s*/i, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    let [parent] = await sql`select id, name from item where company_id = ${co.id} and code = ${productCode}`;
    if (parent && parent.name !== model) throw new Error(`${productCode} is already "${parent.name}", not "${model}".`);
    console.log(`\n  ${model}  (${productCode})${parent ? " — exists" : ""}`);
    if (!parent && apply) {
      [parent] = await sql`insert into item (company_id, item_group_id, brand_id, serial, code_is_manual, name,
                             base_uom_id, is_stocked, identity)
        values (${co.id}, ${grp.id}, ${brand?.id ?? null}, ${productCode}, true, ${model}, ${uom.id}, true, 'IMEI')
        returning id`;
      await sql`insert into item_variant_attribute ${sql([
        { item_id: parent.id, attribute_id: storage.id, sort_order: 0 },
        { item_id: parent.id, attribute_id: region.id, sort_order: 1 },
        { item_id: parent.id, attribute_id: colour.id, sort_order: 2 }])}`;
    }
    // An existing model gains the Activated setting too; its variants stay standard (Off).
    if (parent && activation) {
      const [has] = await sql`select 1 as y from item_variant_attribute where item_id = ${parent.id} and attribute_id = ${activation.id}`;
      if (!has) {
        console.log(`    · Activated setting added, every variant Off (standard)`);
        if (apply) await sql`insert into item_variant_attribute (item_id, attribute_id, sort_order)
          values (${parent.id}, ${activation.id}, coalesce((select max(sort_order) + 1 from item_variant_attribute where item_id = ${parent.id}), 0))`;
      }
    }
    const seen = new Map();
    for (const r of list) {
      const key = `${r.storage.physical_value}|${r.region.physical_value}|${r.colour.physical_value}|${r.activated}`;
      const twinOf = seen.get(key);
      if (!twinOf) seen.set(key, r.code);
      const [exists] = await sql`select name from item where company_id = ${co.id} and code = ${r.code}`;
      if (exists) { skipped++; console.log(`    = ${r.code}  already there: ${exists.name}`); continue; }
      console.log(`    + ${r.code}  ${r.name}${r.activated ? "   [Activated]" : ""}${twinOf ? `   (same configuration as ${twinOf}, kept separate)` : ""}`);
      if (!apply) continue;
      const [v] = await sql`insert into item (company_id, item_group_id, brand_id, parent_item_id, serial, code_is_manual,
                              name, name_is_custom, base_uom_id, is_stocked, identity, valuation_method,
                              duplicate_ack_by, duplicate_ack_at)
        values (${co.id}, ${grp.id}, ${brand?.id ?? null}, ${parent.id}, ${r.code}, true, ${r.name}, true, ${uom.id}, true,
                'IMEI', 'FIFO', ${twinOf ? owner?.id ?? null : null}, ${twinOf ? new Date() : null})
        returning id`;
      await sql`insert into item_variant_option ${sql([
        { item_id: v.id, option_id: r.storage.id }, { item_id: v.id, option_id: r.region.id }, { item_id: v.id, option_id: r.colour.id },
        ...(r.activated ? [{ item_id: v.id, option_id: activatedOption.id }] : [])])}`;
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

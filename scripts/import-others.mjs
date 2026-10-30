// The shop's other brands, as master data: each product says its category,
// brand, tracking and values outright, since these names follow no one shape.
// Prices and stock are not here — they go on price levels and receipts.
//
//   node scripts/import-others.mjs            show what would be created
//   node scripts/import-others.mjs --apply    create it
//
// Idempotent: a variant whose code exists is left alone; a value that exists
// is reused (12 GB, 256 GB, Black).

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

// Product code, name, category, brand, tracking, attributes; then each variant:
// code, name exactly as the shop has it, and its values in attribute order.
const PRODUCTS = [
  { code: "NESTA-PAD10", name: "NESTA Pad 10", group: "TAB", brand: "NESTA", identity: "OPTIONAL", attrs: ["COL"],
    variants: [["NSTP01", "NESTA Pad 10 - Orange", ["Orange"]], ["NSTP02", "NESTA Pad 10 - Blue", ["Blue"]],
               ["NSTP03", "NESTA Pad 10 - Silver", ["Silver"]], ["NSTP04", "NESTA Pad 10 - Grey", ["Grey"]]] },
  { code: "NOTHING-4APRO", name: "Nothing 4A Pro", group: "AND", brand: "NOTHING", identity: "IMEI", attrs: ["RAM", "STO", "COL"],
    variants: [["NTG01", "Nothing 4A Pro(12/256) Silver", ["12 GB", "256 GB", "Silver"]],
               ["NTG02", "Nothing 4A Pro(12/256) Black", ["12 GB", "256 GB", "Black"]],
               ["NTG03", "Nothing 4A Pro(12/256) Pink", ["12 GB", "256 GB", "Pink"]]] },
  // A case or cover for the phone, not the phone: 45,000 K a piece.
  { code: "SAM-S25U-CASE", name: "S 25 Ultra", group: "ACC", brand: "SAMSUNG", identity: "NONE", attrs: ["COL"],
    variants: [["SPR001", "S 25 Ultra (Black)", ["Black"]], ["SPR002", "S 25 Ultra (Green)", ["Green"]],
               ["SPR003", "S 25 Ultra (Grey)", ["Grey"]]] },
  // iPads: a serial number; a Wi-Fi + Cellular one also carries an IMEI, so
  // that variant is tracked by IMEI (as the item form does it). A value the
  // name doesn't give is null and left off.
  { code: "IPAD-11GEN", name: "iPad 11 Gen", group: "IPD", brand: "APPLE", identity: "SERIAL", attrs: ["STO", "REG", "COL"],
    variants: [["IPC01", "IPad 11 Gen (128) CH/A-pink", ["128 GB", "CH/A", "Pink"]],
               ["IPC02", "IPad 11 Gen (128) CH/A-blue", ["128 GB", "CH/A", "Blue"]],
               ["IPC03", "IPad 11 Gen (128) CH/A-Silver", ["128 GB", "CH/A", "Silver"]],
               ["IPD001", "IPad 11 Gen (128GB) TH/A Blue", ["128 GB", "TH/A", "Blue"]],
               ["IPD002", "IPad 11 Gen (128GB) TH/A Pink", ["128 GB", "TH/A", "Pink"]],
               ["IPD003", "IPad 11 Gen (128GB) TH/A Black", ["128 GB", "TH/A", "Black"]],
               ["IPD004", "IPad 11 Gen (128GB) TH/A Silver", ["128 GB", "TH/A", "Silver"]],
               ["IPD008", "iPad 11 Gen (256) CH/A Blue", ["256 GB", "CH/A", "Blue"]],
               ["IPD009", "iPad 11 Gen (256) CH/A Silver", ["256 GB", "CH/A", "Silver"]],
               ["IPD010", "iPad 11 Gen (256) CH/A Pink", ["256 GB", "CH/A", "Pink"]],
               ["IPD013", "IPad 11 Gen (128)", ["128 GB", null, null]],
               ["IPD14", "IPad 11 Gen (128GB) ZP/A Silver", ["128 GB", "ZP/A", "Silver"]],
               ["IPD15", "IPad 11 Gen (128GB) ZP/A Pink", ["128 GB", "ZP/A", "Pink"]],
               ["IPP002", "IPad 11 Gen (128) LL/A Blue", ["128 GB", "LL/A", "Blue"]],
               ["IPP003", "IPad 11 Gen (128) LL/A Silver", ["128 GB", "LL/A", "Silver"]],
               ["IPP004", "IPad 11 Gen (128) LL/A Pink", ["128 GB", "LL/A", "Pink"]]] },
  // Nothing in the name to vary by: one item, no variants.
  { code: "IPD005", name: "iPad Air 7", group: "IPD", brand: "APPLE", identity: "SERIAL", attrs: [], variants: [] },
  { code: "IPAD-PRO", name: "iPad Pro", group: "IPD", brand: "APPLE", identity: "SERIAL", attrs: ["CHIP", "STO", "REG", "COL"],
    variants: [["IPD006", "iPad Pro M5 (256GB) ZP/A Black", ["M5", "256 GB", "ZP/A", "Black"]],
               ["IPD007", "iPad Pro M5 (256GB) ZP/A silver", ["M5", "256 GB", "ZP/A", "Silver"]]] },
  { code: "IPAD-AIR6", name: "iPad Air 6", group: "IPD", brand: "APPLE", identity: "SERIAL", attrs: ["SIZE", "STO", "CON"],
    variants: [["IPD011", "Air 6 13 inch (128)", ["13-inch", "128 GB", "Wi-Fi"]],
               ["IPD012", "Air 6 13 inch (128) E sim", ["13-inch", "128 GB", "Wi-Fi + Cellular"]]] },
  { code: "IPAD-AIR", name: "iPad Air", group: "IPD", brand: "APPLE", identity: "SERIAL", attrs: ["SIZE", "CHIP", "STO", "COL"],
    variants: [["IPP005", "IPad Air 11\" M4 (128) Blue", ["11-inch", "M4", "128 GB", "Blue"]],
               ["IPP006", "IPad Air 11\" M4 (128) Starlight", ["11-inch", "M4", "128 GB", "Starlight"]]] },
  // Lenovo tablets: a serial number; the 5G one (TB335ZC) carries an IMEI too.
  { code: "LTT01", name: "Lenovo K9 (4/64) Arctic Grey", group: "TAB", brand: "LENOVO", identity: "SERIAL", attrs: [], variants: [] },
  { code: "LEN-XX11", name: "Lenovo Xiaoxin 11”", group: "TAB", brand: "LENOVO", identity: "SERIAL", attrs: ["RAM", "STO", "CON", "COL"],
    variants: [["LTT04", "Lenovo Xiaoxin 11” (6/128) Luna Grey", ["6 GB", "128 GB", "Wi-Fi", "Luna Grey"]],
               ["LTT05", "Lenovo Xiaoxin 11” (6/128) Polar Blue", ["6 GB", "128 GB", "Wi-Fi", "Polar Blue"]],
               ["LTT09", "Lenovo Xiaoxin 11” (8/128) Luna Grey", ["8 GB", "128 GB", "Wi-Fi", "Luna Grey"]],
               ["LTT08", "Lenovo Xiaoxin 11” (8/128) Polar Blue", ["8 GB", "128 GB", "Wi-Fi", "Polar Blue"]],
               ["LTT10", "Lenovo Xiaoxin 11” (8/256) 5G Luna Grey", ["8 GB", "256 GB", "Wi-Fi + Cellular", "Luna Grey"]]] },
  { code: "LEN-XX121", name: "Lenovo Xiaoxin 12.1”", group: "TAB", brand: "LENOVO", identity: "SERIAL", attrs: ["RAM", "STO", "COL"],
    variants: [["LTT03", "Lenovo Xiaoxin 12.1” (8/128) Cloud Grey", ["8 GB", "128 GB", "Cloud Grey"]],
               ["LTT02", "Lenovo Xiaoxin 12.1”(8/128) Luna Gray", ["8 GB", "128 GB", "Luna Grey"]]] },
  { code: "LEN-XXPRO127", name: "Lenovo Xiaoxin Pro 12.7”", group: "TAB", brand: "LENOVO", identity: "SERIAL", attrs: ["RAM", "STO", "COL"],
    variants: [["LTT12", "Lenovo Xiaoxin Pro 12.7” (8/128) Cloud Grey", ["8 GB", "128 GB", "Cloud Grey"]],
               ["LTT11", "Lenovo Xiaoxin Pro 12.7” (8/128) Luna Grey", ["8 GB", "128 GB", "Luna Grey"]]] },
  { code: "LEN-Y900", name: "Lenovo Y900 13", group: "TAB", brand: "LENOVO", identity: "SERIAL", attrs: ["RAM", "STO", "COL"],
    variants: [["LTT07", "Lenovo Y900 13 (12/256) Black", ["12 GB", "256 GB", "Black"]],
               ["LTT06", "Lenovo Y900 13 (12/256) Glacier White", ["12 GB", "256 GB", "Glacier White"]]] },
  // Covers and screen glass: each its own product, counted, not tracked.
  ...[["LTC01", "Cover (Lenovo TB335FC 11”)"], ["LTC02", "Cover(Lenovo TB365FC 12”)"],
      ["LTC03", "Flip Cover (Lenovo 12.7” TB375FC)"], ["LTC04", "Flip Cover (Lenovo 12.1” TB365FC)"],
      ["LTC05", "Flip Cover (Lenovo 11” TB335FC)"],
      ["LTG01", "Glass (Lenovo TB335FC 11”)"], ["LTG02", "Glass (Lenovo TB365FC 12”)"]]
    .map(([code, name]) => ({ code, name, group: "ACC", brand: "LENOVO", identity: "NONE", attrs: [], variants: [] })),
];

try {
  const [co] = await sql`select id, name from company order by created_at limit 1`;
  console.log(`\n  ${co.name}${apply ? "" : "  (dry run — add --apply to create)"}\n`);
  const [uom] = await sql`select id, code from uom where company_id = ${co.id} and is_active
                           order by (code = 'PCS') desc, (code = 'EA') desc, code limit 1`;

  const one = async (q, what) => { const [r] = await q; if (!r) throw new Error(`No ${what}.`); return r; };
  const options = new Map();
  const option = async (a, value) => {
    const key = `${a.id}|${value.toLowerCase()}`;
    if (options.has(key)) return options.get(key);
    let [o] = await sql`select id, name from variant_option where attribute_id = ${a.id} and is_active
                         and (lower(name) = ${value.toLowerCase()} or physical_value = fn_variant_physical(${a.id}, ${value}))
                         order by (lower(name) = ${value.toLowerCase()}) desc limit 1`;
    if (!o) {
      console.log(`  + value ${a.name}: ${value}`);
      o = { id: `new:${key}`, name: value };
      if (apply) {
        const base = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "V";
        const taken = new Set((await sql`select code from variant_option where attribute_id = ${a.id}`).map((r) => r.code));
        let code = base;
        for (let n = 2; taken.has(code); n++) code = `${base}-${n}`;
        [o] = await sql`insert into variant_option (company_id, attribute_id, code, name, sort_order)
          values (${co.id}, ${a.id}, ${code}, ${value},
                  coalesce((select max(sort_order) + 1 from variant_option where attribute_id = ${a.id}), 0))
          returning id, name`;
      }
    }
    options.set(key, o);
    return o;
  };

  let made = 0, skipped = 0;
  for (const p of PRODUCTS) {
    const grp = await one(sql`select id, name from item_group where company_id = ${co.id} and code = ${p.group}`, `category ${p.group}`);
    const brand = await one(sql`select id from brand where company_id = ${co.id} and code = ${p.brand}`, `brand ${p.brand}`);
    const attrs = [];
    for (const c of p.attrs) attrs.push(await one(sql`select id, name from variant_attribute where company_id = ${co.id} and code = ${c}`, `attribute ${c}`));
    let [parent] = await sql`select id, name from item where company_id = ${co.id} and code = ${p.code}`;
    if (parent && parent.name !== p.name) throw new Error(`${p.code} is already "${parent.name}", not "${p.name}".`);
    console.log(`\n  ${p.name}  (${p.code}) · ${grp.name} · ${p.identity} · ${attrs.map((a) => a.name).join(" + ")}${parent ? " — exists" : ""}`);
    if (!parent && !p.variants.length) { made++; console.log(`    + ${p.code}  ${p.name}   (single item, no variants)`); }
    if (!parent && apply) {
      [parent] = await sql`insert into item (company_id, item_group_id, brand_id, serial, code_is_manual, name,
                             base_uom_id, is_stocked, identity, valuation_method)
        values (${co.id}, ${grp.id}, ${brand.id}, ${p.code}, true, ${p.name}, ${uom.id}, true, ${p.identity}, 'FIFO')
        returning id`;
      if (attrs.length) await sql`insert into item_variant_attribute ${sql(attrs.map((a, i) => ({ item_id: parent.id, attribute_id: a.id, sort_order: i })))}`;
    }
    for (const [code, name, values] of p.variants) {
      const opts = [];
      for (let i = 0; i < attrs.length; i++) if (values[i]) opts.push(await option(attrs[i], values[i]));
      const identity = opts.some((o) => /cellular/i.test(o.name)) ? "IMEI" : p.identity;
      const [exists] = await sql`select name from item where company_id = ${co.id} and code = ${code}`;
      if (exists) { skipped++; console.log(`    = ${code}  already there: ${exists.name}`); continue; }
      console.log(`    + ${code}  ${name}   [${opts.map((o) => o.name).join(" · ")}]${identity !== p.identity ? `  ${identity}` : ""}`);
      if (!apply) continue;
      const [v] = await sql`insert into item (company_id, item_group_id, brand_id, parent_item_id, serial, code_is_manual,
                              name, name_is_custom, base_uom_id, is_stocked, identity, valuation_method)
        values (${co.id}, ${grp.id}, ${brand.id}, ${parent.id}, ${code}, true, ${name}, true, ${uom.id}, true, ${identity}, 'FIFO')
        returning id`;
      await sql`insert into item_variant_option ${sql(opts.map((o) => ({ item_id: v.id, option_id: o.id })))}`;
      made++;
    }
  }
  console.log(`\n  ${apply ? "created" : "would create"} ${apply ? made : PRODUCTS.flatMap((p) => p.variants).length - skipped} variants, ${skipped} already there\n`);
} catch (e) {
  console.error("\n  error:", e.message, "\n");
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

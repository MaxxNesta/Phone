// Importing products with variants: rows with the same Model become one
// product, one variant per row, with its options from the option columns.
//
//   npx tsx scripts/test-item-import-variants.mjs
//
// Writes items, a category and two variant attributes, all stamped so a
// rerun never collides. Run against the local test database (.env.test).

const { sql } = await import("../lib/db.ts");
const { parseCsv, planImport } = await import("../lib/import-items.ts");
const { getImportMasterData } = await import("../lib/queries.ts");
const { importItems } = await import("../lib/posting.ts");
const { importTemplateRows } = await import("../lib/read-spreadsheet.ts");

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) throw new Error("Run against the local test database.");

let failed = 0;
const check = (what, ok, got) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${ok ? "" : `   (got ${JSON.stringify(got)})`}`); if (!ok) failed++; };

try {
  const [co] = await sql`select id from company order by created_at limit 1`;
  const s = Date.now().toString().slice(-6);
  const [cat] = await sql`insert into item_group (company_id, segment, code, name, identity)
                          values (${co.id}, ${"VT" + s.slice(-2)}, 'x', ${"Variant Test " + s}, 'IMEI') returning id, name, code`;
  const [uom] = await sql`select name from uom where company_id = ${co.id} order by code limit 1`;
  const STO = `TSto${s}`, COL = `TCol${s}`;
  const [a1] = await sql`insert into variant_attribute (company_id, code, name, sort_order) values (${co.id}, ${"S" + s}, ${STO}, 900) returning id`;
  const [a2] = await sql`insert into variant_attribute (company_id, code, name, sort_order) values (${co.id}, ${"C" + s}, ${COL}, 901) returning id`;
  for (const [a, code, name] of [[a1, "128", "128GB"], [a1, "256", "256GB"], [a2, "BLK", "Black"], [a2, "WHT", "White"]]) {
    await sql`insert into variant_option (company_id, attribute_id, code, name, sort_order, physical_value)
              values (${co.id}, ${a.id}, ${code}, ${name}, 0, ${code})`;
  }
  const head = `No,Barcode,Stock ID,Stock Name,Category,Sub Category,Brand,Unit,Selling price,Model,Model Code,${STO},${COL}`;
  const MC = `VM${s}`;
  const plan = async (rows) => planImport(parseCsv(`${head}\n${rows.join("\n")}`), await getImportMasterData(co.id));
  const first = [
    `1,,,,${cat.name},,,${uom.name},1000,Phone X ${s},${MC},128GB,Black`,
    `2,,,,${cat.name},,,${uom.name},1000,Phone X ${s},${MC},128,White`,
    `3,,,,${cat.name},,,${uom.name},1500,Phone X ${s},${MC},256GB,Black`,
    `4,,,,${cat.name},,,${uom.name},2000,Phone Y ${s},,256GB,White`,
    `5,,FLAT${s},Plain cable ${s},${cat.name},,,${uom.name},500,,,,`,
  ];
  const p = await plan(first);
  check("a clean sheet plans with no errors", p.errors.length === 0, p.errors.map((e) => e.message));
  check("five rows: four variants and one plain item", p.rows.length === 5 && p.rows.filter((r) => r.model).length === 4, p.rows.length);
  check("variants are numbered under the Model Code", p.rows.slice(0, 3).map((r) => r.code).join() === `${MC}001,${MC}002,${MC}003`,
    p.rows.map((r) => r.code));
  check("a variant with no Model Code takes the model's code and its option codes", p.rows[3].code.endsWith("-256-WHT"), p.rows[3].code);
  check("the name is the model and its options", p.rows[0].name === `Phone X ${s} 128GB / Black`, p.rows[0].name);
  check("an option matched by its code (128) counts", p.rows[1].model?.optionIds.length === 2);

  const done = await importItems({ companyId: co.id, filename: "variants.csv", rowCount: 5, rows: p.rows });
  check("four variants and one plain item created", done.itemsCreated === 5, done);
  const [px] = await sql`select id, code, identity from item where company_id = ${co.id} and name = ${`Phone X ${s}`} and parent_item_id is null`;
  check("the model is made once, coded by its Model Code", px?.code === MC, px);
  const kids = await sql`select code, name, identity, tracks_serial from item where parent_item_id = ${px.id} order by code`;
  check("it carries its three variants", kids.length === 3, kids.length);
  check("each variant is tracked by IMEI, from the category", kids.every((k) => k.identity === "IMEI" && k.tracks_serial));
  const [{ n: opts }] = await sql`select count(*)::int as n from item_variant_option o join item i on i.id = o.item_id where i.parent_item_id = ${px.id}`;
  check("each variant has its two options", opts === 6, opts);
  const varies = await sql`select attribute_id from item_variant_attribute where item_id = ${px.id} order by sort_order`;
  check("the model varies by storage then color", varies.map((v) => v.attribute_id).join() === `${a1.id},${a2.id}`, varies);
  const [pr] = await sql`select p.price::float as v from item_price p join item i on i.id = p.item_id where i.code = ${MC + "003"}`;
  check("each variant keeps its own price", pr?.v === 1500, pr);

  const again = await plan(first);
  check("the same sheet again creates nothing", again.errors.length === 0 && again.summary.newItems === 0, again.summary);

  const more = await plan([`1,,,,${cat.name},,,${uom.name},1500,Phone X ${s},${MC},256GB,White`]);
  check("a new option set joins the existing model", more.rows[0]?.model?.parentId === px.id && more.rows[0].code === `${MC}004`, more.rows[0]);
  await importItems({ companyId: co.id, filename: "more.csv", rowCount: 1, rows: more.rows });
  const [{ n: four }] = await sql`select count(*)::int as n from item where parent_item_id = ${px.id}`;
  check("the model now has four variants", four === 4, four);

  const bad = await plan([
    `1,,,,${cat.name},,,${uom.name},,Phone Z ${s},,512GB,Black`,
    `2,,,,${cat.name},,,${uom.name},,Phone Z ${s},,,`,
    `3,,,,${cat.name},,,${uom.name},,Phone W ${s},,128GB,Black`,
    `4,,,,${cat.name},,,${uom.name},,Phone W ${s},,128GB,Black`,
  ]);
  const msg = bad.errors.map((e) => e.message).join(" | ");
  check("an unknown option is refused, pointing at Settings → Variants", /512GB" is not one of the/.test(msg) && /Settings → Variants/.test(msg), msg);
  check("a model row with no options is refused", /names no options/.test(msg), msg);
  check("the same variant twice is refused", /already on row 4|already on row 3/.test(msg), msg);

  const spaced = await plan([`1,,,,${cat.name},,,${uom.name},,Phone S ${s},,128 GB,Black`]);
  check("an option typed with a space (128 GB for 128GB) still matches", spaced.errors.length === 0, spaced.errors.map((e) => e.message));

  const tpl = importTemplateRows("phone", [{ name: "Storage", code: "STO" }, { name: "Color", code: "COL" }]);
  check("the phone template has Model, Model Code and the shop's option columns",
    ["Model", "Model Code", "Storage", "Color"].every((c) => tpl.header.includes(c)), tpl.header);
  check("its examples fill the options", tpl.examples[0][tpl.header.indexOf("Storage")] === "256GB", tpl.examples[0]);
  const plain = importTemplateRows("apparel", []);
  check("a shop with no variant options gets the plain sheet", !plain.header.includes("Model") && plain.examples.length === 1, plain);
} catch (e) {
  console.error("  error:", e.message); failed++;
} finally {
  // The two test attributes would otherwise show up as columns in every template.
  await sql`update variant_attribute set is_active = false where name ~ '^T(Sto|Col)[0-9]+$'`.catch(() => {});
  await sql.end();
}
console.log(failed ? `\n  ${failed} failed\n` : "\n  all passed\n");
process.exitCode = failed ? 1 : 0;

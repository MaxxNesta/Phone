// Variant photos (2026-11-25): the model's photo is every variant's default; a
// colour's photo (uploaded on any variant of that colour) stands for all its sizes.
//
//   npx tsx scripts/test-variant-photos.mjs      (pure checks, then one transaction, rolled back)
//
//   1. no colour photo: every variant shows the model's photo
//   2. a Black photo: every Black size shows it, other colours the model's
//   3. no model photo and no colour photo: none
//   4. the save's SQL: a new Black photo clears the other Black variants' own;
//      removing it clears the colour; "replace all" clears every variant

import postgres from "postgres";
const { variantPhotos } = await import("../lib/variants.ts");

let bad = 0;
const check = (label, ok, detail = "") => { if (!ok) bad++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`); };

const part = (attr, opt) => ({ attributeId: attr, attribute: attr, optionId: opt, option: opt, optionSort: 0, attributeSort: 0 });
const row = (id, colour, size, photo, parent = "P1") => ({ id, photo_version: photo, parts: [part("colour", colour), part("size", size)],
  parent_item_id: parent, parent_photo_version: "m1" });
const base = [row("bs", "Black", "S", null), row("bm", "Black", "M", null), row("rs", "Red", "S", null)];

let ph = variantPhotos(base);
check("1. no colour photo: Black S shows the model's photo", ph.srcFor(base[0]) === "/items/P1/photo?v=m1", String(ph.srcFor(base[0])));
const withBlack = [row("bs", "Black", "S", "b1"), row("bm", "Black", "M", null), row("rs", "Red", "S", null), row("rm", "Red", "M", "r0")];
// Red M has a photo only so two attributes are not tied: colour carries the photos.
ph = variantPhotos(withBlack);
check("2. Black M shows Black S's photo", ph.srcFor(withBlack[1]) === "/items/bs/photo?v=b1", String(ph.srcFor(withBlack[1])));
check("   Red S shows Red's photo, not the model's", ph.srcFor(withBlack[2]) === "/items/rm/photo?v=r0", String(ph.srcFor(withBlack[2])));
const lone = [{ ...base[2], parent_photo_version: null }];
check("3. no model photo and none of its own: none", variantPhotos(lone).srcFor(lone[0]) === null);

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
const ROLLBACK = new Error("rollback");
const NO_PHOTO = sql.unsafe("photo_key = null, photo = null, photo_mime = null, photo_updated_at = null");
try {
  await sql.begin(async (tx) => {
    // A model with variants and a variant attribute; give every variant a photo.
    const [m] = await tx`select p.id from item p where exists (select 1 from item c where c.parent_item_id = p.id)
                          and (select count(*) from item c where c.parent_item_id = p.id) >= 3 limit 1`;
    const vs = await tx`select c.id, (select o.option_id from item_variant_option o where o.item_id = c.id limit 1) as opt
                          from item c where c.parent_item_id = ${m.id} order by c.code`;
    await tx`update item set photo_key = 'test/' || id, photo_mime = 'image/webp', photo_updated_at = now() where parent_item_id = ${m.id}`;
    const me = vs[0];
    const same = vs.filter((v) => v.opt === me.opt).map((v) => v.id);
    // Set on one variant of that option: the others of the option give theirs up (lib/actions.ts saveItemEdit).
    await tx`update item set ${NO_PHOTO} where parent_item_id = ${m.id} and (id <> ${me.id} or ${false})
               and exists (select 1 from item_variant_option o where o.item_id = item.id and o.option_id = ${me.opt}::uuid)`;
    const left = await tx`select id from item where parent_item_id = ${m.id} and photo_key is not null`;
    check("4. a new photo for the option: the others of that option give theirs up",
      left.some((r) => r.id === me.id) && !left.some((r) => r.id !== me.id && same.includes(r.id)),
      `${left.length} with photos, ${same.length} share the option`);
    check("   other options keep theirs", left.length === vs.length - same.length + 1);
    // Removed: the whole option goes back to the model's photo.
    await tx`update item set ${NO_PHOTO} where parent_item_id = ${m.id} and (id <> ${me.id} or ${true})
               and exists (select 1 from item_variant_option o where o.item_id = item.id and o.option_id = ${me.opt}::uuid)`;
    const [{ n }] = await tx`select count(*)::int n from item where id = any(${same}) and photo_key is not null`;
    check("   removed: no variant of that option has a photo", n === 0);
    // Replace all (a model's photo, ticked): every variant's own goes.
    await tx`update item set ${NO_PHOTO} where id = any(${vs.map((v) => v.id)})`;
    const [{ k }] = await tx`select count(*)::int k from item where parent_item_id = ${m.id} and photo_key is not null`;
    check("   replace all: no variant keeps its own", k === 0);
    throw ROLLBACK;
  });
} catch (e) { if (e !== ROLLBACK) { console.error(e); bad++; } }
await sql.end();
console.log(bad ? `\n  ${bad} failed` : "\n  all passed (rolled back)");
process.exit(bad ? 1 : 0);

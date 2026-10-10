// Takes Memory off phone models (0129: an iPhone model has one memory size).
//
// For each IMEI-tracked product that varies by Memory: variants that differ
// only by memory become one. The one with history is kept (or the first),
// renamed without the memory, and loses its memory option; the others are
// deactivated, never deleted. A model where two of the twins both have
// history is left alone and reported — merging stock is a person's decision.
//
//   node scripts/drop-memory-from-phones.mjs            dry run
//   node scripts/drop-memory-from-phones.mjs --apply    make the change
//
// SKUs are not renamed: they are on labels and in history.

import postgres from "postgres";
import { readFileSync } from "node:fs";

const url = process.env.DATABASE_URL
  ?? readFileSync(".env", "utf8").match(/^\s*DATABASE_URL\s*=\s*"?(.+?)"?\s*$/m)[1];
const sql = postgres(url, { ssl: "require", max: 1 });
const apply = process.argv.includes("--apply");

const models = await sql`
  select p.id, p.name, p.name_my, a.id as mem_id
    from item p
    join item_variant_attribute iva on iva.item_id = p.id
    join variant_attribute a on a.id = iva.attribute_id and a.code = 'MEM'
   where p.identity = 'IMEI'
      or exists (select 1 from item c where c.parent_item_id = p.id and c.identity = 'IMEI')`;

let merged = 0, deactivated = 0, renamed = 0;
const skipped = [];
await sql.begin(async (tx) => {
  for (const m of models) {
    const kids = await tx`
      select c.id, c.code, c.is_active,
             exists (select 1 from document_line dl where dl.item_id = c.id)
          or exists (select 1 from stock_movement sm where sm.item_id = c.id)
          or exists (select 1 from stock_serial ss where ss.item_id = c.id) as used,
             coalesce((select json_agg(json_build_object('a', o.attribute_id, 'o', o.id, 'n', o.name)
                                       order by coalesce(iva.sort_order, va.sort_order))
                         from item_variant_option ivo
                         join variant_option o on o.id = ivo.option_id
                         join variant_attribute va on va.id = o.attribute_id
                         left join item_variant_attribute iva on iva.item_id = ${m.id} and iva.attribute_id = va.id
                        where ivo.item_id = c.id), '[]') as opts
        from item c where c.parent_item_id = ${m.id}
       order by c.code`;
    const groups = new Map();
    for (const k of kids) {
      const rest = k.opts.filter((x) => x.a !== m.mem_id);
      const key = rest.map((x) => x.o).sort().join(",");
      if (!groups.has(key)) groups.set(key, { rest, kids: [] });
      groups.get(key).kids.push(k);
    }
    const clash = [...groups.values()].find((g) => g.kids.filter((k) => k.used).length > 1);
    if (clash) { skipped.push(`${m.name}: ${clash.kids.filter((k) => k.used).map((k) => k.code).join(", ")} all have history`); continue; }

    for (const g of groups.values()) {
      const keep = g.kids.find((k) => k.used) ?? g.kids.find((k) => k.is_active) ?? g.kids[0];
      const others = g.kids.filter((k) => k !== keep && k.is_active);
      if (g.kids.length > 1) merged++;
      deactivated += others.length;
      const label = g.rest.map((x) => x.n).join(" / ");
      renamed++;
      if (!apply) continue;
      if (others.length) await tx`update item set is_active = false where id in ${tx(others.map((k) => k.id))}`;
      await tx`delete from item_variant_option ivo using variant_option o
                where ivo.item_id = ${keep.id} and o.id = ivo.option_id and o.attribute_id = ${m.mem_id}`;
      await tx`update item set name = ${label ? `${m.name} ${label}` : m.name},
                               name_my = ${m.name_my ? (label ? `${m.name_my} ${label}` : m.name_my) : null}
                where id = ${keep.id}`;
    }
    if (apply) await tx`delete from item_variant_attribute where item_id = ${m.id} and attribute_id = ${m.mem_id}`;
    console.log(`${m.name}: ${kids.length} variants → ${groups.size}`);
  }
});

console.log(`${apply ? "Applied" : "Dry run"}: ${models.length - skipped.length} models, ${merged} groups merged, ${deactivated} variants deactivated, ${renamed} renamed.`);
for (const s of skipped) console.log("Left alone —", s);
await sql.end();

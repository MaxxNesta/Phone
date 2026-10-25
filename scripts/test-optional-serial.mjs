// Optional serial tracking, and two variants that are one physical thing.
//
//   ALLOW_DESTRUCTIVE_TESTS=1 ./node_modules/.bin/tsx scripts/test-optional-serial.mjs
//
// An item tracked OPTIONAL is received sometimes with a serial for every unit
// and sometimes by quantity. Named and anonymous units share its layers; an
// issue without serials may take only the anonymous ones, and a named unit
// leaves, moves and comes back only by its name. Costing, the stock ledger and
// the GL must agree throughout.
//
// Then 42MM / Black beside 42 / Black: two records, one configuration —
// v_item_physical groups them and the value normaliser agrees with the one
// the form uses.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { takeTestLock, releaseTestLock } from "./test-lock.mjs";
import { resetTransactions } from "./test-reset.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.DATABASE_URL && existsSync(join(root, ".env"))) {
  for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
    if (m) { process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, ""); break; }
  }
}
const url = process.env.DATABASE_URL;
const sql = postgres(url, { ssl: url.includes("localhost") ? false : "require",
  prepare: !url.includes("-pooler."), onnotice: () => {}, max: 4 });

let bad = 0;
const check = (label, ok, detail = "") => {
  if (!ok) bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "   " + detail : ""}`);
};
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
const refused = async (label, fn, pattern) => {
  try { await fn(); check(label, false, "it went through"); }
  catch (e) { check(label, pattern ? pattern.test(e.message) : true, e.message); }
};

const made = { items: [], attrs: [], locs: [] };
try {
  const [co] = await sql`select id, name from company order by created_at limit 1`;
  if (!/\bDEV\b/i.test(String(co.name)) || process.env.ALLOW_DESTRUCTIVE_TESTS !== "1") {
    throw new Error(`This suite empties the transaction tables. Run it against a DEV database with ALLOW_DESTRUCTIVE_TESTS=1 ("${co.name}").`);
  }
  await takeTestLock(sql, "test-optional-serial.mjs");
  await resetTransactions(sql);

  const P = await import("../lib/posting.ts");
  const { physicalKey, repeats } = await import("../lib/variant-identity.ts");

  let [loc, loc2] = await sql`select id from location where company_id = ${co.id} and is_stock_location and is_active order by code limit 2`;
  if (!loc2) {
    [loc2] = await sql`insert into location (company_id, code, name, is_stock_location)
                       values (${co.id}, 'OPT-WH2', 'Optional test stock', true) returning id`;
    made.locs.push(loc2.id);
  }
  const party = async (code, cols) => (await sql`select id from business_partner where company_id = ${co.id} and code = ${code}`)[0]
    ?? (await sql`insert into business_partner ${sql({ company_id: co.id, code, name: code, ...cols })} returning id`)[0];
  const supp = await party("OPT-S", { is_supplier: true });
  const cust = await party("OPT-C", { is_customer: true, payment_terms_days: 30 });
  const [grp] = await sql`select id from item_group where company_id = ${co.id} and parent_id is null order by code limit 1`;
  const [uom] = await sql`select id from uom where company_id = ${co.id} order by code limit 1`;
  const DAY = (await sql`select to_char(current_date,'YYYY-MM-DD') as d`)[0].d;
  const stamp = String(Date.now()).slice(-6);

  const [watch] = await sql`
    insert into item (company_id, item_group_id, serial, name, base_uom_id, is_stocked, identity)
    values (${co.id}, ${grp.id}, ${"OPT" + stamp}, 'Optional watch', ${uom.id}, true, 'OPTIONAL')
    returning id, tracks_serial, identity`;
  made.items.push(watch.id);
  const sn = (k) => `OPTSN${stamp}${k}`;
  const unit = async (s) => (await sql`select status, location_id, unit_cost from v_stock_serial where imei = ${s}`)[0];
  const onHand = async (l) => Number((await sql`select fn_qty_on_hand(${co.id}, ${watch.id}, ${l.id}) as q`)[0].q);
  const named = async (l) => Number((await sql`
    select coalesce(sum(fn_lot_named_on_hand(id)), 0) as n from stock_lot where item_id = ${watch.id} and location_id = ${l.id}`)[0].n);
  const reconciled = async () => Number((await sql`
    select coalesce(sum(difference), 0) as d from v_check_inventory_reconciliation where company_id = ${co.id}`)[0].d);
  const costOf = async (docId) => Number((await sql`
    select coalesce(sum(-total_cost), 0) as c from stock_movement where document_id = ${docId} and item_id = ${watch.id}`)[0].c);
  const receive = (lines) => P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: DAY, lines });
  const sell = (lines) => P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: DAY, dueDate: DAY,
    paymentType: "CASH", lines });

  console.log("\n  the setting");
  check("OPTIONAL is not 'every unit must be named'", watch.identity === "OPTIONAL" && watch.tracks_serial === false);
  check("tracking is the field that was chosen, nothing read from a name",
    (await sql`select tracks_serial from item where id = ${watch.id}`)[0].tracks_serial === false);

  console.log("\n  receiving");
  await receive([{ itemId: watch.id, qty: 3, unitCost: 100 }]);
  check("3 received by quantity, none named", (await onHand(loc)) === 3 && (await named(loc)) === 0);
  await receive([{ itemId: watch.id, qty: 2, unitCost: 150, serials: [sn(1), sn(2)] }]);
  check("2 more received with serials", (await onHand(loc)) === 5 && (await named(loc)) === 2
    && (await unit(sn(1)))?.status === "IN_STOCK");
  await refused("a receipt naming some lines of the item and not others is refused",
    () => receive([{ itemId: watch.id, qty: 1, unitCost: 150, serials: [sn(3)] }, { itemId: watch.id, qty: 1, unitCost: 150 }]),
    /every line of it|or on none/);
  await refused("named, it needs one serial per unit",
    () => receive([{ itemId: watch.id, qty: 2, unitCost: 150, serials: [sn(4)] }]), /serial/);
  await refused("a serial already on file is refused",
    () => receive([{ itemId: watch.id, qty: 1, unitCost: 150, serials: [sn(1)] }]), /already/);
  check("stock ledger = GL after receipts", near(await reconciled(), 0));

  console.log("\n  selling");
  const s1 = await sell([{ itemId: watch.id, qty: 3, unitPrice: 300 }]);
  check("3 sold without serials leave at the anonymous layer's cost (3 × 100)", near(await costOf(s1.id), 300), String(await costOf(s1.id)));
  check("the named units are untouched", (await unit(sn(1)))?.status === "IN_STOCK" && (await unit(sn(2)))?.status === "IN_STOCK");
  await refused("a fourth without a serial is refused: only named units are left",
    () => sell([{ itemId: watch.id, qty: 1, unitPrice: 300 }]), /without a serial|serial/);
  const s2 = await sell([{ itemId: watch.id, qty: 1, unitPrice: 400, serials: [sn(1)] }]);
  check("sold by serial: that unit, at its cost (150)", (await unit(sn(1)))?.status === "SOLD" && near(await costOf(s2.id), 150));
  check("stock ledger = GL after sales", near(await reconciled(), 0));

  console.log("\n  moving");
  await receive([{ itemId: watch.id, qty: 2, unitCost: 120 }]);
  const t1 = await P.postStockTransfer({ companyId: co.id, fromLocationId: loc.id, toLocationId: loc2.id, docDate: DAY,
    lines: [{ itemId: watch.id, qty: 1 }] });
  check("an anonymous transfer takes an anonymous unit", (await unit(sn(2)))?.location_id === loc.id
    && (await onHand(loc2)) === 1 && (await named(loc2)) === 0);
  check("…at its cost (120)", near(Number((await sql`select coalesce(sum(total_cost), 0) as c from stock_movement
    where document_id = ${t1.id} and qty > 0`)[0].c), 120));
  await P.postStockTransfer({ companyId: co.id, fromLocationId: loc.id, toLocationId: loc2.id, docDate: DAY,
    lines: [{ itemId: watch.id, qty: 1, serials: [sn(2)] }] });
  check("a named transfer moves that unit with its name", (await unit(sn(2)))?.location_id === loc2.id
    && (await named(loc2)) === 1 && (await onHand(loc2)) === 2);
  await P.postStockAdjustment({ companyId: co.id, locationId: loc.id, docDate: DAY, lines: [{ itemId: watch.id, qty: -1 }] });
  check("an anonymous write-off takes the last anonymous unit here", (await onHand(loc)) === 0);
  await refused("found stock with serials is a receipt, not an adjustment",
    () => P.postStockAdjustment({ companyId: co.id, locationId: loc.id, docDate: DAY,
      lines: [{ itemId: watch.id, qty: 1, unitCost: 1, serials: [sn(5)] }] }), /goods receipt/);
  check("stock ledger = GL after moves", near(await reconciled(), 0));

  console.log("\n  coming back");
  await refused("a unit sold by its serial cannot come back without it",
    () => P.postSalesReturn({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: DAY, sourceDocumentId: s2.id,
      lines: [{ itemId: watch.id, qty: 1, unitPrice: 400 }] }), /Name the units/);
  await P.postSalesReturn({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: DAY, sourceDocumentId: s2.id,
    lines: [{ itemId: watch.id, qty: 1, unitPrice: 400, serials: [sn(1)] }] });
  check("…and comes back by it, on the shelf again", (await unit(sn(1)))?.status === "IN_STOCK" && (await named(loc)) === 1);
  await P.postSalesReturn({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: DAY, sourceDocumentId: s1.id,
    lines: [{ itemId: watch.id, qty: 1, unitPrice: 300 }] });
  check("an anonymous sale returns anonymously", (await onHand(loc)) === 2 && (await named(loc)) === 1);
  const pr = await P.postPurchaseReturn({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: DAY,
    lines: [{ itemId: watch.id, qty: 1, unitPrice: 100 }] });
  check("an anonymous purchase return leaves the named unit alone", (await unit(sn(1)))?.status === "IN_STOCK"
    && (await onHand(loc)) === 1 && near(await costOf(pr.id), 100));
  check("stock ledger = GL at the end", near(await reconciled(), 0), String(await reconciled()));
  const [ub] = await sql`select count(*)::int n from v_check_unbalanced_entries where company_id = ${co.id}`;
  check("no unbalanced journal entries", ub.n === 0);

  console.log("\n  one configuration, two codes");
  for (const [a, b] of [["46 mm", "46MM"], ["256GB", "256 GB"], ["Black", "black"], ["11-inch", "11 inch"]]) {
    const [{ x, y }] = await sql`select fn_variant_value_canon(${a}) as x, fn_variant_value_canon(${b}) as y`;
    check(`${a} and ${b} are spelled one way`, x === y, `${x} / ${y}`);
  }
  for (const [a, b] of [["42MM", "46MM"], ["Gold", "Space Gray"], ["128GB", "1TB"]]) {
    const [{ x, y }] = await sql`select fn_variant_value_canon(${a}) as x, fn_variant_value_canon(${b}) as y`;
    check(`${a} and ${b} stay different`, x !== y);
  }
  check("the form flags the later of a repeated pair only",
    JSON.stringify([...repeats([physicalKey([{ attributeId: "s", physical: "42mm" }, { attributeId: "c", physical: "black" }]),
                                physicalKey([{ attributeId: "c", physical: "silver" }, { attributeId: "s", physical: "42mm" }]),
                                physicalKey([{ attributeId: "c", physical: "black" }, { attributeId: "s", physical: "42mm" }])])]) === "[[2,0]]");

  const attr = async (code, name, opts) => {
    const [a] = await sql`insert into variant_attribute (company_id, code, name, sort_order)
                          values (${co.id}, ${code + stamp}, ${name}, 90) returning id`;
    made.attrs.push(a.id);
    const ids = {};
    for (const [i, o] of opts.entries()) {
      ids[o] = (await sql`insert into variant_option (company_id, attribute_id, code, name, sort_order)
                          values (${co.id}, ${a.id}, ${"O" + i}, ${o}, ${i}) returning id`)[0].id;
    }
    return ids;
  };
  const size = await attr("TSZ", "Test size", ["42MM", "42", "46MM"]);
  const phys = async (id) => (await sql`select name, physical_value, physical_is_manual from variant_option where id = ${id}`)[0];
  check("each value stores what it physically is: 42MM is 42mm", (await phys(size["42MM"])).physical_value === "42mm");
  check("…and 42, next to 42MM, is 42mm too, though it is still shown as 42",
    (await phys(size["42"])).physical_value === "42mm" && (await phys(size["42"])).name === "42");
  const later = await attr("TLT", "Test later", ["46"]);
  check("a bare 46 alone is 46", (await phys(later["46"])).physical_value === "46");
  await sql`insert into variant_option (company_id, attribute_id, code, name, sort_order)
            select company_id, attribute_id, 'O9', '46MM', 9 from variant_option where id = ${later["46"]}`;
  check("…until 46MM is added beside it, then it is 46mm", (await phys(later["46"])).physical_value === "46mm");
  await sql`update variant_option set physical_value = '45mm', physical_is_manual = true where id = ${later["46"]}`;
  await sql`update variant_option set name = '46 ' where id = ${later["46"]}`;
  check("a value set by hand is kept when the name changes", (await phys(later["46"])).physical_value === "45mm");
  const colour = await attr("TCL", "Test colour", ["Black"]);
  const [model] = await sql`insert into item (company_id, item_group_id, serial, name, base_uom_id, is_stocked)
    values (${co.id}, ${grp.id}, ${"OPW" + stamp}, 'Test Watch', ${uom.id}, true) returning id`;
  made.items.push(model.id);
  const variant = async (code, s) => {
    const [v] = await sql`insert into item (company_id, item_group_id, parent_item_id, serial, code_is_manual, name, base_uom_id, is_stocked, identity)
      values (${co.id}, ${grp.id}, ${model.id}, ${code + stamp}, true, ${"Test Watch " + s}, ${uom.id}, true, 'OPTIONAL') returning id`;
    made.items.push(v.id);
    await sql`insert into item_variant_option (item_id, option_id) values (${v.id}, ${size[s]}), (${v.id}, ${colour.Black})`;
    return v;
  };
  const a = await variant("TW001", "42MM");
  const b = await variant("TW007", "42");
  const c = await variant("TW004", "46MM");
  const grouped = await sql`select item_id, canonical_item_id, members::int as members from v_item_physical
                          where item_id in (${a.id}, ${b.id}, ${c.id})`;
  const of = (id) => grouped.find((r) => r.item_id === id);
  check("42MM / Black and 42 / Black are one configuration", of(a.id).members === 2 && of(b.id).members === 2
    && of(a.id).canonical_item_id === a.id && of(b.id).canonical_item_id === a.id);
  check("46MM / Black is its own", of(c.id).members === 1);
  await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: DAY,
    lines: [{ itemId: a.id, qty: 2, unitCost: 1000 }, { itemId: b.id, qty: 3, unitCost: 1100 }] });
  const [sum] = await sql`
    select sum(s.qty_on_hand)::float as qty, sum(s.value_on_hand)::float as value from v_stock_on_hand s
      join v_item_physical vp on vp.item_id = s.item_id where vp.canonical_item_id = ${a.id}`;
  check("added up under one configuration: 5 units, 5,300 — each unit once", sum.qty === 5 && near(sum.value, 5300),
    `${sum.qty} / ${sum.value}`);
  check("the records stay two, with their own codes", (await sql`select count(*)::int n from item where id in (${a.id}, ${b.id})`)[0].n === 2);

  console.log("  activated beside standard");
  const [act] = await sql`
    select a.id as attr, o.id as opt, o.physical_value, a.identities from variant_attribute a
      join variant_option o on o.attribute_id = a.id and o.code = 'ACTIVATED'
     where a.company_id = ${co.id} and a.code = 'ACT'`;
  check("Activation is a variant attribute with one value, Activated, for IMEI phones",
    !!act && act.physical_value === "activated" && act.identities?.includes("IMEI"));
  // 46MM / Black exists as TW004 (c); the same values with Activation on are another configuration.
  const activated = await variant("TW011", "46MM");
  check("before it is activated it is a twin of the sealed one",
    (await sql`select members::int m from v_item_physical where item_id = ${activated.id}`)[0].m === 2);
  await sql`insert into item_variant_option (item_id, option_id) values (${activated.id}, ${act.opt})`;
  const after = await sql`select item_id, members::int as m, canonical_item_id from v_item_physical where item_id in (${c.id}, ${activated.id})`;
  check("with Activation on, the two are different configurations, not twins",
    after.length === 2 && after.every((r) => r.m === 1) && after[0].canonical_item_id !== after[1].canonical_item_id);
  check("the form's duplicate key sees it too",
    physicalKey([{ attributeId: "s", physical: "46mm" }, { attributeId: "c", physical: "black" }])
    !== physicalKey([{ attributeId: "s", physical: "46mm" }, { attributeId: "c", physical: "black" }, { attributeId: act.attr, physical: "activated" }]));
  const [sealed] = await sql`select count(*)::int n from item_variant_option where item_id = ${c.id} and option_id = ${act.opt}`;
  check("the sealed phone has no Activation value — standard is the absence of one", sealed.n === 0);

  console.log(bad === 0 ? "\n  all checks passed\n" : `\n  ${bad} FAILED\n`);
  process.exitCode = bad === 0 ? 0 : 1;
} catch (e) {
  console.error("\n  error:", e.stack ?? e.message, "\n");
  process.exitCode = 1;
} finally {
  await resetTransactions(sql).catch(() => {});
  if (made.items.length) {
    await sql`delete from item_variant_option where item_id = any(${made.items})`.catch(() => {});
    await sql`delete from item where id = any(${made.items}) and parent_item_id is not null`.catch(() => {});
    await sql`delete from item where id = any(${made.items})`.catch(() => {});
  }
  if (made.attrs.length) {
    await sql`delete from variant_option where attribute_id = any(${made.attrs})`.catch(() => {});
    await sql`delete from variant_attribute where id = any(${made.attrs})`.catch(() => {});
  }
  if (made.locs.length) await sql`delete from location where id = any(${made.locs})`.catch(() => {});
  await releaseTestLock(sql);
  await sql.end({ timeout: 5 });
}

// The till's browse filters: groups and values come from the loaded variants,
// OR within one attribute, AND across attributes, and a category change drops
// what no longer applies. Pure functions; no database.
//
//   npx tsx scripts/test-pos-facets.mjs

import {
  computeFacets, filterItems, reconcile, emptySelection, toggleValue, clearFilters, cardState, matchesText,
  LOW_STOCK,
} from "../lib/pos-facets.ts";

let good = 0, bad = 0;
const check = (label, ok, detail = "") => {
  if (ok) good++; else bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "   " + detail : ""}`);
};
const section = (s) => console.log(`\n  ${s}`);

let n = 0;
const item = (type, model, opts, on_hand = 5, price = 1000) => ({
  id: String(n++), type, model, variant: Object.values(opts).join(" / "), brand: "Apple",
  code: `C${n}`, barcode: null, on_hand, price, opts,
});
const names = (rows) => rows.map((i) => `${i.model}|${Object.values(i.opts ?? {}).join("/")}`).sort();

const items = [
  item("iPhone", "iPhone 18", { Storage: "128 GB", Colour: "Blue", SIM: "eSIM" }),
  item("iPhone", "iPhone 18", { Storage: "256 GB", Colour: "Blue", SIM: "eSIM" }),
  item("iPhone", "iPhone 18", { Storage: "256 GB", Colour: "Black", SIM: "Dual" }),
  item("iPhone", "iPhone 18 Pro", { Storage: "256 GB", Colour: "Natural", SIM: "eSIM" }, 1),
  item("iPhone", "iPhone 18 Pro", { Storage: "512 GB", Colour: "Natural", SIM: "Dual" }, 0),
  item("iPhone", "iPhone 16", { Storage: "128 GB", Colour: "Black", SIM: "Dual" }, 2),
  item("iPad", "iPad Air", { Storage: "256 GB", Colour: "Purple", Connectivity: "Wi-Fi" }),
  item("iPad", "iPad Air", { Storage: "512 GB", Colour: "Blue", Connectivity: "Cellular" }),
  item("Mac", "MacBook Air", { Chip: "M3", RAM: "16 GB", SSD: "512 GB", Colour: "Silver" }),
  item("Mac", "MacBook Pro", { Chip: "M4", RAM: "24 GB", SSD: "1 TB", Colour: "Black" }),
  item("Watch", "Watch Series 10", { Size: "46 mm", Colour: "Black", Connectivity: "GPS" }),
  item("Accessories", "USB-C Cable", { Type: "Cable" }, 40),
  item("Accessories", "Clear Case", { Type: "Case", Compatibility: "iPhone 18" }, 12),
  item("AirPods", "AirPods Pro", {}, 6),
];
const sel = (patch = {}) => ({ ...emptySelection(), ...patch });
const attrNames = (f) => f.groups.map((g) => g.attr);

section("Categories come from the data");
const all = computeFacets(items, sel());
check("types are exactly those in the data", all.types.map((t) => t.type).sort().join() === "AirPods,Accessories,Mac,Watch,iPad,iPhone".split(",").sort().join(),
  all.types.map((t) => t.type).join());
check("largest category first, with its in-stock count", all.types[0].type === "iPhone" && all.types[0].count === 5, JSON.stringify(all.types[0]));
check("a new type in the data appears with no code change",
  computeFacets([...items, item("Gaming", "Console", { Colour: "White" })], sel()).types.some((t) => t.type === "Gaming"));

section("Filters depend on the category");
check("iPhone: Storage, Colour and SIM", ["Storage", "Colour", "SIM"].every((a) => attrNames(computeFacets(items, sel({ type: "iPhone" }))).includes(a)),
  attrNames(computeFacets(items, sel({ type: "iPhone" }))).join());
const mac = computeFacets(items, sel({ type: "Mac" }));
check("Mac: Chip, RAM, SSD and Colour", ["Chip", "RAM", "SSD", "Colour"].every((a) => attrNames(mac).includes(a)), attrNames(mac).join());
check("Mac does not offer SIM or Storage", !attrNames(mac).includes("SIM") && !attrNames(mac).includes("Storage"));
const ipad = computeFacets(items, sel({ type: "iPad" }));
check("iPad: Connectivity, not SIM", attrNames(ipad).includes("Connectivity") && !attrNames(ipad).includes("SIM"));
check("Watch: Size and Connectivity", ["Size", "Connectivity"].every((a) => attrNames(computeFacets(items, sel({ type: "Watch" }))).includes(a)));
check("Accessories: Type and Compatibility", ["Type", "Compatibility"].every((a) => attrNames(computeFacets(items, sel({ type: "Accessories" }))).includes(a)));
check("AirPods (no options): models only, no groups", computeFacets(items, sel({ type: "AirPods" })).groups.length === 0
  && computeFacets(items, sel({ type: "AirPods" })).models.length === 1);
const common = attrNames(all);
check("All: only attributes shared by two or more categories", common.includes("Colour") && common.includes("Storage") && common.includes("Connectivity"), common.join());
check("All: category-specific attributes wait (no SIM, Chip, RAM, Size)", !["SIM", "Chip", "RAM", "Size", "SSD"].some((a) => common.includes(a)));

section("OR within an attribute, AND across attributes");
const base = sel({ type: "iPhone", inStockOnly: false });
let s1 = toggleValue(base, "Storage", "128 GB");
check("one value: only those variants", names(filterItems(items, s1)).every((x) => /128 GB/.test(x)) && filterItems(items, s1).length === 2);
s1 = toggleValue(s1, "Storage", "512 GB");
check("two values of one attribute are OR", filterItems(items, s1).length === 3, String(filterItems(items, s1).length));
const s2 = toggleValue(s1, "Colour", "Black");
check("a second attribute is AND", names(filterItems(items, s2)).join() === "iPhone 16|128 GB/Black/Dual", names(filterItems(items, s2)).join());
const s3 = toggleValue(toggleValue(base, "model", "iPhone 18"), "model", "iPhone 16");
check("two models are OR", filterItems(items, s3).length === 4);
check("model AND attribute", filterItems(items, toggleValue(s3, "SIM", "Dual")).length === 2);
check("toggling again removes the value", filterItems(items, toggleValue(s1, "Storage", "128 GB")).length === 1);

section("Counts, active count, empty states");
const f = computeFacets(items, toggleValue(base, "Storage", "128 GB"));
const storage = f.groups.find((g) => g.attr === "Storage");
check("a group's own counts ignore its own selection (switch targets still counted)",
  storage.values.find((v) => v.value === "256 GB")?.count === 3 && storage.values.find((v) => v.value === "128 GB").on === true,
  JSON.stringify(storage.values));
const colour = f.groups.find((g) => g.attr === "Colour");
check("other groups' counts respect the selection (Colour under 128 GB)", colour.values.map((v) => `${v.value}:${v.count}`).sort().join() === "Black:1,Blue:1", JSON.stringify(colour.values));
check("active count is the number of chosen values", computeFacets(items, s2).active === 3, String(computeFacets(items, s2).active));
check("a chosen value stays listed even when it matches nothing now",
  computeFacets(items, toggleValue(toggleValue(base, "Colour", "Natural"), "SIM", "Dual")).groups.find((g) => g.attr === "Colour").values.some((v) => v.value === "Natural"));
check("impossible combination → empty list, not an error", filterItems(items, toggleValue(toggleValue(base, "Colour", "Purple"), "SIM", "eSIM")).length === 0);
check("clearFilters keeps the category and the search", (() => {
  const c = clearFilters({ ...s2, q: "iphone", type: "iPhone" });
  return c.type === "iPhone" && c.q === "iphone" && c.models.length === 0 && Object.keys(c.opts).length === 0;
})());

section("Changing category drops what no longer applies");
const chosen = toggleValue(toggleValue(toggleValue(sel({ type: "iPhone" }), "model", "iPhone 18"), "SIM", "Dual"), "Storage", "256 GB");
const toMac = reconcile(items, { ...chosen, type: "Mac" });
check("model, SIM and Storage are dropped moving to Mac", toMac.models.length === 0 && Object.keys(toMac.opts).length === 0, JSON.stringify(toMac));
const toIpad = reconcile(items, { ...chosen, type: "iPad" });
check("a value that still exists (Storage 256 GB) is kept moving to iPad; SIM and the model are not",
  toIpad.opts.Storage?.join() === "256 GB" && !toIpad.opts.SIM && toIpad.models.length === 0, JSON.stringify(toIpad));
const toAll = reconcile(items, { ...chosen, type: "" });
check("to All: only common attributes survive (SIM goes)", !toAll.opts.SIM && toAll.opts.Storage?.join() === "256 GB", JSON.stringify(toAll));
check("stock flags and the search survive a category change", (() => {
  const r = reconcile(items, { ...chosen, type: "Mac", inStockOnly: false, lowOnly: true, q: "air" });
  return r.inStockOnly === false && r.lowOnly === true && r.q === "air";
})());

section("Stock and text");
check("in stock only hides what is out", filterItems(items, sel({ type: "iPhone" })).every((i) => i.on_hand > 0) && filterItems(items, sel({ type: "iPhone" })).length === 5);
check("switching it off shows everything in the category", filterItems(items, sel({ type: "iPhone", inStockOnly: false })).length === 6);
check(`low stock is 1–${LOW_STOCK}`, filterItems(items, sel({ lowOnly: true })).every((i) => i.on_hand >= 1 && i.on_hand <= LOW_STOCK) && filterItems(items, sel({ lowOnly: true })).length === 2);
check("every word typed must match: 'iphone 18 256gb'", filterItems(items, sel({ q: "iphone 18 256gb" })).length === 3);
check("'256GB' matches '256 GB' and a comma is a separator", matchesText(items[1], "iPhone 18, 256GB"));
check("a word that is nowhere matches nothing", filterItems(items, sel({ q: "zzz" })).length === 0);
check("barcode and code are searchable", matchesText({ ...items[0], barcode: "885909" }, "885909") && matchesText(items[0], items[0].code));
check("card states", cardState({ on_hand: 0, price: 5 }) === "out" && cardState({ on_hand: 2, price: 5 }) === "low" && cardState({ on_hand: 3, price: 5 }) === "ok");

section("Scale");
const big = Array.from({ length: 6000 }, (_, i) => item(["iPhone", "iPad", "Mac", "Watch"][i % 4], `Model ${i % 150}`,
  { Storage: `${64 * (1 + (i % 8))} GB`, Colour: ["Black", "Blue", "Red", "Green", "Pink"][i % 5], SIM: i % 2 ? "eSIM" : "Dual" }, i % 7));
const t0 = performance.now();
for (let k = 0; k < 20; k++) {
  const sx = toggleValue(toggleValue(sel({ type: "iPhone", q: "model" }), "Storage", "128 GB"), "Colour", "Blue");
  computeFacets(big, sx); filterItems(big, sx);
}
const per = (performance.now() - t0) / 20;
check("6,000 variants: filters and counts recompute in under 100 ms", per < 100, `${per.toFixed(1)} ms each`);
check("the loaded catalogue is the only input (no per-IMEI data in items)", !("imeis" in big[0]) && !("serials" in big[0]));

console.log(`\n  ${good} passed, ${bad} failed\n`);
process.exit(bad ? 1 : 0);

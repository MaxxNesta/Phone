// Translation check: every key the code asks for exists, and how much of the
// interface Myanmar covers.
//
//   node scripts/check-i18n.mjs            -- report; fails on a missing English key
//   node scripts/check-i18n.mjs --strict   -- also fails while any Myanmar key is untranslated
//
// English (messages/en.json) is the source and the fallback: a key missing
// there shows as its raw name, so that fails always. A key missing from
// messages/my.json falls back to English, so during a staged rollout it is
// reported, and fails only with --strict. A key in my.json that English does
// not have is a typo or a leftover, and fails.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");
const flat = (o, pre = "") => Object.entries(o).flatMap(([k, v]) =>
  typeof v === "object" ? flat(v, `${pre}${k}.`) : [[`${pre}${k}`, v]]);
const en = new Map(flat(JSON.parse(readFileSync(join(root, "messages/en.json"), "utf8"))));
const my = new Map(flat(JSON.parse(readFileSync(join(root, "messages/my.json"), "utf8"))));

const problems = [];

// 1. Keys the code uses, from `const t = useTranslations("ns")` / getTranslations("ns")
//    and then t("key"). Dynamic keys (t(variable)) are not checked here.
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) {
  const p = join(d, f);
  if (f === "node_modules" || f.startsWith(".")) continue;
  if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p);
} };
for (const d of ["app", "components", "lib"]) walk(join(root, d));
let used = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const ns = new Map([...src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*"([\w.]+)"\s*\)/g)]
    .map((m) => [m[1], m[2]]));
  // lib/actions.ts speaks through m(key), which reads the "actions" namespace.
  if (/async function m\(key: string/.test(src)) ns.set("m", "actions");
  for (const [v, space] of ns) {
    for (const m of src.matchAll(new RegExp(String.raw`(?<![\w.])${v}\(\s*"([\w.]+)"`, "g"))) {
      used++;
      const key = `${space}.${m[1]}`;
      if (!en.has(key)) problems.push(`missing English key ${key} (${relative(root, f)})`);
    }
  }
}

// 2. Myanmar against English.
const untranslated = [...en.keys()].filter((k) => !my.has(k) || String(my.get(k)).trim() === "");
// Written in English in my.json on purpose — accounting terms, for now
// (owner's decision, 2026-10-19). Reported, not counted as missing.
const keptEnglish = [...en.keys()].filter((k) => my.get(k) === en.get(k));
for (const k of my.keys()) if (!en.has(k)) problems.push(`Myanmar key ${k} has no English source`);
for (const [k, v] of en) if (String(v).trim() === "") problems.push(`empty English value ${k}`);

// 3. Coverage by area — the first segment of the key.
const areas = new Map();
for (const k of en.keys()) {
  const a = k.split(".")[0];
  const r = areas.get(a) ?? { total: 0, done: 0 };
  r.total++; if (!untranslated.includes(k)) r.done++;
  areas.set(a, r);
}
console.log("\n  Myanmar coverage");
for (const [a, r] of areas) console.log(`    ${a.padEnd(14)} ${String(r.done).padStart(4)} / ${String(r.total).padEnd(4)} ${Math.round(100 * r.done / r.total)}%`);
const done = en.size - untranslated.length;
console.log(`    ${"total".padEnd(14)} ${String(done).padStart(4)} / ${String(en.size).padEnd(4)} ${Math.round(100 * done / en.size)}%`);
console.log(`\n  ${keptEnglish.length} key(s) kept in English on purpose (same text in my.json)`);
console.log(`  ${used} translated strings referenced in code`);
if (untranslated.length) {
  console.log(`  ${untranslated.length} key(s) still in English:`);
  for (const k of untranslated.slice(0, 20)) console.log(`    ${k}`);
  if (strict) problems.push(`${untranslated.length} untranslated Myanmar key(s)`);
}
if (problems.length) { console.log(`\n  FAILED`); for (const p of problems) console.log(`    ${p}`); process.exit(1); }
console.log("\n  i18n check passes\n");

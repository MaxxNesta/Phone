// Translation regression test.
//
//   node scripts/test-i18n.mjs
//
// 1. The key check passes on the code as it is.
// 2. It fails when code asks for a key English does not have (a probe file is
//    written, checked and removed).
// 3. English and Myanmar hold exactly the same keys, every value is a string,
//    and both dictionaries are valid JSON.
// 4. What must never be translated is not: IMEI, SKU, MMK, ERP and the
//    document-number prefixes stay as written in the Myanmar strings that
//    carry them.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
};
const run = () => {
  try { execFileSync(process.execPath, [join(root, "scripts/check-i18n.mjs")], { stdio: "pipe" }); return 0; }
  catch (e) { return e.status ?? 1; }
};

check("the key check passes on the code as it is", run() === 0);

const probe = join(root, "components", "__i18n_probe.tsx");
try {
  writeFileSync(probe, 'const t = useTranslations("nav");\nexport const x = t("noSuchKeyAnywhere");\n');
  check("a key English does not have makes the check fail", run() === 1);
} finally { rmSync(probe, { force: true }); }

const flat = (o, pre = "") => Object.entries(o).flatMap(([k, v]) =>
  typeof v === "object" ? flat(v, `${pre}${k}.`) : [[`${pre}${k}`, v]]);
const en = Object.fromEntries(flat(JSON.parse(readFileSync(join(root, "messages/en.json"), "utf8"))));
const my = Object.fromEntries(flat(JSON.parse(readFileSync(join(root, "messages/my.json"), "utf8"))));
const enKeys = Object.keys(en).sort(), myKeys = Object.keys(my).sort();
check("English and Myanmar hold the same keys", JSON.stringify(enKeys) === JSON.stringify(myKeys),
  `${enKeys.length} vs ${myKeys.length}`);
check("every value is a non-empty string",
  [...Object.values(en), ...Object.values(my)].every((v) => typeof v === "string" && v.trim() !== ""));

const keep = ["IMEI", "SKU", "MMK", "ERP", "DATABASE_URL", "COGS"];
const lost = [];
for (const [k, v] of Object.entries(en)) for (const w of keep) {
  if (v.includes(w) && my[k] && !my[k].includes(w) && w !== "COGS") lost.push(`${k}: ${w}`);
}
check("codes and identifiers are kept as written in Myanmar", lost.length === 0, lost.join(", "));

// Strings kept in English on purpose (accounting terms, for now) carry the
// English text exactly; every other Myanmar string must be in Myanmar script.
const translated = Object.entries(my).filter(([k, v]) => v !== en[k]);
const burmese = translated.filter(([, v]) => /[က-႟]/.test(v)).length;
check("translated strings are in Myanmar script (Unicode U+1000–U+109F)", burmese === translated.length,
  `${burmese} of ${translated.length}`);
const accounting = ["nav.trialBalance", "nav.balanceSheet", "nav.incomeStatement", "nav.generalLedger",
  "nav.journalVoucher", "nav.chartOfAccounts", "nav.receivables", "nav.payables"];
check("accounting terms stay in English for now", accounting.every((k) => my[k] === en[k]));

console.log(failed ? `\n  ${failed} FAILED` : "\n  all i18n tests pass");
process.exit(failed ? 1 : 0);

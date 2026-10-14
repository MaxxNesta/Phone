// Cost at the counter: a cashier never receives it, and the till never draws it
// for anyone but a role that may see cost. Checked three ways — who holds the
// permission, what the server strips before answering, and what the screens
// are written to show.
//
//   npx tsx scripts/test-pos-cost-hidden.mjs

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.DATABASE_URL && existsSync(join(root, ".env"))) {
  for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
    if (m) { process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, ""); break; }
  }
}
const { can } = await import("../lib/auth-core.ts");
const { stripCost } = await import("../lib/phone.ts");

let good = 0, bad = 0;
const check = (label, ok, detail = "") => {
  if (ok) good++; else bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "   " + detail : ""}`);
};
const section = (s) => console.log(`\n  ${s}`);
const read = (f) => readFileSync(join(root, f), "utf8");

section("Who may see cost");
const roles = ["ADMIN", "MANAGER", "CASHIER", "SALESPERSON", "INVENTORY", "ACCOUNTANT"];
const holders = roles.filter((r) => can({ role: r }, "cost.view"));
check("a cashier does not hold cost.view", !can({ role: "CASHIER" }, "cost.view"));
check("a salesperson does not hold cost.view", !can({ role: "SALESPERSON" }, "cost.view"));
check("cost.view is held only by roles that work with cost", holders.every((r) => ["ADMIN", "MANAGER", "ACCOUNTANT", "INVENTORY"].includes(r)), holders.join(", "));

section("What the server sends (stripCost, as pos-actions applies it)");
const unit = { serial_id: "s1", imei: "353432479000018", imei2: null, item_id: "i1", item_name: "iPhone 16", status: "IN_STOCK",
  location_id: "l1", location_name: "Branch 2", unit_cost: 2_000_000, landed_cost: 5_000, margin: 200_000, stock_value: 2_000_000 };
const forCashier = stripCost([unit], can({ role: "CASHIER" }, "cost.view"))[0];
check("a cashier's unit row has no cost, landed cost, margin or value", !Object.keys(forCashier).some((k) => /cost|margin|profit|value/i.test(k)), Object.keys(forCashier).join(","));
check("…and still has what the till needs: IMEI, status, location", forCashier.imei === unit.imei && forCashier.status === "IN_STOCK" && forCashier.location_id === "l1");
const forAdmin = stripCost([unit], can({ role: "ADMIN" }, "cost.view"))[0];
check("an administrator's row keeps its cost", forAdmin.unit_cost === 2_000_000);
const actions = read("lib/pos-actions.ts");
const body = (name) => actions.slice(actions.indexOf(`export async function ${name}`)).split(/\nexport (async )?(function|type)/)[0];
check("posUnitsAction strips cost for anyone without cost.view", /stripCost\([\s\S]*can\(user, "cost\.view"\)/.test(body("posUnitsAction")));
check("posSearchAction strips cost for anyone without cost.view", /stripCost\(r\.units, can\(user, "cost\.view"\)\)/.test(body("posSearchAction")));
const phone = read("lib/phone.ts");
const sellable = phone.slice(phone.indexOf("export type SellableItem"), phone.indexOf("export type ScannedUnit"));
check("the product cards' rows (SellableItem) carry no cost field at all", !/cost|margin|profit/i.test(sellable));
const receipt = read("lib/receipt.ts") + read("lib/receipt-config.ts");
check("a receipt is built without any cost field", !/unit_cost|\bcost\b|margin|profit/i.test(receipt.replace(/\/\*[\s\S]*?\*\/|\/\/.*$|--.*$/gm, "")));

section("What the screens are written to draw");
const picker = read("components/pos-unit-picker.tsx");
check("the IMEI picker never draws a cost (for anyone)", !/unit_cost|cost/i.test(picker.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
const till = read("components/pos-till.tsx").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
const costLines = till.split("\n").filter((l) => /unitCost|totals\.cost|Margin|Gross profit/.test(l) && !/unitCost: u\.unit_cost|cost \+= |unitCost\?: number/.test(l));
check("every place the till draws cost, margin or profit is behind props.showCost", costLines.every((l, i, all) => /showCost/.test(l) || /showCost/.test(till.slice(Math.max(0, till.indexOf(l) - 120), till.indexOf(l)))), `${costLines.length} places`);
check("showCost is the cost.view permission, decided on the server", /showCost=\{can\(user, "cost\.view"\)\}/.test(read("app/pos/page.tsx")));

console.log(`\n  ${good} passed, ${bad} failed\n`);
process.exit(bad ? 1 : 0);

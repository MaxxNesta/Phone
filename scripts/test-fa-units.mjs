// Asset units: shares that always add up to the group (lib/fa-units.ts). Pure: no database.
//   npx tsx scripts/test-fa-units.mjs
const { unitPlan, shareOut, unitSchedule, makesUnits } = await import("../lib/fa-units.ts");
const E = await import("../lib/fa-engine.ts");
let bad = 0;
const check = (label, ok, detail = "") => { if (!ok) bad++; console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? "  " + detail : ""}`); };
const K = (n) => E.toUnits(String(n));

const plan = unitPlan("FA-0004", "512975.0000", 3);
check("3 units, codes FA-0004-01 … -03", plan.map((u) => u.code).join() === "FA-0004-01,FA-0004-02,FA-0004-03");
check("costs 170,991.67 + 170,991.67 + 170,991.66", plan.map((u) => u.cost).join() === "170991.6700,170991.6700,170991.6600", plan.map((u) => u.cost).join());
check("they add up to the group cost", plan.reduce((t, u) => t + K(u.cost), 0n) === K("512975"));
check("one, or a fraction, makes no units", !makesUnits(1) && !makesUnits(2.5) && makesUnits(15));

// Every month's share adds up to the month, for awkward totals too.
const sim = unitPlan("SIM", "1000000.0000", 7).map((u) => K(u.cost));
const parts = shareOut(K("27778"), sim);
check("a month's 27,778 over 7 SIM cards adds up", parts.reduce((t, x) => t + x, 0n) === K("27778"), parts.map(E.fromUnits).join(" "));

// The whole life of the 15 chairs: each unit's months add up to the month, and each unit lands on zero.
const rows = E.schedule({ cost: K("2490000"), residual: 0n, lifeMonths: 36, inService: "2026-01-03", convention: "SAME_MONTH", startMonth: "2026-01" });
const chairs = unitPlan("FA-0009", "2490000.0000", 15).map((u) => K(u.cost));
const units = chairs.map((_, i) => unitSchedule(rows, chairs, i, K("2490000")));
let monthsAdd = true;
rows.forEach((r, m) => { if (units.reduce((t, u) => t + u[m].amount, 0n) !== r.amount) monthsAdd = false; });
check("every month, the 15 chairs add up to the group's depreciation", monthsAdd);
check("every chair ends on zero", units.every((u) => u.at(-1).closing === 0n), units.map((u) => E.fromUnits(u.at(-1).closing)).join(" "));
check("every chair's life adds up to its cost", units.every((u, i) => u.reduce((t, r) => t + r.amount, 0n) === chairs[i]));

console.log(bad ? `\n${bad} FAILED` : "\nfa-units: all good");
process.exit(bad ? 1 : 0);

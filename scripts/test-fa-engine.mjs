// The depreciation engine, by itself: no database.
//
//   npx tsx scripts/test-fa-engine.mjs
//
// Every schedule must land exactly on residual, never go below it, and spend
// exactly cost less residual (unless a disposal stops it early).

import assert from "node:assert/strict";
const E = await import("../lib/fa-engine.ts");
const K = (n) => BigInt(n) * 10_000n; // whole kyat → units
const show = (n) => Number(n / 10_000n);

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log(`  ok  ${name}`); };
const base = { cost: K(12_000_000), residual: K(600_000), lifeMonths: 60, inService: "2026-02-10", convention: "NEXT_MONTH" };
const lands = (rows, a) => {
  assert.equal(rows.at(-1).closing, a.residual, "ends on residual");
  assert.equal(E.sum(rows.map((r) => r.amount)), a.cost - a.residual, "spends cost less residual");
  for (const r of rows) assert.ok(r.closing >= r.residual, `${r.month} not below residual`);
};

t("straight line, next month: 60 equal months from March", () => {
  const rows = E.schedule(base);
  assert.equal(rows.length, 60);
  assert.equal(rows[0].month, "2026-03");
  assert.equal(rows.at(-1).month, "2031-02");
  for (const r of rows) assert.equal(r.amount, K(190_000));
  lands(rows, base);
});

t("same month starts in the in-service month", () => {
  const rows = E.schedule({ ...base, convention: "SAME_MONTH" });
  assert.equal(rows[0].month, "2026-02");
  assert.equal(rows.length, 60);
  lands(rows, { ...base });
});

t("daily: first month by days left, a short month after the life", () => {
  const a = { ...base, convention: "DAILY" };                 // 10 Feb: 19 of 28 days
  const rows = E.schedule(a);
  assert.equal(rows.length, 61);
  assert.equal(rows[0].month, "2026-02");
  assert.equal(rows[0].amount, K(128_929));                  // 190,000 × 19/28 = 128,928.57
  assert.equal(rows[1].amount, K(190_000));
  assert.equal(rows.at(-1).month, "2031-02");
  lands(rows, a);
});

t("rounding: an amount that does not divide lands exactly with the last month", () => {
  const a = { ...base, cost: K(1_000_000), residual: 0n, lifeMonths: 3 };
  const rows = E.schedule(a);
  assert.deepEqual(rows.map((r) => show(r.amount)), [333_333, 333_334, 333_333]);
  lands(rows, a);
});

t("rounding to whole kyat never leaves a fraction behind", () => {
  const a = { ...base, cost: E.toUnits("999999.99"), residual: E.toUnits("0.5"), lifeMonths: 7 };
  const rows = E.schedule(a);
  for (const r of rows.slice(0, -1)) assert.equal(r.amount % 10_000n, 0n);
  lands(rows, a);
});

t("residual equal to cost: nothing to depreciate", () => {
  assert.equal(E.schedule({ ...base, residual: base.cost }).length, 0);
});

t("not in service: no schedule", () => {
  assert.equal(E.schedule({ ...base, inService: null }).length, 0);
});

t("useful life completes: nothing after the last month", () => {
  const rows = E.schedule({ ...base, lifeMonths: 12 });
  assert.equal(rows.length, 12);
  assert.equal(rows.at(-1).month, "2027-02");
});

t("change of estimate is prospective: the rest of the life absorbs it", () => {
  // After 12 months (NBV 9,720,000), the life becomes 36 months in total and the residual 0.
  const estimates = [{ from: "2027-03", lifeMonths: 36, residual: 0n }];
  const rows = E.schedule(base, { estimates });
  const before = rows.filter((r) => r.month < "2027-03");
  assert.equal(before.length, 12);
  for (const r of before) assert.equal(r.amount, K(190_000), "history is not redone");
  const after = rows.filter((r) => r.month >= "2027-03");
  assert.equal(after.length, 24);                            // 36 − 12 months left
  assert.equal(after[0].amount, K(405_000));                 // 9,720,000 / 24
  assert.equal(rows.at(-1).closing, 0n);
});

t("a new life already run out: the remainder goes in the month of the change", () => {
  const rows = E.schedule(base, { estimates: [{ from: "2027-03", lifeMonths: 6, residual: K(600_000) }] });
  const m = rows.find((r) => r.month === "2027-03");
  assert.equal(m.amount, K(9_120_000));                     // 9,720,000 − 600,000
  assert.equal(rows.at(-1).month, "2027-03");
  assert.equal(rows.at(-1).closing, K(600_000));
});

t("historical posting of another amount: later months absorb the difference", () => {
  const posted = new Map([["2026-03", K(250_000)], ["2026-04", K(250_000)]]);
  const rows = E.schedule(base, { posted });
  assert.equal(rows[0].state, "POSTED");
  assert.equal(rows[0].amount, K(250_000));
  assert.equal(rows[2].state, "PLANNED");
  assert.equal(rows[2].amount, K(187_931));                 // 10,900,000 / 58 = 187,931.03
  lands(rows, base);
});

t("a correction (negative) is part of the month's posted figure", () => {
  const posted = new Map([["2026-03", K(190_000)], ["2026-04", K(190_000 - 10_000)]]);
  const rows = E.schedule(base, { posted });
  assert.equal(rows[1].amount, K(180_000));
  lands(rows, base);
});

t("never below residual, even when history over-posted", () => {
  const posted = new Map([["2026-03", K(11_400_000)]]);   // the whole base in one month
  const rows = E.schedule(base, { posted });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].closing, K(600_000));
});

t("disposal cutoff, next month: nothing in or after the month of disposal", () => {
  const a = { ...base, disposedOn: "2026-08-20" };
  const rows = E.schedule(a);
  assert.equal(rows.at(-1).month, "2026-07");
  assert.equal(rows.length, 5);
  for (const r of rows) assert.equal(r.amount, K(190_000), "earlier months are not accelerated");
});

t("disposal cutoff, same month: includes the month of disposal", () => {
  const rows = E.schedule({ ...base, convention: "SAME_MONTH", disposedOn: "2026-08-20" });
  assert.equal(rows.at(-1).month, "2026-08");
  assert.equal(rows.at(-1).amount, K(190_000));
});

t("disposal cutoff, daily: the days held in the month of disposal", () => {
  const rows = E.schedule({ ...base, convention: "DAILY", disposedOn: "2026-08-15" });
  const last = rows.at(-1);
  assert.equal(last.month, "2026-08");
  // 15 of 31 days of August: 190,000 × 15/31 = 91,935.48
  assert.equal(last.amount, K(91_935));
});

t("backdated acquisition: the schedule starts in the past", () => {
  const rows = E.schedule({ ...base, inService: "2023-05-01" });
  assert.equal(rows[0].month, "2023-06");
  lands(rows, base);
});

t("opening balance: months before it are carried, depreciation runs from the month after", () => {
  // In service 2023-05, books open April 2025 with 23 months (Jun 2023 – Apr 2025) carried as one figure.
  const a = { ...base, inService: "2023-05-10" };
  const posted = new Map([["2025-04", K(190_000 * 23)]]);
  const rows = E.schedule(a, { posted, openingThrough: "2025-04" });
  const before = rows.filter((r) => r.month < "2025-04");
  assert.ok(before.every((r) => r.state === "POSTED" && r.amount === 0n), "carried, not owed");
  assert.equal(rows.find((r) => r.month === "2025-04").amount, K(4_370_000));
  assert.equal(rows.find((r) => r.month === "2025-05").amount, K(190_000));
  lands(rows, a);
});

t("decimal strings round-trip exactly", () => {
  assert.equal(E.toUnits("1250000"), 12_500_000_000n);
  assert.equal(E.toUnits("0.0001"), 1n);
  assert.equal(E.fromUnits(12_500_005_000n), "1250000.5000");
  assert.equal(E.fromUnits(-1n), "-0.0001");
  assert.throws(() => E.toUnits("12,000"));
});

t("month arithmetic across years", () => {
  assert.equal(E.addMonths("2026-11", 3), "2027-02");
  assert.equal(E.addMonths("2026-01", -1), "2025-12");
  assert.equal(E.monthsBetween("2026-11", "2027-02"), 3);
});

console.log(`\nfa-engine: ${passed} passed`);

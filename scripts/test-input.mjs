// Server-side form reading: text limits, numbers, dates and ids.
//
//   npx tsx scripts/test-input.mjs
import assert from "node:assert/strict";
import { str, num, date, id, cleanNum, TEXT_MAX } from "../lib/input.ts";

const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

assert.equal(str(fd({ a: "  hi \u0000there\u0007 " }), "a"), "hi there");
assert.equal(str(fd({}), "a"), "");
assert.equal(str(fd({ a: "line one\nline two" }), "a"), "line one\nline two");
assert.throws(() => str(fd({ a: "x".repeat(TEXT_MAX + 1) }), "a"), /too long/);
assert.throws(() => str(fd({ a: "abcd" }), "a", 3), /too long/);
assert.throws(() => str(fd({ a: new File(["x"], "x.txt") }), "a"), /got a file/);

assert.equal(num(fd({ n: "" }), "n"), 0);
assert.equal(num(fd({ n: "1,250.5" }), "n"), 1250.5);
assert.equal(num(fd({ n: "-3" }), "n"), -3);
assert.throws(() => num(fd({ n: "abc" }), "n"), /must be a number/);
assert.throws(() => num(fd({ n: "Infinity" }), "n"), /must be a number/);
assert.throws(() => num(fd({ n: "1e20" }), "n"), /too large/);
assert.equal(cleanNum(7), 7);

assert.equal(date(fd({ d: "2026-02-28" }), "d"), "2026-02-28");
assert.equal(date(fd({ d: "" }), "d"), "");
assert.throws(() => date(fd({ d: "2026-02-30" }), "d"), /not a real date/);
assert.throws(() => date(fd({ d: "13/11/2026" }), "d"), /YYYY-MM-DD/);

assert.equal(id(fd({ i: "3d322187-ea6a-4ccd-b953-e34003a9c1cc" }), "i"), "3d322187-ea6a-4ccd-b953-e34003a9c1cc");
assert.throws(() => id(fd({ i: "1 or 1=1" }), "i"), /not a valid id/);
console.log("input: all pass");

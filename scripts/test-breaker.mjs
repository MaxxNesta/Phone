// The circuit breaker: opens after a run of failures, fails fast while open,
// lets one trial through after the cool-down, and closes on success.
//
//   npx tsx scripts/test-breaker.mjs
import assert from "node:assert/strict";
import { breaker, CircuitOpenError } from "../lib/breaker.ts";

let t = 0;
const call = breaker("R2", { failures: 3, coolMs: 1000, now: () => t });
const fail = () => Promise.reject(new Error("down"));
const ok = () => Promise.resolve("up");
let hits = 0;
const counted = (fn) => () => { hits++; return fn(); };

for (let i = 0; i < 3; i++) await assert.rejects(call(counted(fail)), /down/);
assert.equal(hits, 3);
// Open: refused without touching the service.
await assert.rejects(call(counted(ok)), CircuitOpenError);
assert.equal(hits, 3);
// After the cool-down, one trial; a failure opens it again at once.
t = 1000;
await assert.rejects(call(counted(fail)), /down/);
assert.equal(hits, 4);
await assert.rejects(call(counted(ok)), CircuitOpenError);
// Next trial succeeds and closes it.
t = 2000;
assert.equal(await call(counted(ok)), "up");
assert.equal(await call(counted(ok)), "up");
assert.equal(hits, 6);
// A success resets the run: two failures do not open it.
await assert.rejects(call(fail), /down/);
await assert.rejects(call(fail), /down/);
assert.equal(await call(ok), "up");
console.log("breaker: all pass");

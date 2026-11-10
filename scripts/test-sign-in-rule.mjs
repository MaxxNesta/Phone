// Sign-in fails closed once the developer switch is on (lib/features.ts).
//   npx tsx --env-file=.env scripts/test-sign-in-rule.mjs
import assert from "node:assert/strict";
const { signInRule } = await import("../lib/auth-core.ts");

// Switch off (testing period): off, unless a test asks for it on.
assert.equal(signInRule(false, {}), false);
assert.equal(signInRule(false, { AUTH_REQUIRED: "true" }), true);
// Switch on: on whatever is missing or mistyped.
assert.equal(signInRule(true, {}), true);
assert.equal(signInRule(true, { AUTH_REQUIRED: "false" }), true);
assert.equal(signInRule(true, { AUTH_REQUIRED: "" }), true);
assert.equal(signInRule(true, { AUTH_DISABLED: "1" }), true);
assert.equal(signInRule(true, { AUTH_DISABLED: "TRUE" }), true);
// Production can never switch it off.
assert.equal(signInRule(true, { AUTH_DISABLED: "true", VERCEL_ENV: "production" }), true);
// Outside production, only on purpose.
assert.equal(signInRule(true, { AUTH_DISABLED: "true", VERCEL_ENV: "preview" }), false);
assert.equal(signInRule(true, { AUTH_DISABLED: "true" }), false);
console.log("PASS sign-in rule: 10 checks");

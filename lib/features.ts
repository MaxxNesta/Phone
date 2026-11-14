/**
 * Sales orders and deliveries in a retail shop: a developer switch, never a
 * setting in the app. Change the constant and redeploy.
 *
 *   true  — the Sales menu shows Sales orders, Deliveries and Shipped not
 *           invoiced, and a sales invoice offers every fulfilment choice:
 *           customer takes now, we deliver now, deliver later, already
 *           delivered.
 *   false — counter only (the default, 2026-11-07): those menu items are hidden
 *           and every invoice hands the goods over itself (one document).
 *
 * Both settings post correctly, so flipping it needs no recheck: sales and
 * cost of sales are recognised on the invoice either way, including deliver
 * later (migration 0178). scripts/check-delivery-entries.mjs proves the
 * entries. A wholesale company (retail_mode off) always has them.
 */
export const ORDERS_AND_DELIVERIES = false;

export function ordersAndDeliveriesOn(company: { retail_mode?: boolean | null } | null | undefined) {
  return !company?.retail_mode || ORDERS_AND_DELIVERIES;
}

/**
 * Sign-in, as a developer switch (2026-11-10). Off while the owner tests:
 * everyone acts as the owner, an administrator. Turn it on when the owner
 * says "ready" — change the constant and redeploy.
 *
 * Once on, it fails closed: a missing or mistyped environment variable can no
 * longer switch sign-in off in production. Only a run outside production
 * (local, test suites) may switch it off, and only on purpose, with
 * AUTH_DISABLED=true. AUTH_REQUIRED=true still turns it on while this is off,
 * for testing the signed-in app (scripts/check-http-roles.mjs).
 *
 * Before turning it on: the owner sets their own password in Settings → Users
 * while sign-in is still off, so the first sign-in is theirs.
 *
 * STATUS (2026-11-10): sign-in is TESTED and works; it is OFF ON PURPOSE so
 * the owner can test without accounts. Not forgotten, not broken.
 *   tested   scripts/check-http-roles.mjs, 53 checks against a production
 *            build with sign-in on: every role, branch and cost restriction,
 *            refused document URLs and exports; scripts/test-sign-in-rule.mjs
 *            (fails closed in every combination); scripts/test-price-guard.mjs.
 *   turn on  when the owner says "ready": set this to true and redeploy.
 */
// ON since 2026-11-14 (owner's go-ahead). Test accounts with known passwords
// for DEV: scripts/test-accounts.mjs (re-run it to reset them).
export const SIGN_IN_REQUIRED = true;

/**
 * What a company has switched on (0200: company.features). Set per company by
 * the provider — scripts/set-package.mjs now, the console later — never a
 * constant here, so one codebase serves phone shops, counter shops and
 * distributors alike.
 *
 *   serialTracking    IMEI and serial numbers. Absent means on: every shop so
 *                     far sells phones. Off hides the IMEI menus, the product
 *                     tracking choice and the phone tiles; products are then
 *                     counted, not named.
 *   ordersDeliveries  Sales orders, deliveries and deliver-later. Absent means
 *                     the old rule: on for a wholesale company, off at retail.
 *                     Off: every invoice hands the goods over itself. Both post
 *                     correctly (0178; scripts/check-delivery-entries.mjs).
 */
export type CompanyFeatures = { serial_tracking?: boolean; orders_deliveries?: boolean; unit_packs?: boolean };
type HasFeatures = { retail_mode?: boolean | null; features?: CompanyFeatures | null } | null | undefined;

export function serialTrackingOn(company: HasFeatures) {
  return company?.features?.serial_tracking ?? true;
}

/* Spare parts (0213) are no longer a switch (2026-11-24): part numbers are on
   for every company; a phone shop simply leaves them empty. */

/**
 * Packs and unit conversion (2026-11-24): the shop's own choice, under
 * Settings → Units, not the console's. Absent: on for a wholesale company,
 * off at retail. A product that already has packs shows them either way.
 */
export function unitPacksOn(company: HasFeatures) {
  return company?.features?.unit_packs ?? !company?.retail_mode;
}

export function ordersAndDeliveriesOn(company: HasFeatures) {
  return company?.features?.orders_deliveries ?? !company?.retail_mode;
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

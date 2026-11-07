/**
 * Sales orders and deliveries in a retail shop: a developer switch, never a
 * setting in the app. Change the constant and redeploy.
 *
 *   true  — the Sales menu shows Sales orders, Deliveries and Shipped not
 *           invoiced, and a sales invoice offers every fulfilment choice:
 *           customer takes now, we deliver now, deliver later, already
 *           delivered.
 *   false — counter only, as before 2026-11-07: those menu items are hidden
 *           and every invoice hands the goods over itself (one document).
 *
 * Both settings post correctly, so flipping it needs no recheck: sales and
 * cost of sales are recognised on the invoice either way, including deliver
 * later (migration 0178). scripts/check-delivery-entries.mjs proves the
 * entries. A wholesale company (retail_mode off) always has them.
 */
export const ORDERS_AND_DELIVERIES = true;

export function ordersAndDeliveriesOn(company: { retail_mode?: boolean | null } | null | undefined) {
  return !company?.retail_mode || ORDERS_AND_DELIVERIES;
}

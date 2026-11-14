-- An accounting seat.
--
-- A module seat sees only its own module (lib/plans.ts hasModule): a Sales
-- seat sees sales and the counter, an Inventory seat stock, a Purchases seat
-- purchases, and now an Accounting seat the accounting menu, its financial
-- statements following the company's package. It holds the Accountant role.
alter table app_user drop constraint if exists app_user_seat_check;
alter table app_user add constraint app_user_seat_check
  check (seat in ('package', 'sales', 'purchases', 'inventory', 'accounting'));

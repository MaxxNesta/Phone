-- Seats by module, and a purchaser.
--
-- A seat is a person who can sign in. A package seat (0196) can hold any
-- role. A module seat is bought with the Sales, Purchases or Inventory module
-- and holds only that module's roles: Sales a cashier or salesperson,
-- Purchases a purchaser, Inventory an inventory clerk. lib/plans.ts
-- SEAT_ROLES names them; saveUser refuses a role outside the person's seat.
--
-- Everyone who exists today is on a package seat.

alter table app_user drop constraint if exists app_user_role_check;
alter table app_user add constraint app_user_role_check
  check (role in ('ADMIN', 'MANAGER', 'CASHIER', 'SALESPERSON', 'INVENTORY', 'ACCOUNTANT', 'PURCHASER'));

alter table app_user
  add column if not exists seat text not null default 'package'
    check (seat in ('package', 'sales', 'purchases', 'inventory'));

alter table company
  add column if not exists module_seats jsonb not null default '{}'::jsonb;

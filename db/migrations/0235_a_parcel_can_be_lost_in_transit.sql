-- A parcel can be lost in transit (0235).
--
-- A COD parcel that never arrives and never comes back is closed by writing
-- its phones off the Out for delivery bin at their cost (a stock adjustment
-- naming the invoice), charged to whoever bears the loss: the shop
-- (Inventory Damage), the driver (Cash with Drivers, so the driver owes it)
-- or the courier (COD Receivable under the courier). Nothing was billed, so
-- the customer owes nothing, and the invoice can be dispatched again.

alter table dispatch_event drop constraint if exists dispatch_event_kind_check;
alter table dispatch_event add constraint dispatch_event_kind_check
    check (kind in ('NOT_HOME', 'REFUSED', 'RETURNED', 'HANDED_OVER', 'DELIVERED', 'LOST'));

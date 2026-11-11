-- Replenishment planning settings, the ones a buyer actually sets.
--
-- item_reorder (per item and stock location) gains how the item is planned
-- and a fixed safety stock where somebody wants one:
--
--   AUTO    reorder point and order-up-to are worked out from what sells,
--           how much that varies, and the lead time; min_qty, if set, is
--           a floor under the reorder point
--   MINMAX  below min_qty, order up to max_qty — the rule for things that
--           sell too rarely for a rate to mean anything
--   MANUAL  never suggested; somebody buys it by hand
--
-- safety_qty null means "work it out from demand"; a number overrides it.
--
-- supplier_item (per item and supplier) gains the two buying constraints
-- that belong to the supplier rather than the shop: the least they will
-- sell, and the pack it comes in. A suggestion is rounded up to both.

alter table item_reorder
  add column if not exists method text not null default 'AUTO',
  add column if not exists safety_qty numeric(18,4);

alter table item_reorder drop constraint if exists item_reorder_method_known;
alter table item_reorder add constraint item_reorder_method_known
  check (method in ('AUTO', 'MINMAX', 'MANUAL'));
alter table item_reorder drop constraint if exists item_reorder_quantities_sane;
alter table item_reorder add constraint item_reorder_quantities_sane
  check ((min_qty is null or min_qty >= 0)
     and (max_qty is null or max_qty >= 0)
     and (safety_qty is null or safety_qty >= 0)
     and (min_qty is null or max_qty is null or max_qty >= min_qty));

alter table supplier_item
  add column if not exists moq numeric(18,4),
  add column if not exists order_multiple numeric(18,4);

alter table supplier_item drop constraint if exists supplier_item_buying_sane;
alter table supplier_item add constraint supplier_item_buying_sane
  check ((moq is null or moq > 0) and (order_multiple is null or order_multiple > 0));

comment on column item_reorder.method is
  'AUTO: planned from demand, variability and lead time. MINMAX: below min, order up to max. MANUAL: never suggested.';
comment on column item_reorder.safety_qty is
  'Fixed safety stock. Null: worked out from demand variability and lead time at the item''s service level.';
comment on column supplier_item.moq is 'Least this supplier sells of this item in one order.';
comment on column supplier_item.order_multiple is 'The pack size: orders are rounded up to a multiple of this.';

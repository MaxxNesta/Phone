-- Bulk delete hid items it could not delete, including ones still holding
-- stock: the units dropped out of every list while their value stayed on the
-- balance sheet. An item with stock on hand is never inactive, nor is the
-- model above it. Bulk delete now leaves such items alone; this puts back
-- any it already hid.

update item i set is_active = true
 where not i.is_active
   and exists (select 1 from v_stock_on_hand v where v.item_id = i.id and v.qty_on_hand <> 0);

update item p set is_active = true
 where not p.is_active
   and exists (select 1 from item c where c.parent_item_id = p.id and c.is_active
                 and exists (select 1 from v_stock_on_hand v where v.item_id = c.id and v.qty_on_hand <> 0));

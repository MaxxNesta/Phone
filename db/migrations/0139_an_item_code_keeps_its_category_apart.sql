-- An item's code keeps its category apart from its own piece
--
-- Code was the category's code with the item's piece appended, so category 1
-- + item 23 and category 12 + item 3 both came out 123. The unique key on
-- (company, code) refused the second, but as a confusing "already used" for
-- a code nobody had typed. A hyphen between the two makes them 1-23 and 12-3.
--
-- A category code that already ends in a separator (- . _ /) or is empty gets
-- no second hyphen. Existing items are recomposed once; their barcodes, stock
-- and history are untouched, only the printed code changes.

create or replace function fn_set_item_code() returns trigger
language plpgsql as $$
declare
    v_group text;
begin
    select code into v_group from item_group where id = new.item_group_id;
    v_group := coalesce(v_group, '');
    new.code := v_group
             || case when v_group = '' or v_group ~ '[-._/]$' then '' else '-' end
             || new.serial;
    return new;
end;
$$;

update item set serial = serial;

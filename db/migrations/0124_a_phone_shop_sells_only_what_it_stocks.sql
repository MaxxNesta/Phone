-- A phone shop sells phones and accessories, all of them on a shelf. A
-- retail company's items are therefore always stocked: the form no longer
-- offers the switch, and this makes sure no other path (quick add, import,
-- an edit) can save a "service" item behind it.

create or replace function fn_item_retail_stocked() returns trigger
language plpgsql as $$
begin
    if not new.is_stocked
       and exists (select 1 from company c where c.id = new.company_id and c.retail_mode) then
        new.is_stocked := true;
    end if;
    return new;
end $$;

drop trigger if exists item_retail_stocked on item;
create trigger item_retail_stocked
    before insert or update of is_stocked on item
    for each row execute function fn_item_retail_stocked();

update item i set is_stocked = true
  from company c
 where c.id = i.company_id and c.retail_mode and not i.is_stocked;

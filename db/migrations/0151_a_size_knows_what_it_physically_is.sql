-- A size knows what it physically is
--
-- A shop with history keeps two Size values, 42MM and 42, because its old
-- variant names used both. The display value stays as typed — it is what the
-- names were built from — and beside it each value now stores what it
-- physically is: 42mm for both. Similar-variant detection and the reports
-- compare that, never the display text.
--
-- Filled automatically: lower case, spaces and punctuation dropped, the unit
-- written one way (mm, cm, in, gb, tb). A bare number takes the unit of a
-- value in the same attribute with the same number, so 42 beside 42MM is
-- 42mm. Somebody can set it by hand on the Variant attributes page
-- (physical_is_manual), and then it is left alone.

alter table variant_option add column if not exists physical_value text;
alter table variant_option add column if not exists physical_is_manual boolean not null default false;
comment on column variant_option.physical_value is
    'What the value physically is (42mm), whatever it is called (42, 42MM). '
    'Variants whose values match here are the same configuration.';

/** One spelling for a value: 42 MM, 42mm and 42-mm are 42mm; 11-inch is 11in. */
create or replace function fn_variant_value_canon(p text) returns text
language sql immutable as $$
    select regexp_replace(
             regexp_replace(
               regexp_replace(lower(coalesce(p, '')), '[^a-z0-9.]', '', 'g'),
               '^([0-9]+(\.[0-9]+)?)(inches|inch)$', '\1in'),
             '^([0-9]+(\.[0-9]+)?)(millimetres|millimeters|millimetre|millimeter)$', '\1mm')
$$;

/**
 * What a value of this attribute physically is: its own spelling, or, for a
 * bare number, the unit another value of the attribute gives that number.
 */
create or replace function fn_variant_physical(p_attribute uuid, p_name text, p_self uuid default null)
returns text language sql stable as $$
    with me as (select fn_variant_value_canon(p_name) as v)
    select case
             when me.v ~ '^[0-9]+(\.[0-9]+)?$' then coalesce((
               select fn_variant_value_canon(o.name) from variant_option o
                where o.attribute_id = p_attribute and o.id is distinct from p_self
                  and fn_variant_value_canon(o.name) ~ ('^' || replace(me.v, '.', '\.') || '[a-z]+$')
                order by o.sort_order, o.name limit 1), me.v)
             else me.v
           end
      from me
$$;

create or replace function fn_variant_option_physical() returns trigger
language plpgsql as $$
begin
    if new.physical_is_manual and coalesce(btrim(new.physical_value), '') <> '' then
        new.physical_value := fn_variant_value_canon(new.physical_value);
    else
        new.physical_is_manual := false;
        new.physical_value := fn_variant_physical(new.attribute_id, new.name, new.id);
    end if;
    return new;
end $$;

drop trigger if exists variant_option_physical on variant_option;
create trigger variant_option_physical
    before insert or update of name, physical_value, physical_is_manual on variant_option
    for each row execute function fn_variant_option_physical();

-- A value with a unit, added after the bare one: 42MM arriving next to 42
-- tells the 42 what it was. Bare siblings with the same number follow.
create or replace function fn_variant_option_siblings() returns trigger
language plpgsql as $$
begin
    if pg_trigger_depth() > 1 then return null; end if;
    update variant_option o
       set physical_value = fn_variant_physical(o.attribute_id, o.name, o.id)
     where o.attribute_id = new.attribute_id and o.id <> new.id and not o.physical_is_manual
       and fn_variant_value_canon(o.name) ~ '^[0-9]+(\.[0-9]+)?$';
    return null;
end $$;

drop trigger if exists variant_option_siblings on variant_option;
create trigger variant_option_siblings
    after insert or update of name on variant_option
    for each row execute function fn_variant_option_siblings();

-- Every value there is, valued once.
update variant_option o set physical_value = fn_variant_physical(o.attribute_id, o.name, o.id)
 where not o.physical_is_manual;

alter table variant_option alter column physical_value set not null;

-- The configuration key reads the stored value now.
create or replace view v_item_physical as
with keyed as (
    select i.id as item_id, i.company_id, i.code, i.parent_item_id,
           i.parent_item_id::text || '|' || string_agg(
               o.attribute_id::text || '=' || o.physical_value, ';'
               order by o.attribute_id::text) as physical_key
      from item i
      join item_variant_option ivo on ivo.item_id = i.id
      join variant_option o on o.id = ivo.option_id
     where i.parent_item_id is not null
     group by i.id
)
select k.item_id, k.company_id, k.parent_item_id, k.physical_key,
       first_value(k.item_id) over w as canonical_item_id,
       count(*) over (partition by k.physical_key) as members
  from keyed k
window w as (partition by k.physical_key order by k.code, k.item_id);

drop function if exists fn_variant_value_norm(text);

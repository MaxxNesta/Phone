-- A variant can carry the code the shop gave it
--
-- Codes are composed: the category's code, a hyphen, the item's own piece
-- (0139), so a generated iPhone variant reads IPC-017-256-BK-CHA. A shop that
-- already numbers every variant by hand — IPC010 is the 256 GB black CH/A,
-- IPC011 the white — wants exactly that code on the shelf and the receipt,
-- not one built from parts.
--
-- code_is_manual says the serial is the whole code, typed by a person, and the
-- trigger copies it as it is (upper-cased) instead of composing. Everything
-- else about the item is unchanged; the unique (company, code) key still
-- refuses a code typed twice.

alter table item add column if not exists code_is_manual boolean not null default false;

comment on column item.code_is_manual is
    'True when serial holds the full item code as the shop typed it (IPC010); '
    'false when the code is composed from the category code and serial.';

create or replace function fn_set_item_code() returns trigger
language plpgsql as $$
declare
    v_group text;
begin
    if new.code_is_manual then
        new.code := upper(btrim(new.serial));
        return new;
    end if;
    select code into v_group from item_group where id = new.item_group_id;
    v_group := coalesce(v_group, '');
    new.code := v_group
             || case when v_group = '' or v_group ~ '[-._/]$' then '' else '-' end
             || new.serial;
    return new;
end;
$$;

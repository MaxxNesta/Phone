-- A Mac has a serial number, and a cable has neither.
--
-- "Track each unit" was yes or no, and yes meant IMEI. An Apple shop sells
-- three kinds of thing:
--
--   IMEI    iPhone, and the cellular iPad and Watch. Identified by IMEI;
--           IMEI 2 and the maker's serial are recorded beside it.
--   SERIAL  Mac, Wi-Fi iPad, AirPods. One unit, one serial number, no IMEI.
--           Sold, returned and warrantied exactly like a phone.
--   NONE    Cases, cables, chargers. Counted, never named.
--
-- item.identity says which. stock_serial.serial_no holds whichever identity
-- the unit has — the IMEI or the serial — so the engine, the till and the
-- warranty lookup are unchanged. tracks_serial stays, kept equal to
-- "identity is not NONE" by the trigger below, because the posting engine and
-- the test suites read and write it; either column can be set and the other
-- follows.
--
-- A category carries the default for new products in it: the category is the
-- type (iPhone, iPad, Mac…), and the type is what the clerk picks first.

alter table item_group
  add column if not exists identity text not null default 'NONE'
      check (identity in ('IMEI', 'SERIAL', 'NONE'));
comment on column item_group.identity is
    'How new products in this category are tracked: IMEI, SERIAL or NONE.';

alter table item
  add column if not exists identity text not null default 'NONE'
      check (identity in ('IMEI', 'SERIAL', 'NONE'));
comment on column item.identity is
    'IMEI, SERIAL (serial number, no IMEI) or NONE (quantity only). '
    'tracks_serial follows it.';

update item set identity = 'IMEI' where tracks_serial and identity = 'NONE';

create or replace function fn_item_identity_sync() returns trigger
language plpgsql as $$
begin
    if tg_op = 'INSERT' then
        if new.identity = 'NONE' and new.tracks_serial then
            new.identity := 'IMEI';
        end if;
    elsif new.identity is distinct from old.identity then
        null;
    elsif new.tracks_serial is distinct from old.tracks_serial then
        new.identity := case when new.tracks_serial
                             then case when old.identity = 'NONE' then 'IMEI' else old.identity end
                             else 'NONE' end;
    end if;
    new.tracks_serial := new.identity <> 'NONE';
    return new;
end $$;

drop trigger if exists item_identity_sync on item;
create trigger item_identity_sync
    before insert or update of identity, tracks_serial on item
    for each row execute function fn_item_identity_sync();

-- ------------------------------------------------- the Apple catalogue ----
--
-- Types as categories, each with its tracking; and the attributes Macs, iPads
-- and Watches vary by. Idempotent, and nothing a company already named is
-- duplicated: a category or attribute is matched by name (types) or code
-- (attributes) before it is added.

create or replace function fn_seed_apple_catalogue(p_company uuid) returns void
language plpgsql as $$
begin
    perform fn_seed_phone_attributes(p_company);

    -- The code is composed from the segment by trg_set_group_code.
    insert into item_group (company_id, segment, name, identity)
    select p_company, v.code, v.name, v.identity
      from (values ('IPH', 'iPhone', 'IMEI'), ('IPD', 'iPad', 'SERIAL'), ('MAC', 'Mac', 'SERIAL'),
                   ('AW', 'Apple Watch', 'SERIAL'), ('APD', 'AirPods', 'SERIAL'),
                   ('ACC', 'Accessories', 'NONE')) v(code, name, identity)
     where not exists (select 1 from item_group g
                        where g.company_id = p_company
                          and (g.code = v.code or (g.parent_id is null and lower(g.name) = lower(v.name))));

    insert into variant_attribute (company_id, code, name, sort_order)
    select p_company, v.code, v.name,
           coalesce((select max(sort_order) from variant_attribute where company_id = p_company), -1) + v.n
      from (values ('CON', 'Connectivity', 1), ('CHIP', 'Chip', 2), ('MEM', 'Memory', 3), ('SIZE', 'Size', 4))
           v(code, name, n)
     where not exists (select 1 from variant_attribute a where a.company_id = p_company and a.code = v.code);

    -- Options only for an attribute that has none yet: a list somebody has
    -- already started is theirs.
    insert into variant_option (company_id, attribute_id, code, name, sort_order)
    select p_company, a.id, o.code, o.name, o.n
      from variant_attribute a
      join (values
        ('CON', 'WF', 'Wi-Fi', 0), ('CON', 'CEL', 'Wi-Fi + Cellular', 1),
        ('CHIP', 'M3', 'M3', 0), ('CHIP', 'M4', 'M4', 1), ('CHIP', 'M4P', 'M4 Pro', 2), ('CHIP', 'M4X', 'M4 Max', 3),
        ('CHIP', 'M5', 'M5', 4), ('CHIP', 'M5P', 'M5 Pro', 5), ('CHIP', 'M5X', 'M5 Max', 6),
        ('MEM', '8', '8 GB', 0), ('MEM', '16', '16 GB', 1), ('MEM', '24', '24 GB', 2), ('MEM', '32', '32 GB', 3),
        ('MEM', '36', '36 GB', 4), ('MEM', '48', '48 GB', 5), ('MEM', '64', '64 GB', 6), ('MEM', '128', '128 GB', 7),
        ('SIZE', '11', '11-inch', 0), ('SIZE', '13', '13-inch', 1), ('SIZE', '14', '14-inch', 2),
        ('SIZE', '15', '15-inch', 3), ('SIZE', '16', '16-inch', 4), ('SIZE', '42', '42mm', 5),
        ('SIZE', '46', '46mm', 6), ('SIZE', '49', '49mm', 7)
      ) o(attr, code, name, n) on o.attr = a.code
     where a.company_id = p_company
       and not exists (select 1 from variant_option x where x.attribute_id = a.id);
end $$;

comment on function fn_seed_apple_catalogue(uuid) is
    'Apple product types (as categories, with tracking) and variant attributes. Idempotent.';

-- A category already named for phones is the iPhone type, and is IMEI.
update item_group set identity = 'IMEI'
 where parent_id is null and lower(name) in ('iphone', 'mobile phone', 'mobile phones', 'phone', 'phones');

select fn_seed_apple_catalogue(id) from company;

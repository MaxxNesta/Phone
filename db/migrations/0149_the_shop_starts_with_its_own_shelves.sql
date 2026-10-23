-- The shop starts with its own shelves
--
-- The categories and brands the shop actually sells, as master data every
-- database starts with — so a new company opens with iPhone, Android Phones,
-- iPad … Services & Charges, and nobody has to invent "Branch Test" or
-- "Void Test" categories to have somewhere to put a product.
--
-- Applied to existing companies without duplicating anything: a category is
-- matched by its code or its name (or a name it was known by — AirPods is now
-- Earbuds & Audio, Mac is MacBook) and brought to this code and name in place,
-- keeping its products. A category's tracking (IMEI, serial, quantity) is set
-- only while it has no products, so stock already received is never re-read
-- under a different rule. Brands are matched by code or name the same way.

create or replace function fn_seed_retail_catalogue(p_company uuid) returns void
language plpgsql as $$
declare
    c record;
    g uuid;
    b record;
begin
    for c in
        select * from (values
            ('IPH', 'iPhone',              'IMEI',   array['iphone']),
            ('AND', 'Android Phones',      'IMEI',   array['android phones', 'android phone', 'android']),
            ('IPD', 'iPad',                'SERIAL', array['ipad']),
            ('TAB', 'Android Tablets',     'SERIAL', array['android tablets', 'android tablet', 'tablets']),
            ('MAC', 'MacBook',             'SERIAL', array['macbook', 'mac']),
            ('LAP', 'Other Laptops',       'SERIAL', array['other laptops', 'laptops']),
            ('AW',  'Apple Watch',         'SERIAL', array['apple watch']),
            ('SWT', 'Other Smartwatches',  'SERIAL', array['other smartwatches', 'smartwatches']),
            ('AUD', 'Earbuds & Audio',     'SERIAL', array['earbuds & audio', 'airpods', 'audio', 'earbuds']),
            ('ACC', 'Accessories',         'NONE',   array['accessories']),
            ('FAN', 'Portable Fans',       'NONE',   array['portable fans', 'fans']),
            ('SIM', 'SIM Cards',           'NONE',   array['sim cards', 'sim']),
            ('SVC', 'Services & Charges',  'NONE',   array['services & charges', 'services'])
        ) as t(code, name, identity, known_as)
    loop
        -- Its own code first; otherwise a top category it used to be called.
        select id into g from item_group
         where company_id = p_company and parent_id is null and code = c.code;
        if g is null then
            select id into g from item_group
             where company_id = p_company and parent_id is null
               and (lower(name) = any(c.known_as) or (c.code = 'AUD' and code = 'APD'))
               and not exists (select 1 from item_group x
                                where x.company_id = p_company and x.code = c.code)
             order by (select count(*) from item i where i.item_group_id = item_group.id) desc
             limit 1;
        end if;

        if g is null then
            insert into item_group (company_id, segment, name, identity)
            values (p_company, c.code, c.name, c.identity);
        else
            update item_group set segment = c.code, name = c.name, is_active = true
             where id = g and (segment is distinct from c.code or name <> c.name or not is_active);
            update item_group set identity = c.identity
             where id = g and identity is distinct from c.identity
               and not exists (select 1 from item i where i.item_group_id = g);
        end if;
    end loop;

    for b in
        select * from (values
            ('APPLE', 'Apple'), ('SAMSUNG', 'Samsung'), ('NOTHING', 'Nothing'), ('LENOVO', 'Lenovo'),
            ('NESTA', 'NESTA'), ('ANKER', 'Anker'), ('MOPHIE', 'Mophie'), ('MOMAX', 'MOMAX'),
            ('JISULIFE', 'Jisulife'), ('MYTEL', 'Mytel')
        ) as t(code, name)
    loop
        if not exists (select 1 from brand
                        where company_id = p_company
                          and (upper(code) = b.code or lower(name) = lower(b.name))) then
            insert into brand (company_id, code, name) values (p_company, b.code, b.name);
        end if;
    end loop;
end $$;

comment on function fn_seed_retail_catalogue(uuid) is
    'The shop''s categories (IPH … SVC) and brands. Matches what exists by code or name; idempotent.';

select fn_seed_retail_catalogue(id) from company;

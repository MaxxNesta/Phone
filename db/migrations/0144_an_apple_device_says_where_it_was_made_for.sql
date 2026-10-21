-- An Apple device says which market it was made for.
--
-- The letters after an iPhone, iPad or MacBook's model number — LL/A, ZA/A —
-- say which country it was sold into, and with it the warranty, the SIM
-- arrangement and sometimes the charger in the box. Customers ask for it by
-- those letters, so it is a variant attribute like Storage and Colour
-- (0121): ticked on the products that vary by it, chosen per unit at the
-- till and on receipts, and edited under Settings > Catalogue > Variants.
--
-- Added to every company that has no Region attribute yet; one that already
-- named its own keeps it.

create or replace function fn_seed_apple_regions(p_company uuid) returns void
language plpgsql as $$
declare
    a uuid;
begin
    if exists (select 1 from variant_attribute where company_id = p_company and code = 'REG') then
        return;
    end if;
    insert into variant_attribute (company_id, code, name, sort_order)
    values (p_company, 'REG', 'Region',
            coalesce((select max(sort_order) + 1 from variant_attribute where company_id = p_company), 0))
    returning id into a;
    insert into variant_option (company_id, attribute_id, code, name, sort_order)
    select p_company, a, v.code, v.name, v.n
      from (values ('LLA',  'LL/A – USA',                0),
                   ('AEA',  'AE/A – UAE',                1),
                   ('ZAA',  'ZA/A – Singapore',          2),
                   ('ZPA',  'ZP/A – Hong Kong and Macau', 3),
                   ('JA',   'J/A – Japan',               4),
                   ('BA',   'B/A – UK',                  5),
                   ('CHA',  'CH/A – China',              6),
                   ('THA',  'TH/A – Thailand',           7)) v(code, name, n);
end $$;

comment on function fn_seed_apple_regions(uuid) is
    'Region variant attribute with Apple market codes (LL/A, ZA/A, ...). Idempotent.';

select fn_seed_apple_regions(id) from company;

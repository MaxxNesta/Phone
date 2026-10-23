-- An Android phone says its RAM
--
-- A Samsung or Xiaomi model is sold as 8 GB + 256 GB and 12 GB + 512 GB: the
-- RAM is part of the configuration the customer asks for. An iPhone is not —
-- Apple does not sell one model in two RAM sizes, so offering RAM there only
-- multiplies the catalogue by a choice nobody makes (0129 said the same of
-- Memory, which stays the Mac's).
--
-- So RAM is a variant attribute like Storage, and an attribute can now name
-- the brands it is not offered for. RAM is not offered for Apple.

alter table variant_attribute add column if not exists not_for_brands text[];

comment on column variant_attribute.not_for_brands is
    'Brand codes this attribute is not offered for (RAM is not for APPLE); null means every brand.';

create or replace function fn_seed_ram_attribute(p_company uuid) returns void
language plpgsql as $$
declare
    a uuid;
    after_storage int;
begin
    if exists (select 1 from variant_attribute where company_id = p_company and code = 'RAM') then
        return;
    end if;
    -- Straight after storage, as it is said: "8 GB + 256 GB".
    select min(sort_order) into after_storage from variant_attribute
     where company_id = p_company and (code = 'STO' or lower(name) in ('storage', 'capacity'));
    if after_storage is not null then
        update variant_attribute set sort_order = sort_order + 1
         where company_id = p_company and sort_order > after_storage;
    end if;
    insert into variant_attribute (company_id, code, name, sort_order, identities, not_for_brands)
    values (p_company, 'RAM', 'RAM',
            coalesce(after_storage + 1,
                     (select max(sort_order) + 1 from variant_attribute where company_id = p_company), 0),
            '{IMEI,SERIAL}', '{APPLE}')
    returning id into a;
    insert into variant_option (company_id, attribute_id, code, name, sort_order)
    select p_company, a, v.code, v.name, v.n
      from (values ('3', '3 GB', 0), ('4', '4 GB', 1), ('6', '6 GB', 2), ('8', '8 GB', 3),
                   ('12', '12 GB', 4), ('16', '16 GB', 5), ('24', '24 GB', 6)) v(code, name, n);
end $$;

comment on function fn_seed_ram_attribute(uuid) is
    'RAM variant attribute for Android phones and tablets, not offered for Apple. Idempotent.';

select fn_seed_ram_attribute(id) from company;

-- A phone shop on this system sells Apple. Every company has the brand, and
-- a retail company's products carry it unless someone chose otherwise.
-- Adding another brand is the owner's call (brands.manage), confirmed twice.

insert into brand (company_id, code, name)
select c.id, 'APPLE', 'Apple' from company c
 where not exists (select 1 from brand b where b.company_id = c.id and (b.code = 'APPLE' or lower(b.name) = 'apple'))
on conflict (company_id, code) do nothing;

update item i set brand_id = b.id
  from company c, brand b
 where c.id = i.company_id and c.retail_mode and i.brand_id is null
   and b.company_id = c.id and (b.code = 'APPLE' or lower(b.name) = 'apple');

-- A region reads before the colour
--
-- Variant attributes are read in their sort order — in the chips, the preview
-- columns and the variant's name. Region was added last (0144), so an iPhone
-- read "256 GB / Black / LL/A". The shop reads it storage, region, colour:
-- "256 GB / LL/A / Black". Region is moved to sit straight after storage,
-- and everything after it moves down one; the rest keep their order.
--
-- Names of variants already created are not rewritten: a name is what was
-- printed on receipts, and the order only changes how new ones are named.

with storage as (
    select company_id, min(sort_order) as at
      from variant_attribute
     where code = 'STO' or lower(name) in ('storage', 'capacity')
     group by company_id
),
ranked as (
    select a.id,
           row_number() over (
               partition by a.company_id
               order by case when a.code = 'REG' and s.at is not null then s.at + 0.5
                             else a.sort_order end,
                        a.name) - 1 as n
      from variant_attribute a
      left join storage s on s.company_id = a.company_id
)
update variant_attribute a set sort_order = r.n
  from ranked r
 where r.id = a.id and a.sort_order is distinct from r.n;

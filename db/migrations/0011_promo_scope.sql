-- 0011_promo_scope.sql
-- Scope the demo buy-10-get-1 promotion, and backfill the free-of-charge
-- reasons that 0010 did not create.
--
-- 0010's backfill inserted PROMO-B10G1 with neither an item nor an item
-- group, which the voucher reads as "every item in the catalogue". That is a
-- legitimate thing to want, but it was not what the demo data meant.

do $$
declare
    c   record;
    bev uuid;
begin
    for c in select id from company loop
        select id into bev from item_group
         where company_id = c.id and code = 'BEV' limit 1;

        if bev is not null then
            update promotion
               set item_group_id = bev
             where company_id = c.id
               and code = 'PROMO-B10G1'
               and item_id is null
               and item_group_id is null;
        end if;

        -- Reasons stock can leave without being sold. Each maps to the
        -- account its cost should land in, so a giveaway is visible instead
        -- of quietly eroding gross margin.
        insert into foc_reason (company_id, code, name, name_my, account_id)
        select c.id, r.code, r.name, r.name_my, a.id
          from (values
              ('PROMOTION', 'Promotional giveaway', 'ကြော်ငြာအတွက်', '6100'),
              ('SAMPLE',    'Customer sample',      null,            '6100'),
              ('OFFICE',    'Office use',           null,            '6100'),
              ('DAMAGED',   'Damaged or expired',   null,            '5300')
          ) as r(code, name, name_my, acct)
          join account a on a.company_id = c.id and a.code = r.acct
         where not exists (
              select 1 from foc_reason f
               where f.company_id = c.id and f.code = r.code
         );
    end loop;
end
$$;

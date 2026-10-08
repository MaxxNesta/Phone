-- A retail company's "sale price" was filed under the first price level by
-- sort order, which setup names Wholesale, while the POS and the sales
-- invoice read Retail. Every price typed on a product therefore showed as
-- "No price" at the counter. The code now files it under Retail; this copies
-- what was already typed, for items with no retail price of their own.
-- Additive only: nothing is changed or removed.

insert into item_price (company_id, item_id, price_level_id, uom_id, currency, price, valid_from)
select ip.company_id, ip.item_id, r.id, ip.uom_id, ip.currency, ip.price, ip.valid_from
  from item_price ip
  join company c on c.id = ip.company_id and c.retail_mode
  join price_level r on r.company_id = ip.company_id and r.code = 'RETAIL'
 where ip.price_level_id <> r.id
   and not exists (select 1 from item_price x
                    where x.item_id = ip.item_id and x.price_level_id = r.id)
on conflict do nothing;

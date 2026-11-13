-- Today is asked of the shop, not the server.
--
-- 0192 set the database's time zone, which direct connections honour. The
-- pooled endpoint the app uses does not: PgBouncer gives every client its own
-- default (GMT) and drops a client's TimeZone, so current_date there is still
-- UTC's day — yesterday in Yangon until 06:30.
--
-- fn_shop_today() answers the question without depending on the session, and
-- everything that meant "the shop's today" asks it instead: the open-item and
-- aging views below, the price list's default start date, and the app's own
-- queries (lib/, app/). New SQL should use it rather than current_date.

create or replace function fn_shop_today() returns date
  language sql stable parallel safe
  as $$ select (now() at time zone 'Asia/Yangon')::date $$;

-- Every view whose definition reads CURRENT_DATE, rewritten in place to ask
-- the function instead. Same columns, same everything else.
do $$
declare v record;
begin
  for v in
    select c.oid, n.nspname, c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind = 'v' and n.nspname = 'public'
       and pg_get_viewdef(c.oid) ilike '%current_date%'
  loop
    execute format('create or replace view %I.%I as %s', v.nspname, v.relname,
      replace(pg_get_viewdef(v.oid), 'CURRENT_DATE', 'fn_shop_today()'));
  end loop;
end $$;

alter table item_price alter column valid_from set default fn_shop_today();

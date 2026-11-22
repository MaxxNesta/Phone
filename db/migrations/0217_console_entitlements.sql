-- The provider's console reaches this shop through three functions and nothing
-- else (console27: MaxxNesta/console27).
--
-- The console signs in as console_agent, a role that can only run these three:
--   fn_console_state()          what this shop is entitled to now
--   fn_console_usage()          counts for the console's stats (no customer data)
--   fn_apply_entitlement(...)   change package, add-ons, seats, switches, access
-- Each runs with the owner's rights (security definer) and touches only the
-- company row and entitlement_history. console_agent gets no table access.
--
-- The role is created without a login here: a migration holds no secrets.
-- scripts/console-agent.mjs gives it a password when a shop is connected.

alter table company add column if not exists access_until date;
alter table company add column if not exists access_status text not null default 'active';
alter table company drop constraint if exists company_access_status_known;
alter table company add constraint company_access_status_known
  check (access_status in ('active', 'grace', 'read_only', 'suspended'));

comment on column company.access_until is
  'The day this shop''s subscription runs to, set by the console. Null: no end set.';
comment on column company.access_status is
  'active; grace (past its date, still working, warned); read_only (can look, cannot post); suspended (as read-only, red banner). Set by the console.';

-- Every change the console made, once each: the key is the console's change
-- order, so a retry after a dropped connection changes nothing twice.
create table if not exists entitlement_history (
  id          bigserial primary key,
  apply_key   uuid not null unique,
  applied_at  timestamptz not null default now(),
  actor       text,
  summary     text,
  before      jsonb not null,
  after       jsonb not null
);

create or replace function fn_console_state() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'code', c.code, 'name', c.name, 'plan', c.plan, 'modules', to_jsonb(c.modules),
           'package_seats', coalesce(c.package_seats, '{}'::jsonb), 'module_seats', coalesce(c.module_seats, '{}'::jsonb),
           'features', coalesce(c.features, '{}'::jsonb), 'retail_mode', c.retail_mode,
           'access_until', c.access_until, 'access_status', c.access_status)
    from company c order by c.created_at limit 1
$$;

-- Counts only: how much the shop uses the system, never what it sold to whom.
create or replace function fn_console_usage() returns jsonb
language sql stable security definer set search_path = public as $$
  with co as (select id from company order by created_at limit 1),
       month_start as (select date_trunc('month', fn_shop_today())::date as d)
  select jsonb_build_object(
    'users_active',   (select count(*) from app_user where is_active),
    'users_total',    (select count(*) from app_user),
    'last_sign_in',   (select max(last_login_at) from app_user),
    'products',       (select count(*) from item i, co where i.company_id = co.id and i.is_active),
    'invoices_month', (select count(*) from document d, co, month_start m
                        where d.company_id = co.id and d.doc_type = 'SALES_INVOICE' and d.status = 'POSTED' and d.posting_date >= m.d),
    'sales_month',    (select coalesce(sum(d.gross_total), 0) from document d, co, month_start m
                        where d.company_id = co.id and d.doc_type = 'SALES_INVOICE' and d.status = 'POSTED' and d.posting_date >= m.d),
    'documents',      (select count(*) from document d, co where d.company_id = co.id and d.status = 'POSTED'),
    'locations',      (select count(*) from location l, co where l.company_id = co.id and l.is_active and l.is_stock_location),
    'db_bytes',       pg_database_size(current_database()))
$$;

create or replace function fn_apply_entitlement(p_key uuid, p_change jsonb, p_actor text, p_summary text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  core   text[] := array['sales', 'purchases', 'inventory', 'accounting'];
  addons text[] := array['landed_cost', 'fixed_assets', 'hr', 'equity', 'logistics', 'management'];
  standard_up text[] := array['landed_cost', 'fixed_assets', 'management'];
  switches text[] := array['serial_tracking', 'orders_deliveries', 'spare_parts'];
  c company%rowtype;
  before jsonb;
  new_plan text;
  picked text[];
  feats jsonb;
  k text;
  v jsonb;
begin
  if p_key is null then raise exception 'A change needs its key'; end if;
  -- Seen before: the change already stands. Say so, change nothing.
  if exists (select 1 from entitlement_history where apply_key = p_key) then
    return jsonb_build_object('already', true, 'state', fn_console_state());
  end if;

  select * into c from company order by created_at limit 1 for update;
  if not found then raise exception 'This database has no company'; end if;
  before := fn_console_state();
  new_plan := coalesce(p_change->>'plan', c.plan);
  if new_plan not in ('STARTER', 'BUSINESS', 'ENTERPRISE') then
    raise exception 'Unknown package %', new_plan;
  end if;

  if p_change ? 'addons' then
    picked := array(select jsonb_array_elements_text(p_change->'addons'));
    if exists (select 1 from unnest(picked) a where a <> all (addons)) then
      raise exception 'Unknown add-on in %', picked;
    end if;
    c.modules := core || picked;
  end if;
  -- Landed cost, fixed assets and management reports start at Standard.
  if new_plan = 'STARTER' and c.modules && standard_up then
    raise exception 'Essential cannot have landed cost, fixed assets or management reports';
  end if;

  if p_change ? 'package_seats' then
    if jsonb_typeof(p_change->'package_seats') <> 'object' then raise exception 'package_seats must be an object'; end if;
    c.package_seats := p_change->'package_seats';
  end if;
  if p_change ? 'module_seats' then
    if jsonb_typeof(p_change->'module_seats') <> 'object' then raise exception 'module_seats must be an object'; end if;
    c.module_seats := p_change->'module_seats';
  end if;

  -- Switches: true or false sets one; null removes it, so the app's own
  -- default applies again (lib/features.ts).
  if p_change ? 'features' then
    feats := coalesce(c.features, '{}'::jsonb);
    for k, v in select * from jsonb_each(p_change->'features') loop
      if k <> all (switches) then raise exception 'Unknown switch %', k; end if;
      if jsonb_typeof(v) = 'null' then feats := feats - k;
      elsif jsonb_typeof(v) = 'boolean' then feats := feats || jsonb_build_object(k, v);
      else raise exception 'Switch % must be true, false or null', k; end if;
    end loop;
    c.features := feats;
  end if;

  if p_change ? 'access_until' then
    c.access_until := nullif(p_change->>'access_until', '')::date;
  end if;
  if p_change ? 'access_status' then
    c.access_status := p_change->>'access_status';
  end if;

  update company set plan = new_plan, modules = c.modules, package_seats = c.package_seats,
         module_seats = c.module_seats, features = c.features,
         access_until = c.access_until, access_status = c.access_status
   where id = c.id;

  insert into entitlement_history (apply_key, actor, summary, before, after)
  values (p_key, p_actor, p_summary, before, fn_console_state());
  return jsonb_build_object('applied', true, 'state', fn_console_state());
end $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'console_agent') then
    create role console_agent nologin;
  end if;
end $$;

revoke all on function fn_console_state() from public;
revoke all on function fn_console_usage() from public;
revoke all on function fn_apply_entitlement(uuid, jsonb, text, text) from public;
grant usage on schema public to console_agent;
grant execute on function fn_console_state() to console_agent;
grant execute on function fn_console_usage() to console_agent;
grant execute on function fn_apply_entitlement(uuid, jsonb, text, text) to console_agent;

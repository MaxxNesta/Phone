-- An asset group is made of units.
--
-- A row standing for several of one thing (3 office tables) is one asset with
-- one cost and one schedule, and each table is a unit with its own code
-- (FA-0004-01 … -03) and its exact share of the cost: the cost over the units
-- to the cent, the last unit taking what rounding leaves, so the units always
-- add up to the group. A unit's depreciation is the same share of each month.
--
-- Transferring or disposing of some units splits them into an asset of their
-- own (parent_asset_id points back), which the ordinary transfer or disposal
-- then moves: the units keep their codes and their cost.

create table if not exists fa_unit (
    id          uuid primary key default gen_random_uuid(),
    company_id  uuid not null references company(id) on delete cascade,
    asset_id    uuid not null references fixed_asset(id) on delete cascade,
    seq         int  not null check (seq > 0),
    code        text not null,
    cost        numeric(18,4) not null check (cost >= 0),
    created_at  timestamptz not null default now(),
    unique (company_id, code)
);
create index if not exists fa_unit_asset on fa_unit (asset_id, seq);

alter table fixed_asset add column if not exists parent_asset_id uuid references fixed_asset(id);
create index if not exists fixed_asset_parent on fixed_asset (parent_asset_id) where parent_asset_id is not null;

-- The units of every group already registered: a whole quantity of two or more.
insert into fa_unit (company_id, asset_id, seq, code, cost)
select f.company_id, f.id, g.seq, f.code || '-' || lpad(g.seq::text, 2, '0'),
       case when g.seq < f.quantity::int then round(f.acquisition_cost / f.quantity, 2)
            else f.acquisition_cost - round(f.acquisition_cost / f.quantity, 2) * (f.quantity::int - 1) end
  from fixed_asset f
  cross join lateral generate_series(1, f.quantity::int) as g(seq)
 where f.quantity >= 2 and f.quantity = trunc(f.quantity) and f.quantity <= 500
   and not exists (select 1 from fa_unit u where u.asset_id = f.id);

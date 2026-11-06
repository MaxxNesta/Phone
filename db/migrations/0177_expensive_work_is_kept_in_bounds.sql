-- Expensive work, kept in bounds (lib/heavy.ts).
--
-- Imports, bulk changes, exports and the big reports each cost the database
-- far more than a page does, and nothing stopped one person, or a script,
-- from starting them as fast as the server answered. Each start is kept for
-- a short while: a person gets only so many of a kind a minute, and an
-- import or bulk change runs one at a time per company — two imports of the
-- same report at once would race for the same document numbers and stock.
--
-- A run that dies without finishing holds its slot only until its time is
-- up; the next start takes the slot back. Rows are useful for minutes, so
-- each start clears that kind's rows older than a day.

create table if not exists heavy_run (
    id          bigserial   primary key,
    company_id  uuid        references company(id),
    -- The person, or the address when sign-in is off.
    who         text        not null,
    kind        text        not null,
    exclusive   boolean     not null default false,
    started_at  timestamptz not null default now(),
    finished_at timestamptz
);

create index if not exists heavy_run_recent_idx on heavy_run (who, kind, started_at);
create index if not exists heavy_run_kind_idx on heavy_run (kind, started_at);
-- One running exclusive job per company and kind: a second start fails here.
create unique index if not exists heavy_run_one_at_a_time
    on heavy_run (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), kind)
    where exclusive and finished_at is null;

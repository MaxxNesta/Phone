-- Who signed in, and when they left.
--
-- One row per sign-in. Signing out stamps signed_out_at with ended_by
-- 'SIGN_OUT'; a session that simply runs out (12 hours, or 2 hours idle)
-- is stamped when it is cleared, at the person's last activity, with
-- ended_by 'TIMEOUT'. A session still open has neither.
--
-- Shown to people who manage users (Settings → Package → Members and
-- Activity). It records times only: no address, no device.
create table if not exists user_sign_in (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references company(id),
  user_id        uuid not null references app_user(id) on delete cascade,
  signed_in_at   timestamptz not null default now(),
  signed_out_at  timestamptz,
  ended_by       text check (ended_by in ('SIGN_OUT', 'TIMEOUT', 'REVOKED')),
  check ((signed_out_at is null) = (ended_by is null))
);
create index if not exists user_sign_in_company_at_idx on user_sign_in (company_id, signed_in_at desc);
create index if not exists user_sign_in_user_at_idx on user_sign_in (user_id, signed_in_at desc);

-- The session points at its sign-in row, so ending one stamps the other.
alter table user_session add column if not exists sign_in_id uuid references user_sign_in(id) on delete set null;

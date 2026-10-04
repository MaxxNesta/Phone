-- A person signs in.
--
-- app_user has existed since 0052 as someone work could be attributed to,
-- with no way to be them. This gives it a password, a role, and sessions.
--
-- Roles are a fixed list mapped to permissions in lib/auth.ts — code, not
-- data, because every permission is checked by code that has to know it
-- exists. A role table nobody's code reads is decoration.

alter table app_user
  add column if not exists password_hash text,
  add column if not exists role text not null default 'CASHIER'
      check (role in ('ADMIN', 'MANAGER', 'CASHIER', 'SALESPERSON', 'INVENTORY', 'ACCOUNTANT')),
  add column if not exists last_login_at timestamptz;

-- Sign-in is by email, so an email names one person across the database.
create unique index if not exists app_user_email_idx
    on app_user (lower(email)) where email is not null;

-- The cookie holds a random token; only its hash is stored, so a copy of
-- this table signs nobody in.
create table if not exists user_session (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references app_user(id) on delete cascade,
    token_hash   text not null unique,
    created_at   timestamptz not null default now(),
    expires_at   timestamptz not null,
    last_seen_at timestamptz not null default now()
);

create index if not exists user_session_user_idx on user_session (user_id);

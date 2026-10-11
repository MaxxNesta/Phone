-- Failed sign-ins, so a password cannot be guessed at leisure.
--
-- Nothing limited attempts: a script could try passwords against an email as
-- fast as the server answered. Each failure is kept for a short while, keyed
-- by the email tried and by the address it came from; sign-in refuses while
-- either has too many recent failures (lib/login-throttle.ts). A row is only
-- useful for minutes, so old ones are deleted as new ones arrive.

create table if not exists login_failure (
    id         bigserial   primary key,
    email      text        not null,
    ip         text,
    failed_at  timestamptz not null default now()
);

create index if not exists login_failure_email_idx on login_failure (email, failed_at);
create index if not exists login_failure_ip_idx    on login_failure (ip, failed_at);

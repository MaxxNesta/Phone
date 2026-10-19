-- A person keeps their language
--
-- The interface speaks English and Myanmar. Each person's choice is kept here,
-- in a table of its own, so the sign-in record (app_user) is not altered: a
-- preference is not part of who someone is, and nothing that reads app_user
-- needs to know about it. Restored into the language cookie on sign-in.

create table user_preference (
    user_id    uuid primary key references app_user(id) on delete cascade,
    locale     text not null default 'en' check (locale in ('en', 'my')),
    updated_at timestamptz not null default now()
);

comment on table user_preference is
    'Per-person interface settings. Kept off app_user so the sign-in record is unchanged.';

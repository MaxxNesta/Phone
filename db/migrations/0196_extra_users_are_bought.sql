-- Extra users are bought.
--
-- Every package includes one person who can sign in (lib/plans.ts
-- PLAN_LIMITS.users). Each further person is a seat bought on top, whatever
-- the package or add-ons. Existing users are never removed: a company already
-- over its seats keeps them and is refused only when it adds or reactivates
-- someone (lib/auth-actions.ts saveUser).

alter table company
  add column if not exists extra_users integer not null default 0
    check (extra_users >= 0);

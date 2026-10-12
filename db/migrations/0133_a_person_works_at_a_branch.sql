-- The branch a person works at.
--
-- Until now an account had a role and nothing else: a cashier could choose any
-- branch on any form and post a sale there. A person now belongs to a branch
-- and works only there. Null means every branch, which only an administrator
-- or a manager may have (enforced where accounts are saved, lib/auth-actions).
-- Existing accounts start unassigned and are given a branch from Settings.

alter table app_user
  add column if not exists branch_id uuid references location(id) on delete set null;

comment on column app_user.branch_id is
  'The branch (a top-level location) this person works at. Null = every branch; administrators and managers only.';

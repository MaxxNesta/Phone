-- What a person may see, apart from where they may post.
--
-- A person posts only at their own branch (0133). What they see follows the
-- same branch unless an administrator says otherwise: a head of sales may need
-- every branch's figures while still selling at one. False means their own
-- branch only; an administrator or a manager without a branch sees everything
-- regardless.

alter table app_user
  add column if not exists sees_all_branches boolean not null default false;

comment on column app_user.sees_all_branches is
  'May see every branch''s documents and reports, though posting stays at branch_id.';

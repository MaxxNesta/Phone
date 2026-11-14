-- A package seat has a level.
--
-- The company's package is the owner's level, and its one included seat is
-- at that level. Further package seats are bought at a level of their own
-- (Essential, Standard, Advanced), never above the company's: to give a
-- manager Advanced, the company moves to Advanced first. A person on a
-- package seat sees what their seat's level includes (lib/queries getCompany
-- reads it for the signed-in person).
--
-- package_seats holds the extra seats by level; the seats bought before this
-- (0196 extra_users) were at the company's level and move there.

alter table company
  add column if not exists package_seats jsonb not null default '{}'::jsonb;

update company set package_seats = jsonb_build_object(plan, extra_users)
 where extra_users > 0 and package_seats = '{}'::jsonb;

alter table app_user
  add column if not exists seat_plan text
    check (seat_plan in ('STARTER', 'BUSINESS', 'ENTERPRISE'));

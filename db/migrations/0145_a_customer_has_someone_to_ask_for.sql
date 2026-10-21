-- 0145_a_customer_has_someone_to_ask_for.sql
-- Who to ask for at a customer, how to write to them, and what the shop
-- wants remembered about them. Shown on the customer panel's overview; all
-- optional, and none of it changes what a customer is charged or allowed.

alter table business_partner add column if not exists contact_person text;
alter table business_partner add column if not exists email text;
alter table business_partner add column if not exists notes text;

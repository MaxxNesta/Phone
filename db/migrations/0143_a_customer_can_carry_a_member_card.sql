-- 0143_a_customer_can_carry_a_member_card.sql
-- The number on a customer's loyalty card, as the shop's old system kept it.
-- Free text: cards are printed elsewhere and their numbering is not ours.

alter table business_partner add column if not exists member_card_id text;

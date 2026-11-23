-- How a courier charges for cash on delivery (0234).
--
-- DEDUCTED  it keeps its fee out of the cash it collected: the pay-in books
--           what arrived to the bank and the fee to Carriage Outward.
-- BILLED    it pays in everything and sends a bill later: the pay-in books
--           the full amount, and the fee is expensed on that bill.
--
-- The courier's default; each pay-in may say otherwise.

alter table business_partner add column if not exists cod_fee_mode text not null default 'DEDUCTED';
alter table business_partner drop constraint if exists business_partner_cod_fee_mode_check;
alter table business_partner add constraint business_partner_cod_fee_mode_check
    check (cod_fee_mode in ('DEDUCTED', 'BILLED'));

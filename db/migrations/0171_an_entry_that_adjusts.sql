-- An entry that adjusts
--
-- The trial balance comes in two versions. The unadjusted one is the ledger
-- after the period's routine postings — sales, purchases, payments, stock — and
-- the adjusted one adds the period-end adjusting entries: accruals (unpaid
-- wages), deferrals and prepaid write-offs, depreciation. The financial
-- statements are read from the adjusted one.
--
-- Routine postings are never adjustments. What adjusts is a journal voucher
-- marked so: depreciation, which the fixed asset register posts as a journal
-- voucher, is marked when it posts (and every one already posted is marked
-- here), and a voucher typed by hand is marked by whoever enters it.

alter table document add column if not exists is_adjusting boolean not null default false;

update document d set is_adjusting = true
  from fa_run r
 where r.document_id = d.id and not d.is_adjusting;

comment on column document.is_adjusting is
  'A period-end adjusting entry (accrual, deferral, prepaid write-off, depreciation): left out of the unadjusted trial balance, added in the adjusted one.';

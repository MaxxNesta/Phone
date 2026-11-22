-- A receipt line of refused goods says why, and what the supplier is to do
-- (docs/06 D-P7). Ten phones arrive, one is broken: the receipt has a line
-- of nine for the shelf and a line of one for quarantine (0218), and that
-- line carries what is wrong with it and whether the supplier replaces it
-- (the order expects it again once it goes back) or credits it.

alter table document_line
    add column if not exists reject_reason  text,
    add column if not exists reject_outcome text;

alter table document_line drop constraint if exists document_line_reject_outcome_known;
alter table document_line add constraint document_line_reject_outcome_known
    check (reject_outcome is null or reject_outcome in ('REPLACE', 'CREDIT'));

alter table document_line drop constraint if exists document_line_reject_says_both;
alter table document_line add constraint document_line_reject_says_both
    check ((reject_reason is null) = (reject_outcome is null));

comment on column document_line.reject_reason is
    'Goods receipt: these units arrived but were refused, and why. They went to quarantine (0218).';
comment on column document_line.reject_outcome is
    'Goods receipt: REPLACE (the supplier sends others; returning these reopens the order) or CREDIT.';

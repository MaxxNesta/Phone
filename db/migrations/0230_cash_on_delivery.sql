-- Cash on delivery: a sales invoice whose money is collected at the door by
-- the shop's own driver. In the books it is credit (Accounts Receivable stays
-- open until it is collected); what differs is that it is due on delivery,
-- needs no credit limit, and is closed by "Collected" on the invoice, which
-- posts the ordinary customer receipt.

alter table document drop constraint if exists document_payment_type_check;
alter table document add constraint document_payment_type_check
    check (payment_type in ('CASH', 'CREDIT', 'COD'));

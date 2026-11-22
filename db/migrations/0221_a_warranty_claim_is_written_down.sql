-- A warranty claim is written down (docs/06 D-P7).
--
-- A customer comes back with a phone that is not working. Until now nothing
-- recorded it: the warranty lookup could say whether the phone was covered,
-- but not that somebody had claimed, what was wrong, or what was done. A
-- claim is that record — who, which phone, what is wrong, whether it was
-- under the shop's warranty and the supplier's on the day it was claimed,
-- and how it ended: repaired, replaced, refunded, or turned down.
--
-- It moves nothing. The goods move on the documents a claim leads to: a
-- customer return into quarantine (faulty), a return to the supplier from
-- there, a new sale for a replacement. The claim names them, so the trail
-- from the customer's complaint to the supplier's credit is one click each.
--
-- Whether the phone was covered is written down when the claim is opened,
-- not worked out later: a claim made on the last day of the warranty was
-- covered, and reading it a month on must still say so.

create table if not exists warranty_claim (
    id                       uuid primary key default gen_random_uuid(),
    company_id               uuid not null references company(id),
    claim_no                 text not null,
    serial_id                uuid not null references stock_serial(id),
    item_id                  uuid not null references item(id),
    partner_id               uuid references business_partner(id),
    sale_document_id         uuid references document(id),
    location_id              uuid references location(id),
    fault                    text not null check (length(trim(fault)) > 0),
    claimed_on               date not null default current_date,
    warranty_until           date,
    in_warranty              boolean not null,
    supplier_id              uuid references business_partner(id),
    supplier_warranty_until  date,
    supplier_in_warranty     boolean not null,
    status                   text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
    outcome                  text check (outcome in ('REPAIRED', 'REPLACED', 'REFUNDED', 'REJECTED')),
    outcome_note             text,
    return_document_id           uuid references document(id),
    supplier_return_document_id  uuid references document(id),
    created_by               uuid references app_user(id),
    created_at               timestamptz not null default now(),
    closed_by                uuid references app_user(id),
    closed_at                timestamptz,
    unique (company_id, claim_no),
    constraint warranty_claim_closed_says_how
        check ((status = 'CLOSED') = (outcome is not null and closed_at is not null))
);

create index if not exists warranty_claim_open on warranty_claim (company_id, status, claimed_on);
create index if not exists warranty_claim_serial on warranty_claim (serial_id);

comment on table warranty_claim is
    'A customer''s claim on a phone: what is wrong, whether it was covered when claimed, and how it ended. Moves nothing.';

-- A phone's own history shows the claim opened and closed.
alter table stock_serial_event drop constraint if exists stock_serial_event_event_check;
alter table stock_serial_event add constraint stock_serial_event_event_check check (event = any (array[
  'RECEIVED', 'SOLD', 'CUSTOMER_RETURN', 'SUPPLIER_RETURN', 'TRANSFER', 'RESTORED', 'WRITTEN_OFF',
  'HOLD', 'RELEASE', 'COST_LAYER_SPLIT', 'LANDED_COST', 'REACQUIRED', 'CLAIM_OPENED', 'CLAIM_CLOSED']));

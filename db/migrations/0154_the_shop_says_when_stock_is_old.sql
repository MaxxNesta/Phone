-- The shop says when stock is old
--
-- Inventory Aging sorted every unit into 0–30, 31–60, 61–90 and 90+ days,
-- fixed in the query. A shop selling iPhones calls a phone old far sooner
-- than a cable, so the three cut-offs and the four names are the company's
-- to set, with an optional override per top category.
--
-- Sales pace is a separate question (how many days the stock lasts at the
-- recent selling rate), with its own two cut-offs. A phone received ten
-- days ago that has not sold is fresh, not fast.
--
-- One row with no category is the company default; a row per category
-- overrides only the age cut-offs. No row at all reads as the defaults.

create table if not exists inventory_aging_setting (
    id             uuid primary key default gen_random_uuid(),
    company_id     uuid not null references company(id) on delete cascade,
    item_group_id  uuid references item_group(id) on delete cascade,
    thresholds     int[] not null default '{30,60,90}',
    labels         text[] not null default '{Fresh,Normal,Aging,Old stock}',
    pace_fast_days int not null default 30,
    pace_slow_days int not null default 90,
    updated_at     timestamptz not null default now(),
    constraint inventory_aging_thresholds_rising check (
        array_length(thresholds, 1) = 3 and thresholds[1] > 0
        and thresholds[1] < thresholds[2] and thresholds[2] < thresholds[3] and thresholds[3] <= 3650),
    constraint inventory_aging_four_labels check (array_length(labels, 1) = 4),
    constraint inventory_aging_pace_rising check (pace_fast_days > 0 and pace_fast_days < pace_slow_days)
);

create unique index if not exists inventory_aging_setting_company_default
    on inventory_aging_setting (company_id) where item_group_id is null;
create unique index if not exists inventory_aging_setting_per_category
    on inventory_aging_setting (company_id, item_group_id) where item_group_id is not null;

comment on table inventory_aging_setting is
    'Stock-age cut-offs and names (company default, or per top category) and the sales-pace cut-offs in days of cover.';

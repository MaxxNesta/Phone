-- The fiscal year is the calendar year (owner's decision, 2026-11-22).
--
-- Companies were set up April to March. Each company's calendar is rebuilt
-- as calendar years, 1 January to 31 December, with twelve monthly periods,
-- covering every year the old calendar covered; every journal entry and
-- document is re-tied to the year and period its date falls in, and the old
-- April-to-March years are removed.
--
-- Only safe while nothing has been closed. A year-end close posts against a
-- year and shuts its periods; re-cutting the calendar under it would leave a
-- close that no longer matches its year. So a company with a close or a shut
-- period stops the migration instead of being rebuilt.
--
-- Numbers stay unique: a calendar year writes "26" into a year-numbered
-- document, an April-to-March year wrote "2526" or "2627", so a restarted
-- count can never repeat an old number. Most documents number by date and
-- are untouched.

do $$
declare
    c record;
    y int;
    first_y int;
    last_y int;
    fy uuid;
begin
    if exists (select 1 from document where doc_type = 'YEAR_END_CLOSE')
       or exists (select 1 from fiscal_period where status <> 'OPEN') then
        raise exception 'A fiscal year has been closed or a period shut: the calendar cannot be re-cut under it. Reopen it first.';
    end if;

    -- Re-tying posted rows is the one edit the immutability guards must allow.
    alter table journal_entry disable trigger trg_journal_entry_immutable;
    alter table document disable trigger trg_document_immutable;

    for c in select id from company loop
        -- Already calendar years: nothing to do.
        continue when not exists (
            select 1 from fiscal_year where company_id = c.id
               and not (extract(month from start_date) = 1 and extract(day from start_date) = 1));

        select extract(year from min(start_date))::int, extract(year from max(end_date))::int
          into first_y, last_y from fiscal_year where company_id = c.id;

        -- Old years aside under a temporary code, so the new ones can take theirs.
        update fiscal_year set code = 'old-' || code where company_id = c.id;

        for y in first_y .. last_y loop
            insert into fiscal_year (company_id, code, start_date, end_date)
            values (c.id, y::text, make_date(y, 1, 1), make_date(y, 12, 31))
            returning id into fy;
            insert into fiscal_period (company_id, fiscal_year_id, period_no, start_date, end_date, status)
            select c.id, fy, g, make_date(y, g, 1), (make_date(y, g, 1) + interval '1 month' - interval '1 day')::date, 'OPEN'
              from generate_series(1, 12) g;
        end loop;

        update journal_entry je set fiscal_period_id = p.id
          from fiscal_period p join fiscal_year f on f.id = p.fiscal_year_id
         where je.company_id = c.id and p.company_id = c.id and f.code not like 'old-%'
           and je.entry_date between p.start_date and p.end_date;

        update document d set fiscal_year_id = f.id
          from fiscal_year f
         where d.company_id = c.id and f.company_id = c.id and f.code not like 'old-%'
           and d.fiscal_year_id is not null
           and d.doc_date between f.start_date and f.end_date;

        -- Counters kept per old year start again under the new ones.
        delete from number_series where company_id = c.id
           and fiscal_year_id in (select id from fiscal_year where company_id = c.id and code like 'old-%');

        delete from fiscal_period where company_id = c.id
           and fiscal_year_id in (select id from fiscal_year where company_id = c.id and code like 'old-%');
        delete from fiscal_year where company_id = c.id and code like 'old-%';

        update company set fiscal_year_start_month = 1 where id = c.id;
    end loop;

    -- Deferred checks on the rows just touched run now, so the guards can go back on.
    set constraints all immediate;
    alter table journal_entry enable trigger trg_journal_entry_immutable;
    alter table document enable trigger trg_document_immutable;
end $$;

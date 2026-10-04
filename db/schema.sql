--
-- PostgreSQL database dump
--

\restrict iaECVP1Wd1Y5OmksphE6B7987ILOKlGlchxjEtk8S6ZVaphKN1STbNH9oW9k39L

-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS '';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: account_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.account_type AS ENUM (
    'ASSET',
    'LIABILITY',
    'EQUITY',
    'REVENUE',
    'COGS',
    'EXPENSE'
);


--
-- Name: fn_allocation_within_invoice(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_allocation_within_invoice() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
    v_invoice_total numeric(18,4);
    v_allocated     numeric(18,4);
begin
    select gross_total into v_invoice_total
      from document where id = new.invoice_id;

    select coalesce(sum(amount), 0) into v_allocated
      from payment_allocation
     where invoice_id = new.invoice_id
       and id <> new.id;

    if abs(v_allocated + new.amount) > abs(v_invoice_total) then
        raise exception
            'Allocation of % would over-apply invoice % (total %, already allocated %)',
            new.amount, new.invoice_id, v_invoice_total, v_allocated;
    end if;

    return new;
end;
$$;


--
-- Name: fn_compose_group_code(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_compose_group_code(p_parent uuid, p_segment text) RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
declare
    v_parent text;
begin
    if p_parent is null then
        return p_segment;
    end if;
    select code into v_parent from item_group where id = p_parent;
    return coalesce(v_parent, '') || p_segment;
end;
$$;


--
-- Name: fn_document_posting_required(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_document_posting_required() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
    d document;
begin
    select * into d from document where id = new.id;
    if not found then
        return null;
    end if;

    if d.status = 'POSTED'
       and d.journal_entry_id is null
       and d.doc_type in (
            'GOODS_RECEIPT', 'PURCHASE_INVOICE', 'PURCHASE_RETURN',
            'SUPPLIER_PAYMENT', 'DELIVERY', 'SALES_INVOICE',
            'SALES_RETURN', 'CUSTOMER_RECEIPT', 'STOCK_ADJUSTMENT',
            'OPENING_BALANCE', 'CASH_VOUCHER', 'BANK_VOUCHER',
            'JOURNAL_VOUCHER', 'CASH_TRANSFER')
    then
        raise exception
            'Document % (%) is posted but has no journal entry',
            d.doc_no, d.doc_type;
    end if;

    return null;
end;
$$;


--
-- Name: fn_entry_balanced(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_entry_balanced() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
    v_sum   numeric(18,4);
    v_lines integer;
begin
    select coalesce(sum(base_amount), 0), count(*)
      into v_sum, v_lines
      from journal_line
     where journal_entry_id = new.journal_entry_id;

    if v_lines < 2 then
        raise exception
            'Journal entry % has % line(s); a posting needs at least two',
            new.journal_entry_id, v_lines;
    end if;

    if v_sum <> 0 then
        raise exception
            'Journal entry % does not balance; base amounts sum to %',
            new.journal_entry_id, v_sum;
    end if;

    return null;
end;
$$;


--
-- Name: fn_entry_has_lines(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_entry_has_lines() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    if not exists (select 1 from journal_line where journal_entry_id = new.id) then
        raise exception 'Journal entry % has no lines', new.entry_no;
    end if;
    return null;
end;
$$;


--
-- Name: fn_exchange_rate(uuid, character, character, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_exchange_rate(p_company uuid, p_from character, p_to character, p_type text, p_date date) RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
    select case when p_from = p_to then 1::numeric else (
        select r.rate
          from exchange_rate r
         where r.company_id    = p_company
           and r.from_currency = p_from
           and r.to_currency   = p_to
           and r.rate_type     = p_type
           and r.valid_from   <= p_date
         order by r.valid_from desc
         limit 1
    ) end;
$$;


--
-- Name: fn_fiscal_year_for(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_fiscal_year_for(p_company uuid, p_date date) RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
    select id from fiscal_year
     where company_id = p_company
       and p_date between start_date and end_date
     limit 1;
$$;


--
-- Name: fn_is_debit_normal(public.account_type); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_is_debit_normal(p_type public.account_type) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
    select p_type in ('ASSET', 'COGS', 'EXPENSE');
$$;


--
-- Name: fn_journal_entry_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_journal_entry_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    if tg_op = 'DELETE' then
        raise exception
            'Journal entries cannot be deleted. Post a reversal instead.';
    end if;

    -- Linking a reversal is the only permitted change.
    if (new.company_id, new.entry_no, new.entry_date, new.fiscal_period_id,
        new.source_type, new.source_id, new.memo, new.reverses_entry_id,
        new.created_at, new.created_by)
       is distinct from
       (old.company_id, old.entry_no, old.entry_date, old.fiscal_period_id,
        old.source_type, old.source_id, old.memo, old.reverses_entry_id,
        old.created_at, old.created_by)
    then
        raise exception
            'Journal entry % is immutable. Post a reversal instead.', old.entry_no;
    end if;

    return new;
end;
$$;


--
-- Name: fn_journal_entry_period(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_journal_entry_period() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
    p fiscal_period;
begin
    select * into p
      from fiscal_period
     where company_id = new.company_id
       and new.entry_date between start_date and end_date
     limit 1;

    if not found then
        raise exception
            'No fiscal period covers % for company %', new.entry_date, new.company_id;
    end if;

    if p.status <> 'OPEN' then
        raise exception
            'Fiscal period % is %; cannot post on %', p.period_no, p.status, new.entry_date;
    end if;

    new.fiscal_period_id := p.id;
    return new;
end;
$$;


--
-- Name: fn_journal_line_account_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_journal_line_account_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
    a account;
    e journal_entry;
begin
    select * into a from account where id = new.account_id;

    if not a.is_postable then
        raise exception
            'Account % (%) is a heading and cannot be posted to', a.code, a.name;
    end if;

    if not a.is_active then
        raise exception 'Account % (%) is inactive', a.code, a.name;
    end if;

    if a.currency is not null and a.currency <> new.currency then
        raise exception
            'Account % is denominated in % but the line is in %',
            a.code, a.currency, new.currency;
    end if;

    -- Control accounts belong to their subledger. A hand-typed journal entry
    -- posting straight to AR is how a subledger silently stops reconciling.
    if a.is_control then
        select * into e from journal_entry where id = new.journal_entry_id;
        if e.source_type is null then
            raise exception
                'Account % is a control account and cannot be posted to by a manual journal entry',
                a.code;
        end if;
        if new.partner_id is null then
            raise exception
                'Control account % requires partner_id on the line', a.code;
        end if;
    end if;

    return new;
end;
$$;


--
-- Name: fn_journal_line_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_journal_line_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    raise exception
        'Journal lines are immutable. Reverse the entry and post a new one.';
end;
$$;


--
-- Name: fn_moving_average_cost(uuid, uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_moving_average_cost(p_company uuid, p_item uuid, p_as_of date DEFAULT NULL::date) RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
    select case
        when coalesce(sum(qty), 0) = 0 then 0
        else round(sum(total_cost) / sum(qty), 4)
    end
      from stock_movement
     where company_id = p_company
       and item_id    = p_item
       and (p_as_of is null or movement_date <= p_as_of);
$$;


--
-- Name: fn_next_document_no(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_next_document_no(p_company uuid, p_type text, p_fiscal_year uuid) RETURNS text
    LANGUAGE plpgsql
    AS $$
declare
    s      number_series;
    v_pfx  text;
begin
    select * into s from number_series
     where company_id = p_company
       and document_type = p_type
       and fiscal_year_id is not distinct from p_fiscal_year
     for update;

    if not found then
        v_pfx := case p_type
            when 'PURCHASE_ORDER'    then 'PO-'
            when 'GOODS_RECEIPT'     then 'GR-'
            when 'PURCHASE_INVOICE'  then 'PI-'
            when 'PURCHASE_RETURN'   then 'PR-'
            when 'SUPPLIER_PAYMENT'  then 'PAY-'
            when 'SALES_ORDER'       then 'SO-'
            when 'DELIVERY'          then 'DO-'
            when 'SALES_INVOICE'     then 'SI-'
            when 'SALES_RETURN'      then 'SR-'
            when 'CUSTOMER_RECEIPT'  then 'RC-'
            when 'STOCK_ADJUSTMENT'  then 'ADJ-'
            when 'STOCK_TRANSFER'    then 'TRF-'
            when 'OPENING_BALANCE'   then 'OB-'
            when 'CASH_VOUCHER'      then 'CV-'
            when 'BANK_VOUCHER'      then 'BV-'
            when 'JOURNAL_VOUCHER'   then 'JV-'
            when 'CASH_TRANSFER'     then 'CT-'
            when 'JOURNAL'           then 'JE-'
            else left(p_type, 3) || '-'
        end;

        insert into number_series (company_id, document_type, fiscal_year_id, prefix, next_value)
        values (p_company, p_type, p_fiscal_year, v_pfx, 1)
        returning * into s;
    end if;

    update number_series set next_value = next_value + 1 where id = s.id;

    return s.prefix || lpad(s.next_value::text, s.padding, '0');
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: fiscal_period; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fiscal_period (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    fiscal_year_id uuid NOT NULL,
    period_no smallint NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    CONSTRAINT fiscal_period_check CHECK ((end_date >= start_date)),
    CONSTRAINT fiscal_period_period_no_check CHECK (((period_no >= 1) AND (period_no <= 12))),
    CONSTRAINT fiscal_period_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'CLOSED'::text, 'PERMANENTLY_CLOSED'::text])))
);


--
-- Name: COLUMN fiscal_period.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fiscal_period.status IS 'CLOSED can be reopened by an administrator. PERMANENTLY_CLOSED cannot — used once a year is audited and signed.';


--
-- Name: fn_period_for(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_period_for(p_company uuid, p_date date) RETURNS public.fiscal_period
    LANGUAGE sql STABLE
    AS $$
    select p.* from fiscal_period p
     where p.company_id = p_company
       and p_date between p.start_date and p.end_date
     limit 1;
$$;


--
-- Name: fn_qty_on_hand(uuid, uuid, uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_qty_on_hand(p_company uuid, p_item uuid, p_location uuid DEFAULT NULL::uuid, p_as_of date DEFAULT NULL::date) RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
    select coalesce(sum(qty), 0)
      from stock_movement
     where company_id = p_company
       and item_id    = p_item
       and (p_location is null or location_id = p_location)
       and (p_as_of   is null or movement_date <= p_as_of);
$$;


--
-- Name: fn_recompose_descendants(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_recompose_descendants() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    if new.code is distinct from old.code then
        update item_group set segment = segment where parent_id = new.id;
        update item       set serial  = serial  where item_group_id = new.id;
    end if;
    return null;
end;
$$;


--
-- Name: fn_resolve_account(uuid, text, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_resolve_account(p_company uuid, p_role text, p_item_group uuid DEFAULT NULL::uuid, p_partner uuid DEFAULT NULL::uuid, p_location uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql STABLE
    AS $$
declare
    v_account uuid;
begin
    select d.account_id into v_account
      from account_determination d
     where d.company_id = p_company
       and d.role       = p_role
       and (d.item_group_id is null or d.item_group_id = p_item_group)
       and (d.partner_id    is null or d.partner_id    = p_partner)
       and (d.location_id   is null or d.location_id   = p_location)
     order by
        (d.item_group_id is not null)::int
      + (d.partner_id    is not null)::int
      + (d.location_id   is not null)::int desc
     limit 1;

    if v_account is null then
        raise exception
            'No account determination rule for role % (item_group %, partner %, location %) in company %',
            p_role, p_item_group, p_partner, p_location, p_company;
    end if;

    return v_account;
end;
$$;


--
-- Name: fn_resolve_account_for_item(uuid, text, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_resolve_account_for_item(p_company uuid, p_role text, p_item uuid, p_partner uuid DEFAULT NULL::uuid, p_location uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql STABLE
    AS $$
declare
    v_group   uuid;
    v_account uuid;
begin
    select item_group_id into v_group from item where id = p_item;

    while v_group is not null loop
        select d.account_id into v_account
          from account_determination d
         where d.company_id    = p_company
           and d.role          = p_role
           and d.item_group_id = v_group
           and (d.partner_id  is null or d.partner_id  = p_partner)
           and (d.location_id is null or d.location_id = p_location)
         order by
            (d.partner_id  is not null)::int
          + (d.location_id is not null)::int desc
         limit 1;

        if v_account is not null then
            return v_account;
        end if;

        select parent_id into v_group from item_group where id = v_group;
    end loop;

    -- Fall back to a rule that doesn't name an item group at all.
    return fn_resolve_account(p_company, p_role, null, p_partner, p_location);
end;
$$;


--
-- Name: fn_resolve_control_account(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_resolve_control_account(p_company uuid, p_role text, p_partner uuid) RETURNS uuid
    LANGUAGE plpgsql STABLE
    AS $$
declare
    p business_partner;
begin
    select * into p from business_partner where id = p_partner;

    if p_role = 'AR_CONTROL' and p.ar_control_id is not null then
        return p.ar_control_id;
    end if;

    if p_role = 'AP_CONTROL' and p.ap_control_id is not null then
        return p.ap_control_id;
    end if;

    return fn_resolve_account(p_company, p_role, null, p_partner, null);
end;
$$;


--
-- Name: fn_set_group_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_set_group_code() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    new.code := fn_compose_group_code(new.parent_id, new.segment);
    return new;
end;
$$;


--
-- Name: fn_set_item_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_set_item_code() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
    v_group text;
begin
    select code into v_group from item_group where id = new.item_group_id;
    new.code := coalesce(v_group, '') || new.serial;
    return new;
end;
$$;


--
-- Name: fn_stock_location_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_stock_location_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
    l location;
    i item;
begin
    select * into l from location where id = new.location_id;
    if not l.is_stock_location then
        raise exception
            'Location % (%) is not a stock location', l.code, l.name;
    end if;

    select * into i from item where id = new.item_id;
    if not i.is_stocked then
        raise exception
            'Item % (%) is not stocked and cannot have movements', i.code, i.name;
    end if;

    return new;
end;
$$;


--
-- Name: fn_stock_movement_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_stock_movement_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    raise exception
        'Stock movements are append-only. Post a reversing movement instead.';
end;
$$;


--
-- Name: fn_system_account(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_system_account(p_company uuid, p_role text) RETURNS uuid
    LANGUAGE plpgsql STABLE
    AS $$
declare
    v_account uuid;
begin
    select account_id into v_account
      from system_account
     where company_id = p_company and role = p_role;

    if v_account is null then
        raise exception
            'System account % is not configured for company %', p_role, p_company;
    end if;

    return v_account;
end;
$$;


--
-- Name: seed_post(uuid, text, date, text, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_post(p_company uuid, p_entry_no text, p_date date, p_source_type text, p_source_id uuid, p_memo text, p_lines jsonb) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
declare
    v_entry uuid;
    v_line  jsonb;
    v_no    smallint := 0;
    v_acct  uuid;
begin
    insert into journal_entry (company_id, entry_no, entry_date, fiscal_period_id,
                               source_type, source_id, memo)
    values (p_company, p_entry_no, p_date, null, p_source_type, p_source_id, p_memo)
    returning id into v_entry;

    for v_line in select * from jsonb_array_elements(p_lines) loop
        v_no := v_no + 1;

        select id into v_acct from account
         where company_id = p_company and code = v_line->>'code';

        if v_acct is null then
            raise exception 'seed: no account with code %', v_line->>'code';
        end if;

        insert into journal_line (company_id, journal_entry_id, line_no, account_id,
                                  currency, amount, exchange_rate, base_amount,
                                  partner_id, location_id)
        values (p_company, v_entry, v_no, v_acct, 'MMK',
                (v_line->>'amt')::numeric, 1, (v_line->>'amt')::numeric,
                nullif(v_line->>'partner','')::uuid,
                nullif(v_line->>'loc','')::uuid);
    end loop;

    return v_entry;
end;
$$;


--
-- Name: account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    parent_id uuid,
    code text NOT NULL,
    name text NOT NULL,
    name_my text,
    account_type public.account_type NOT NULL,
    is_postable boolean DEFAULT true NOT NULL,
    is_control boolean DEFAULT false NOT NULL,
    currency character(3),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_cash_account boolean DEFAULT false NOT NULL,
    is_bank_account boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN account.is_bank_account; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.account.is_bank_account IS 'A cash account held at a bank rather than on the premises. Drives whether a movement belongs in the cash book or the bank book.';


--
-- Name: account_determination; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_determination (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    role text NOT NULL,
    item_group_id uuid,
    partner_id uuid,
    location_id uuid,
    account_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_determination_role_check CHECK ((role = ANY (ARRAY['INVENTORY'::text, 'COGS'::text, 'REVENUE'::text, 'SALES_RETURN'::text, 'AR_CONTROL'::text, 'AP_CONTROL'::text])))
);


--
-- Name: business_partner; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_partner (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    name_my text,
    company_name text,
    is_customer boolean DEFAULT false NOT NULL,
    is_supplier boolean DEFAULT false NOT NULL,
    ar_control_id uuid,
    ap_control_id uuid,
    currency character(3),
    price_level_id uuid,
    payment_terms_days smallint DEFAULT 0 NOT NULL,
    credit_limit numeric(18,4),
    default_discount_pct numeric(9,6) DEFAULT 0 NOT NULL,
    township text,
    address text,
    phone text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT business_partner_check CHECK ((is_customer OR is_supplier))
);


--
-- Name: company; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    name_my text,
    base_currency character(3) NOT NULL,
    fiscal_year_start_month smallint DEFAULT 4 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_fiscal_year_start_month_check CHECK (((fiscal_year_start_month >= 1) AND (fiscal_year_start_month <= 12)))
);


--
-- Name: COLUMN company.fiscal_year_start_month; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company.fiscal_year_start_month IS 'Myanmar has moved its fiscal year more than once. Configurable, never hardcoded.';


--
-- Name: cost_center; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cost_center (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    name_my text,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: currency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.currency (
    code character(3) NOT NULL,
    name text NOT NULL,
    symbol text,
    decimal_places smallint DEFAULT 2 NOT NULL
);


--
-- Name: document; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    doc_type text NOT NULL,
    doc_no text,
    fiscal_year_id uuid,
    doc_date date NOT NULL,
    posting_date date NOT NULL,
    due_date date,
    partner_id uuid,
    location_id uuid,
    to_location_id uuid,
    currency character(3) NOT NULL,
    exchange_rate numeric(18,8) DEFAULT 1 NOT NULL,
    rate_type text,
    price_includes_tax boolean DEFAULT false NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    source_document_id uuid,
    journal_entry_id uuid,
    net_total numeric(18,4) DEFAULT 0 NOT NULL,
    tax_total numeric(18,4) DEFAULT 0 NOT NULL,
    gross_total numeric(18,4) DEFAULT 0 NOT NULL,
    memo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    posted_at timestamp with time zone,
    payment_type text DEFAULT 'CREDIT'::text NOT NULL,
    salesman_id uuid,
    reference text,
    to_deliver boolean DEFAULT false NOT NULL,
    delivered_at timestamp with time zone,
    CONSTRAINT document_check CHECK (((status <> 'POSTED'::text) OR (doc_no IS NOT NULL))),
    CONSTRAINT document_doc_type_check CHECK ((doc_type = ANY (ARRAY['PURCHASE_ORDER'::text, 'GOODS_RECEIPT'::text, 'PURCHASE_INVOICE'::text, 'PURCHASE_RETURN'::text, 'SUPPLIER_PAYMENT'::text, 'SALES_ORDER'::text, 'DELIVERY'::text, 'SALES_INVOICE'::text, 'SALES_RETURN'::text, 'CUSTOMER_RECEIPT'::text, 'STOCK_ADJUSTMENT'::text, 'STOCK_TRANSFER'::text, 'OPENING_BALANCE'::text, 'CASH_VOUCHER'::text, 'BANK_VOUCHER'::text, 'JOURNAL_VOUCHER'::text, 'CASH_TRANSFER'::text]))),
    CONSTRAINT document_exchange_rate_check CHECK ((exchange_rate > (0)::numeric)),
    CONSTRAINT document_payment_type_check CHECK ((payment_type = ANY (ARRAY['CASH'::text, 'CREDIT'::text]))),
    CONSTRAINT document_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'POSTED'::text, 'REVERSED'::text, 'CANCELLED'::text])))
);


--
-- Name: COLUMN document.to_deliver; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.document.to_deliver IS 'A fulfilment flag, not an accounting one. The posting is identical either way — this exists so the warehouse can list what still has to go out.';


--
-- Name: document_line; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_line (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    document_id uuid NOT NULL,
    line_no smallint NOT NULL,
    item_id uuid,
    description text,
    location_id uuid,
    entered_qty numeric(18,4) NOT NULL,
    entered_uom_id uuid,
    base_qty numeric(18,4) NOT NULL,
    unit_price numeric(18,4) DEFAULT 0 NOT NULL,
    discount_pct numeric(9,6) DEFAULT 0 NOT NULL,
    discount_amount numeric(18,4) DEFAULT 0 NOT NULL,
    net_amount numeric(18,4) DEFAULT 0 NOT NULL,
    tax_code_id uuid,
    tax_amount numeric(18,4) DEFAULT 0 NOT NULL,
    gross_amount numeric(18,4) DEFAULT 0 NOT NULL,
    foc_reason_id uuid,
    batch_no text,
    expiry_date date,
    source_line_id uuid,
    CONSTRAINT document_line_check CHECK (((foc_reason_id IS NULL) OR (unit_price = (0)::numeric)))
);


--
-- Name: exchange_rate; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exchange_rate (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    from_currency character(3) NOT NULL,
    to_currency character(3) NOT NULL,
    rate_type text NOT NULL,
    valid_from date NOT NULL,
    rate numeric(18,8) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT exchange_rate_check CHECK ((from_currency <> to_currency)),
    CONSTRAINT exchange_rate_rate_check CHECK ((rate > (0)::numeric))
);


--
-- Name: fiscal_year; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fiscal_year (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    CONSTRAINT fiscal_year_check CHECK ((end_date > start_date)),
    CONSTRAINT fiscal_year_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'CLOSED'::text])))
);


--
-- Name: foc_reason; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.foc_reason (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    name_my text,
    account_id uuid NOT NULL
);


--
-- Name: item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    item_group_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    name_my text,
    base_uom_id uuid NOT NULL,
    valuation_method text DEFAULT 'WEIGHTED_AVERAGE'::text NOT NULL,
    is_stocked boolean DEFAULT true NOT NULL,
    tracks_batch boolean DEFAULT false NOT NULL,
    tracks_expiry boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    serial text NOT NULL,
    CONSTRAINT item_valuation_method_check CHECK ((valuation_method = ANY (ARRAY['WEIGHTED_AVERAGE'::text, 'FIFO'::text])))
);


--
-- Name: COLUMN item.serial; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.item.serial IS 'The item''s own piece. `code` is the category chain plus this.';


--
-- Name: item_alias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_alias (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    item_id uuid NOT NULL,
    alias text NOT NULL
);


--
-- Name: item_group; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_group (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    parent_id uuid,
    code text NOT NULL,
    name text NOT NULL,
    name_my text,
    is_active boolean DEFAULT true NOT NULL,
    segment text NOT NULL
);


--
-- Name: COLUMN item_group.segment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.item_group.segment IS 'The piece the user types for this level. `code` is this appended to the parent chain and is maintained by trigger — never write to it directly.';


--
-- Name: item_price; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_price (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    item_id uuid NOT NULL,
    price_level_id uuid NOT NULL,
    uom_id uuid NOT NULL,
    currency character(3) NOT NULL,
    price numeric(18,4) NOT NULL,
    valid_from date DEFAULT CURRENT_DATE NOT NULL,
    CONSTRAINT item_price_price_check CHECK ((price >= (0)::numeric))
);


--
-- Name: item_reorder; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_reorder (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    item_id uuid NOT NULL,
    location_id uuid NOT NULL,
    min_qty numeric(18,4),
    max_qty numeric(18,4)
);


--
-- Name: item_uom; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_uom (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    item_id uuid NOT NULL,
    uom_id uuid NOT NULL,
    factor numeric(18,4) NOT NULL,
    CONSTRAINT item_uom_factor_check CHECK ((factor > (0)::numeric))
);


--
-- Name: journal_entry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_entry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    entry_no text NOT NULL,
    entry_date date NOT NULL,
    fiscal_period_id uuid NOT NULL,
    source_type text,
    source_id uuid,
    memo text,
    reverses_entry_id uuid,
    reversed_by_entry_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- Name: journal_line; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_line (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    journal_entry_id uuid NOT NULL,
    line_no smallint NOT NULL,
    account_id uuid NOT NULL,
    currency character(3) NOT NULL,
    amount numeric(18,4) NOT NULL,
    exchange_rate numeric(18,8) DEFAULT 1 NOT NULL,
    base_amount numeric(18,4) NOT NULL,
    location_id uuid,
    cost_center_id uuid,
    project_id uuid,
    partner_id uuid,
    memo text,
    CONSTRAINT journal_line_amount_check CHECK ((amount <> (0)::numeric)),
    CONSTRAINT journal_line_exchange_rate_check CHECK ((exchange_rate > (0)::numeric))
);


--
-- Name: location; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    parent_id uuid,
    code text NOT NULL,
    name text NOT NULL,
    name_my text,
    is_stock_location boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: number_series; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.number_series (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    document_type text NOT NULL,
    fiscal_year_id uuid,
    prefix text DEFAULT ''::text NOT NULL,
    padding smallint DEFAULT 6 NOT NULL,
    next_value bigint DEFAULT 1 NOT NULL
);


--
-- Name: payment_allocation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_allocation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    payment_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    amount numeric(18,4) NOT NULL,
    base_amount numeric(18,4) NOT NULL,
    fx_amount numeric(18,4) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_allocation_amount_check CHECK ((amount <> (0)::numeric))
);


--
-- Name: price_level; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_level (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    sort_order smallint DEFAULT 0 NOT NULL
);


--
-- Name: project; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    name_my text,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: promotion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotion (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    name_my text,
    item_id uuid,
    item_group_id uuid,
    discount_pct numeric(9,6) DEFAULT 0 NOT NULL,
    buy_qty numeric(18,4),
    free_qty numeric(18,4),
    valid_from date NOT NULL,
    valid_to date,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT promotion_check CHECK (((valid_to IS NULL) OR (valid_to >= valid_from))),
    CONSTRAINT promotion_discount_pct_check CHECK (((discount_pct >= (0)::numeric) AND (discount_pct <= (100)::numeric)))
);


--
-- Name: rate_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_type (
    code text NOT NULL,
    name text NOT NULL
);


--
-- Name: salesman; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salesman (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    name_my text,
    phone text,
    location_id uuid,
    commission_pct numeric(9,6) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT salesman_commission_pct_check CHECK ((commission_pct >= (0)::numeric))
);


--
-- Name: schema_migration; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migration (
    filename text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: stock_movement; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_movement (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    item_id uuid NOT NULL,
    location_id uuid NOT NULL,
    movement_date date NOT NULL,
    qty numeric(18,4) NOT NULL,
    unit_cost numeric(18,4) DEFAULT 0 NOT NULL,
    total_cost numeric(18,4) DEFAULT 0 NOT NULL,
    document_id uuid,
    document_line_id uuid,
    batch_no text,
    expiry_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_movement_qty_check CHECK ((qty <> (0)::numeric))
);


--
-- Name: system_account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_account (
    company_id uuid NOT NULL,
    role text NOT NULL,
    account_id uuid NOT NULL,
    CONSTRAINT system_account_role_check CHECK ((role = ANY (ARRAY['GRIR_CLEARING'::text, 'PURCHASE_PRICE_VARIANCE'::text, 'PURCHASE_DISCOUNT_RECEIVED'::text, 'SALES_DISCOUNT_ALLOWED'::text, 'STOCK_ADJUSTMENT'::text, 'PROMOTION_EXPENSE'::text, 'FX_GAIN'::text, 'FX_LOSS'::text, 'ROUNDING_DIFFERENCE'::text, 'OPENING_BALANCE_EQUITY'::text, 'RETAINED_EARNINGS'::text])))
);


--
-- Name: tax_code; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_code (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    rate numeric(9,6) DEFAULT 0 NOT NULL,
    output_account_id uuid,
    input_account_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT tax_code_rate_check CHECK ((rate >= (0)::numeric))
);


--
-- Name: uom; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uom (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    name_my text
);


--
-- Name: v_account_ledger; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_account_ledger AS
 SELECT jl.company_id,
    jl.account_id,
    a.code AS account_code,
    a.name AS account_name,
    a.account_type,
    a.is_cash_account,
    a.is_bank_account,
    je.id AS journal_entry_id,
    je.entry_no,
    je.entry_date,
    je.memo,
    je.source_type,
    je.source_id,
    d.doc_no,
    d.doc_type,
    p.name AS partner_name,
    l.code AS location_code,
        CASE
            WHEN (jl.base_amount > (0)::numeric) THEN jl.base_amount
            ELSE (0)::numeric
        END AS debit,
        CASE
            WHEN (jl.base_amount < (0)::numeric) THEN (- jl.base_amount)
            ELSE (0)::numeric
        END AS credit,
    jl.base_amount,
    sum(jl.base_amount) OVER (PARTITION BY jl.company_id, jl.account_id ORDER BY je.entry_date, je.entry_no, jl.line_no ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance
   FROM (((((public.journal_line jl
     JOIN public.journal_entry je ON ((je.id = jl.journal_entry_id)))
     JOIN public.account a ON ((a.id = jl.account_id)))
     LEFT JOIN public.document d ON ((d.id = je.source_id)))
     LEFT JOIN public.business_partner p ON ((p.id = jl.partner_id)))
     LEFT JOIN public.location l ON ((l.id = jl.location_id)));


--
-- Name: VIEW v_account_ledger; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_account_ledger IS 'Movements on every account with a running balance. Cash detail and bank detail are this view filtered by account.';


--
-- Name: v_open_item; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_open_item AS
 SELECT d.company_id,
    d.id AS document_id,
    d.doc_type,
    d.doc_no,
    d.partner_id,
    p.code AS partner_code,
    p.name AS partner_name,
    d.posting_date,
    d.due_date,
    d.currency,
    d.gross_total,
    COALESCE(al.allocated, (0)::numeric) AS allocated,
    (d.gross_total - COALESCE(al.allocated, (0)::numeric)) AS outstanding,
        CASE
            WHEN (d.due_date IS NULL) THEN NULL::integer
            ELSE (CURRENT_DATE - d.due_date)
        END AS days_overdue,
        CASE
            WHEN (d.due_date IS NULL) THEN 'CURRENT'::text
            WHEN (CURRENT_DATE <= d.due_date) THEN 'CURRENT'::text
            WHEN ((CURRENT_DATE - d.due_date) <= 30) THEN '1-30'::text
            WHEN ((CURRENT_DATE - d.due_date) <= 60) THEN '31-60'::text
            WHEN ((CURRENT_DATE - d.due_date) <= 90) THEN '61-90'::text
            ELSE '90+'::text
        END AS aging_bucket
   FROM ((public.document d
     JOIN public.business_partner p ON ((p.id = d.partner_id)))
     LEFT JOIN ( SELECT payment_allocation.invoice_id,
            sum(payment_allocation.amount) AS allocated
           FROM public.payment_allocation
          GROUP BY payment_allocation.invoice_id) al ON ((al.invoice_id = d.id)))
  WHERE ((d.status = 'POSTED'::text) AND (d.doc_type = ANY (ARRAY['SALES_INVOICE'::text, 'PURCHASE_INVOICE'::text])) AND ((d.gross_total - COALESCE(al.allocated, (0)::numeric)) <> (0)::numeric));


--
-- Name: v_check_control_reconciliation; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_check_control_reconciliation AS
 WITH ar AS (
         SELECT jl.company_id,
            'AR'::text AS side,
            sum(jl.base_amount) AS gl_balance
           FROM public.journal_line jl
          WHERE (EXISTS ( SELECT 1
                   FROM public.account a
                  WHERE ((a.id = jl.account_id) AND a.is_control AND (a.account_type = 'ASSET'::public.account_type))))
          GROUP BY jl.company_id
        ), ar_sub AS (
         SELECT v_open_item.company_id,
            'AR'::text AS side,
            sum(v_open_item.outstanding) AS sub_balance
           FROM public.v_open_item
          WHERE (v_open_item.doc_type = 'SALES_INVOICE'::text)
          GROUP BY v_open_item.company_id
        )
 SELECT ar.company_id,
    ar.side,
    ar.gl_balance,
    COALESCE(ar_sub.sub_balance, (0)::numeric) AS sub_balance,
    (ar.gl_balance - COALESCE(ar_sub.sub_balance, (0)::numeric)) AS difference
   FROM (ar
     LEFT JOIN ar_sub ON (((ar_sub.company_id = ar.company_id) AND (ar_sub.side = ar.side))))
  WHERE (ar.gl_balance <> COALESCE(ar_sub.sub_balance, (0)::numeric));


--
-- Name: v_check_inventory_reconciliation; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_check_inventory_reconciliation AS
 WITH inventory_accounts AS (
         SELECT DISTINCT account_determination.company_id,
            account_determination.account_id
           FROM public.account_determination
          WHERE (account_determination.role = 'INVENTORY'::text)
        ), gl AS (
         SELECT jl.company_id,
            sum(jl.base_amount) AS gl_balance
           FROM (public.journal_line jl
             JOIN inventory_accounts ia ON (((ia.account_id = jl.account_id) AND (ia.company_id = jl.company_id))))
          GROUP BY jl.company_id
        ), stock AS (
         SELECT stock_movement.company_id,
            sum(stock_movement.total_cost) AS stock_value
           FROM public.stock_movement
          GROUP BY stock_movement.company_id
        )
 SELECT COALESCE(gl.company_id, stock.company_id) AS company_id,
    COALESCE(gl.gl_balance, (0)::numeric) AS gl_balance,
    COALESCE(stock.stock_value, (0)::numeric) AS stock_value,
    (COALESCE(gl.gl_balance, (0)::numeric) - COALESCE(stock.stock_value, (0)::numeric)) AS difference
   FROM (gl
     FULL JOIN stock ON ((stock.company_id = gl.company_id)))
  WHERE (COALESCE(gl.gl_balance, (0)::numeric) <> COALESCE(stock.stock_value, (0)::numeric));


--
-- Name: v_check_unbalanced_entries; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_check_unbalanced_entries AS
 SELECT je.company_id,
    je.id AS journal_entry_id,
    je.entry_no,
    je.entry_date,
    sum(jl.base_amount) AS imbalance
   FROM (public.journal_entry je
     JOIN public.journal_line jl ON ((jl.journal_entry_id = je.id)))
  GROUP BY je.company_id, je.id, je.entry_no, je.entry_date
 HAVING (sum(jl.base_amount) <> (0)::numeric);


--
-- Name: v_grir_balance; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_grir_balance AS
 SELECT jl.company_id,
    jl.partner_id,
    je.source_id AS document_id,
    sum(jl.base_amount) AS balance,
    min(je.entry_date) AS oldest_entry_date,
    (CURRENT_DATE - min(je.entry_date)) AS days_open
   FROM ((public.journal_line jl
     JOIN public.journal_entry je ON ((je.id = jl.journal_entry_id)))
     JOIN public.system_account sa ON (((sa.account_id = jl.account_id) AND (sa.company_id = jl.company_id) AND (sa.role = 'GRIR_CLEARING'::text))))
  GROUP BY jl.company_id, jl.partner_id, je.source_id
 HAVING (sum(jl.base_amount) <> (0)::numeric);


--
-- Name: v_invoice_status; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_invoice_status AS
 SELECT d.company_id,
    d.id AS document_id,
    d.doc_type,
    d.doc_no,
    d.partner_id,
    p.code AS partner_code,
    p.name AS partner_name,
    d.posting_date,
    d.due_date,
    d.currency,
    d.gross_total,
    COALESCE(a.paid, (0)::numeric) AS paid,
    (d.gross_total - COALESCE(a.paid, (0)::numeric)) AS outstanding,
        CASE
            WHEN (COALESCE(a.paid, (0)::numeric) = (0)::numeric) THEN 'OPEN'::text
            WHEN (COALESCE(a.paid, (0)::numeric) >= d.gross_total) THEN 'PAID'::text
            ELSE 'PARTIALLY_PAID'::text
        END AS payment_status,
        CASE
            WHEN (d.due_date IS NULL) THEN NULL::integer
            ELSE (CURRENT_DATE - d.due_date)
        END AS days_overdue
   FROM ((public.document d
     JOIN public.business_partner p ON ((p.id = d.partner_id)))
     LEFT JOIN ( SELECT payment_allocation.invoice_id,
            sum(payment_allocation.amount) AS paid
           FROM public.payment_allocation
          GROUP BY payment_allocation.invoice_id) a ON ((a.invoice_id = d.id)))
  WHERE ((d.status = 'POSTED'::text) AND (d.doc_type = ANY (ARRAY['SALES_INVOICE'::text, 'PURCHASE_INVOICE'::text])));


--
-- Name: VIEW v_invoice_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_invoice_status IS 'Every posted invoice with what has been settled against it. OPEN, PARTIALLY_PAID or PAID is computed from allocations, never stored.';


--
-- Name: v_journal_line; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_journal_line AS
 SELECT jl.id,
    jl.company_id,
    jl.journal_entry_id,
    je.entry_no,
    je.entry_date,
    je.fiscal_period_id,
    je.source_type,
    je.source_id,
    jl.line_no,
    jl.account_id,
    a.code AS account_code,
    a.name AS account_name,
    a.account_type,
    jl.currency,
    jl.amount,
    jl.exchange_rate,
    jl.base_amount,
        CASE
            WHEN (jl.base_amount > (0)::numeric) THEN jl.base_amount
            ELSE (0)::numeric
        END AS debit,
        CASE
            WHEN (jl.base_amount < (0)::numeric) THEN (- jl.base_amount)
            ELSE (0)::numeric
        END AS credit,
    jl.location_id,
    jl.cost_center_id,
    jl.project_id,
    jl.partner_id,
    jl.memo
   FROM ((public.journal_line jl
     JOIN public.journal_entry je ON ((je.id = jl.journal_entry_id)))
     JOIN public.account a ON ((a.id = jl.account_id)));


--
-- Name: v_partner_balance; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_partner_balance AS
 SELECT company_id,
    partner_id,
    partner_code,
    partner_name,
    doc_type,
    (count(*) FILTER (WHERE (outstanding <> (0)::numeric)))::integer AS open_invoices,
    sum(gross_total) AS invoiced,
    sum(paid) AS paid,
    sum(outstanding) AS outstanding,
    sum(outstanding) FILTER (WHERE ((due_date IS NOT NULL) AND (CURRENT_DATE > due_date))) AS overdue
   FROM public.v_invoice_status
  GROUP BY company_id, partner_id, partner_code, partner_name, doc_type
 HAVING (sum(outstanding) <> (0)::numeric);


--
-- Name: v_pending_delivery; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_pending_delivery AS
 SELECT d.company_id,
    d.id AS document_id,
    d.doc_no,
    d.doc_type,
    d.posting_date,
    d.gross_total,
    p.name AS partner_name,
    p.code AS partner_code,
    l.code AS location_code,
    s.name AS salesman_name,
    (CURRENT_DATE - d.posting_date) AS days_waiting
   FROM (((public.document d
     JOIN public.business_partner p ON ((p.id = d.partner_id)))
     LEFT JOIN public.location l ON ((l.id = d.location_id)))
     LEFT JOIN public.salesman s ON ((s.id = d.salesman_id)))
  WHERE ((d.status = 'POSTED'::text) AND d.to_deliver AND (d.delivered_at IS NULL));


--
-- Name: v_stock_on_hand; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_stock_on_hand AS
 SELECT sm.company_id,
    sm.item_id,
    i.code AS item_code,
    i.name AS item_name,
    sm.location_id,
    l.code AS location_code,
    sum(sm.qty) AS qty_on_hand,
    sum(sm.total_cost) AS value_on_hand
   FROM ((public.stock_movement sm
     JOIN public.item i ON ((i.id = sm.item_id)))
     JOIN public.location l ON ((l.id = sm.location_id)))
  GROUP BY sm.company_id, sm.item_id, i.code, i.name, sm.location_id, l.code
 HAVING ((sum(sm.qty) <> (0)::numeric) OR (sum(sm.total_cost) <> (0)::numeric));


--
-- Name: v_trial_balance; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_trial_balance AS
 SELECT jl.company_id,
    je.fiscal_period_id,
    a.id AS account_id,
    a.code AS account_code,
    a.name AS account_name,
    a.account_type,
    sum(
        CASE
            WHEN (jl.base_amount > (0)::numeric) THEN jl.base_amount
            ELSE (0)::numeric
        END) AS debit,
    sum(
        CASE
            WHEN (jl.base_amount < (0)::numeric) THEN (- jl.base_amount)
            ELSE (0)::numeric
        END) AS credit,
    sum(jl.base_amount) AS balance
   FROM ((public.journal_line jl
     JOIN public.journal_entry je ON ((je.id = jl.journal_entry_id)))
     JOIN public.account a ON ((a.id = jl.account_id)))
  GROUP BY jl.company_id, je.fiscal_period_id, a.id, a.code, a.name, a.account_type;


--
-- Name: account account_company_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_company_id_code_key UNIQUE (company_id, code);


--
-- Name: account_determination account_determination_company_id_role_item_group_id_partner_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_determination
    ADD CONSTRAINT account_determination_company_id_role_item_group_id_partner_key UNIQUE (company_id, role, item_group_id, partner_id, location_id);


--
-- Name: account_determination account_determination_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_determination
    ADD CONSTRAINT account_determination_pkey PRIMARY KEY (id);


--
-- Name: account account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);


--
-- Name: business_partner business_partner_company_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_partner
    ADD CONSTRAINT business_partner_company_id_code_key UNIQUE (company_id, code);


--
-- Name: business_partner business_partner_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_partner
    ADD CONSTRAINT business_partner_pkey PRIMARY KEY (id);


--
-- Name: company company_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company
    ADD CONSTRAINT company_code_key UNIQUE (code);


--
-- Name: company company_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company
    ADD CONSTRAINT company_pkey PRIMARY KEY (id);


--
-- Name: cost_center cost_center_company_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_center
    ADD CONSTRAINT cost_center_company_id_code_key UNIQUE (company_id, code);


--
-- Name: cost_center cost_center_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_center
    ADD CONSTRAINT cost_center_pkey PRIMARY KEY (id);


--
-- Name: currency currency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currency
    ADD CONSTRAINT currency_pkey PRIMARY KEY (code);


--
-- Name: document document_company_id_doc_type_doc_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document
    ADD CONSTRAINT document_company_id_doc_type_doc_no_key UNIQUE (company_id, doc_type, doc_no);


--
-- Name: document_line document_line_document_id_line_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_line
    ADD CONSTRAINT document_line_document_id_line_no_key UNIQUE (document_id, line_no);


--
-- Name: document_line document_line_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_line
    ADD CONSTRAINT document_line_pkey PRIMARY KEY (id);


--
-- Name: document document_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document
    ADD CONSTRAINT document_pkey PRIMARY KEY (id);


--
-- Name: exchange_rate exchange_rate_company_id_from_currency_to_currency_rate_typ_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_rate
    ADD CONSTRAINT exchange_rate_company_id_from_currency_to_currency_rate_typ_key UNIQUE (company_id, from_currency, to_currency, rate_type, valid_from);


--
-- Name: exchange_rate exchange_rate_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_rate
    ADD CONSTRAINT exchange_rate_pkey PRIMARY KEY (id);


--
-- Name: fiscal_period fiscal_period_company_id_fiscal_year_id_period_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_period
    ADD CONSTRAINT fiscal_period_company_id_fiscal_year_id_period_no_key UNIQUE (company_id, fiscal_year_id, period_no);


--
-- Name: fiscal_period fiscal_period_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_period
    ADD CONSTRAINT fiscal_period_pkey PRIMARY KEY (id);


--
-- Name: fiscal_year fiscal_year_company_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_year
    ADD CONSTRAINT fiscal_year_company_id_code_key UNIQUE (company_id, code);


--
-- Name: fiscal_year fiscal_year_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_year
    ADD CONSTRAINT fiscal_year_pkey PRIMARY KEY (id);


--
-- Name: foc_reason foc_reason_company_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.foc_reason
    ADD CONSTRAINT foc_reason_company_id_code_key UNIQUE (company_id, code);


--
-- Name: foc_reason foc_reason_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.foc_reason
    ADD CONSTRAINT foc_reason_pkey PRIMARY KEY (id);


--
-- Name: item_alias item_alias_company_id_alias_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_alias
    ADD CONSTRAINT item_alias_company_id_alias_key UNIQUE (company_id, alias);


--
-- Name: item_alias item_alias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_alias
    ADD CONSTRAINT item_alias_pkey PRIMARY KEY (id);


--
-- Name: item item_company_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item
    ADD CONSTRAINT item_company_id_code_key UNIQUE (company_id, code);


--
-- Name: item_group item_group_company_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_group
    ADD CONSTRAINT item_group_company_id_code_key UNIQUE (company_id, code);


--
-- Name: item_group item_group_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_group
    ADD CONSTRAINT item_group_pkey PRIMARY KEY (id);


--
-- Name: item item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item
    ADD CONSTRAINT item_pkey PRIMARY KEY (id);


--
-- Name: item_price item_price_company_id_item_id_price_level_id_uom_id_currenc_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_price
    ADD CONSTRAINT item_price_company_id_item_id_price_level_id_uom_id_currenc_key UNIQUE (company_id, item_id, price_level_id, uom_id, currency, valid_from);


--
-- Name: item_price item_price_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_price
    ADD CONSTRAINT item_price_pkey PRIMARY KEY (id);


--
-- Name: item_reorder item_reorder_company_id_item_id_location_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_reorder
    ADD CONSTRAINT item_reorder_company_id_item_id_location_id_key UNIQUE (company_id, item_id, location_id);


--
-- Name: item_reorder item_reorder_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_reorder
    ADD CONSTRAINT item_reorder_pkey PRIMARY KEY (id);


--
-- Name: item_uom item_uom_company_id_item_id_uom_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_uom
    ADD CONSTRAINT item_uom_company_id_item_id_uom_id_key UNIQUE (company_id, item_id, uom_id);


--
-- Name: item_uom item_uom_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_uom
    ADD CONSTRAINT item_uom_pkey PRIMARY KEY (id);


--
-- Name: journal_entry journal_entry_company_id_entry_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry
    ADD CONSTRAINT journal_entry_company_id_entry_no_key UNIQUE (company_id, entry_no);


--
-- Name: journal_entry journal_entry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry
    ADD CONSTRAINT journal_entry_pkey PRIMARY KEY (id);


--
-- Name: journal_line journal_line_journal_entry_id_line_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_line
    ADD CONSTRAINT journal_line_journal_entry_id_line_no_key UNIQUE (journal_entry_id, line_no);


--
-- Name: journal_line journal_line_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_line
    ADD CONSTRAINT journal_line_pkey PRIMARY KEY (id);


--
-- Name: location location_company_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location
    ADD CONSTRAINT location_company_id_code_key UNIQUE (company_id, code);


--
-- Name: location location_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location
    ADD CONSTRAINT location_pkey PRIMARY KEY (id);


--
-- Name: number_series number_series_company_id_document_type_fiscal_year_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_series
    ADD CONSTRAINT number_series_company_id_document_type_fiscal_year_id_key UNIQUE (company_id, document_type, fiscal_year_id);


--
-- Name: number_series number_series_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_series
    ADD CONSTRAINT number_series_pkey PRIMARY KEY (id);


--
-- Name: payment_allocation payment_allocation_payment_id_invoice_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_allocation
    ADD CONSTRAINT payment_allocation_payment_id_invoice_id_key UNIQUE (payment_id, invoice_id);


--
-- Name: payment_allocation payment_allocation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_allocation
    ADD CONSTRAINT payment_allocation_pkey PRIMARY KEY (id);


--
-- Name: price_level price_level_company_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_level
    ADD CONSTRAINT price_level_company_id_code_key UNIQUE (company_id, code);


--
-- Name: price_level price_level_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_level
    ADD CONSTRAINT price_level_pkey PRIMARY KEY (id);


--
-- Name: project project_company_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project
    ADD CONSTRAINT project_company_id_code_key UNIQUE (company_id, code);


--
-- Name: project project_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project
    ADD CONSTRAINT project_pkey PRIMARY KEY (id);


--
-- Name: promotion promotion_company_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion
    ADD CONSTRAINT promotion_company_id_code_key UNIQUE (company_id, code);


--
-- Name: promotion promotion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion
    ADD CONSTRAINT promotion_pkey PRIMARY KEY (id);


--
-- Name: rate_type rate_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_type
    ADD CONSTRAINT rate_type_pkey PRIMARY KEY (code);


--
-- Name: salesman salesman_company_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salesman
    ADD CONSTRAINT salesman_company_id_code_key UNIQUE (company_id, code);


--
-- Name: salesman salesman_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salesman
    ADD CONSTRAINT salesman_pkey PRIMARY KEY (id);


--
-- Name: schema_migration schema_migration_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migration
    ADD CONSTRAINT schema_migration_pkey PRIMARY KEY (filename);


--
-- Name: stock_movement stock_movement_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movement
    ADD CONSTRAINT stock_movement_pkey PRIMARY KEY (id);


--
-- Name: system_account system_account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_account
    ADD CONSTRAINT system_account_pkey PRIMARY KEY (company_id, role);


--
-- Name: tax_code tax_code_company_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_code
    ADD CONSTRAINT tax_code_company_id_code_key UNIQUE (company_id, code);


--
-- Name: tax_code tax_code_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_code
    ADD CONSTRAINT tax_code_pkey PRIMARY KEY (id);


--
-- Name: uom uom_company_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uom
    ADD CONSTRAINT uom_company_id_code_key UNIQUE (company_id, code);


--
-- Name: uom uom_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uom
    ADD CONSTRAINT uom_pkey PRIMARY KEY (id);


--
-- Name: account_company_id_account_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_company_id_account_type_idx ON public.account USING btree (company_id, account_type);


--
-- Name: account_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_company_id_idx ON public.account USING btree (company_id) WHERE is_cash_account;


--
-- Name: account_company_id_idx1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_company_id_idx1 ON public.account USING btree (company_id) WHERE is_bank_account;


--
-- Name: account_company_id_parent_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_company_id_parent_id_idx ON public.account USING btree (company_id, parent_id);


--
-- Name: account_determination_company_id_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_determination_company_id_role_idx ON public.account_determination USING btree (company_id, role);


--
-- Name: business_partner_company_id_is_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX business_partner_company_id_is_customer_idx ON public.business_partner USING btree (company_id, is_customer) WHERE is_customer;


--
-- Name: business_partner_company_id_is_supplier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX business_partner_company_id_is_supplier_idx ON public.business_partner USING btree (company_id, is_supplier) WHERE is_supplier;


--
-- Name: document_company_id_doc_type_posting_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_company_id_doc_type_posting_date_idx ON public.document USING btree (company_id, doc_type, posting_date);


--
-- Name: document_company_id_partner_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_company_id_partner_id_idx ON public.document USING btree (company_id, partner_id) WHERE (partner_id IS NOT NULL);


--
-- Name: document_company_id_salesman_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_company_id_salesman_id_idx ON public.document USING btree (company_id, salesman_id) WHERE (salesman_id IS NOT NULL);


--
-- Name: document_company_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_company_id_status_idx ON public.document USING btree (company_id, status);


--
-- Name: document_company_id_to_deliver_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_company_id_to_deliver_idx ON public.document USING btree (company_id, to_deliver) WHERE (to_deliver AND (delivered_at IS NULL));


--
-- Name: document_line_company_id_item_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_line_company_id_item_id_idx ON public.document_line USING btree (company_id, item_id);


--
-- Name: document_line_document_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_line_document_id_idx ON public.document_line USING btree (document_id);


--
-- Name: document_line_source_line_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_line_source_line_id_idx ON public.document_line USING btree (source_line_id) WHERE (source_line_id IS NOT NULL);


--
-- Name: document_source_document_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_source_document_id_idx ON public.document USING btree (source_document_id) WHERE (source_document_id IS NOT NULL);


--
-- Name: exchange_rate_company_id_from_currency_to_currency_valid_fr_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX exchange_rate_company_id_from_currency_to_currency_valid_fr_idx ON public.exchange_rate USING btree (company_id, from_currency, to_currency, valid_from DESC);


--
-- Name: fiscal_period_company_id_start_date_end_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fiscal_period_company_id_start_date_end_date_idx ON public.fiscal_period USING btree (company_id, start_date, end_date);


--
-- Name: item_company_id_item_group_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX item_company_id_item_group_id_idx ON public.item USING btree (company_id, item_group_id);


--
-- Name: item_group_company_id_parent_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX item_group_company_id_parent_id_idx ON public.item_group USING btree (company_id, parent_id);


--
-- Name: journal_entry_company_id_entry_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_entry_company_id_entry_date_idx ON public.journal_entry USING btree (company_id, entry_date);


--
-- Name: journal_entry_company_id_fiscal_period_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_entry_company_id_fiscal_period_id_idx ON public.journal_entry USING btree (company_id, fiscal_period_id);


--
-- Name: journal_entry_source_type_source_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_entry_source_type_source_id_idx ON public.journal_entry USING btree (source_type, source_id);


--
-- Name: journal_line_company_id_account_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_line_company_id_account_id_idx ON public.journal_line USING btree (company_id, account_id);


--
-- Name: journal_line_company_id_cost_center_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_line_company_id_cost_center_id_idx ON public.journal_line USING btree (company_id, cost_center_id) WHERE (cost_center_id IS NOT NULL);


--
-- Name: journal_line_company_id_partner_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_line_company_id_partner_id_idx ON public.journal_line USING btree (company_id, partner_id) WHERE (partner_id IS NOT NULL);


--
-- Name: journal_line_journal_entry_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_line_journal_entry_id_idx ON public.journal_line USING btree (journal_entry_id);


--
-- Name: location_company_id_parent_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX location_company_id_parent_id_idx ON public.location USING btree (company_id, parent_id);


--
-- Name: payment_allocation_company_id_invoice_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_allocation_company_id_invoice_id_idx ON public.payment_allocation USING btree (company_id, invoice_id);


--
-- Name: payment_allocation_company_id_payment_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_allocation_company_id_payment_id_idx ON public.payment_allocation USING btree (company_id, payment_id);


--
-- Name: promotion_company_id_valid_from_valid_to_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX promotion_company_id_valid_from_valid_to_idx ON public.promotion USING btree (company_id, valid_from, valid_to) WHERE is_active;


--
-- Name: salesman_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salesman_company_id_idx ON public.salesman USING btree (company_id) WHERE is_active;


--
-- Name: stock_movement_company_id_item_id_expiry_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_movement_company_id_item_id_expiry_date_idx ON public.stock_movement USING btree (company_id, item_id, expiry_date) WHERE (expiry_date IS NOT NULL);


--
-- Name: stock_movement_company_id_item_id_location_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_movement_company_id_item_id_location_id_idx ON public.stock_movement USING btree (company_id, item_id, location_id);


--
-- Name: stock_movement_company_id_movement_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_movement_company_id_movement_date_idx ON public.stock_movement USING btree (company_id, movement_date);


--
-- Name: stock_movement_document_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_movement_document_id_idx ON public.stock_movement USING btree (document_id) WHERE (document_id IS NOT NULL);


--
-- Name: payment_allocation trg_allocation_within_invoice; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_allocation_within_invoice BEFORE INSERT OR UPDATE ON public.payment_allocation FOR EACH ROW EXECUTE FUNCTION public.fn_allocation_within_invoice();


--
-- Name: document trg_document_posting_required; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_document_posting_required AFTER INSERT OR UPDATE ON public.document DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fn_document_posting_required();


--
-- Name: journal_line trg_entry_balanced; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_entry_balanced AFTER INSERT ON public.journal_line DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fn_entry_balanced();


--
-- Name: journal_entry trg_entry_has_lines; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_entry_has_lines AFTER INSERT ON public.journal_entry DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fn_entry_has_lines();


--
-- Name: journal_entry trg_journal_entry_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_journal_entry_immutable BEFORE DELETE OR UPDATE ON public.journal_entry FOR EACH ROW EXECUTE FUNCTION public.fn_journal_entry_immutable();


--
-- Name: journal_entry trg_journal_entry_period; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_journal_entry_period BEFORE INSERT ON public.journal_entry FOR EACH ROW EXECUTE FUNCTION public.fn_journal_entry_period();


--
-- Name: journal_line trg_journal_line_account_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_journal_line_account_guard BEFORE INSERT ON public.journal_line FOR EACH ROW EXECUTE FUNCTION public.fn_journal_line_account_guard();


--
-- Name: journal_line trg_journal_line_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_journal_line_immutable BEFORE DELETE OR UPDATE ON public.journal_line FOR EACH ROW EXECUTE FUNCTION public.fn_journal_line_immutable();


--
-- Name: item_group trg_recompose_descendants; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_recompose_descendants AFTER UPDATE ON public.item_group FOR EACH ROW EXECUTE FUNCTION public.fn_recompose_descendants();


--
-- Name: item_group trg_set_group_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_group_code BEFORE INSERT OR UPDATE OF segment, parent_id ON public.item_group FOR EACH ROW EXECUTE FUNCTION public.fn_set_group_code();


--
-- Name: item trg_set_item_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_item_code BEFORE INSERT OR UPDATE OF serial, item_group_id ON public.item FOR EACH ROW EXECUTE FUNCTION public.fn_set_item_code();


--
-- Name: stock_movement trg_stock_location_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_stock_location_guard BEFORE INSERT ON public.stock_movement FOR EACH ROW EXECUTE FUNCTION public.fn_stock_location_guard();


--
-- Name: stock_movement trg_stock_movement_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_stock_movement_immutable BEFORE DELETE OR UPDATE ON public.stock_movement FOR EACH ROW EXECUTE FUNCTION public.fn_stock_movement_immutable();


--
-- Name: account account_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: account account_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_currency_fkey FOREIGN KEY (currency) REFERENCES public.currency(code);


--
-- Name: account_determination account_determination_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_determination
    ADD CONSTRAINT account_determination_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.account(id);


--
-- Name: account_determination account_determination_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_determination
    ADD CONSTRAINT account_determination_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: account_determination account_determination_item_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_determination
    ADD CONSTRAINT account_determination_item_group_id_fkey FOREIGN KEY (item_group_id) REFERENCES public.item_group(id);


--
-- Name: account_determination account_determination_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_determination
    ADD CONSTRAINT account_determination_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.location(id);


--
-- Name: account_determination account_determination_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_determination
    ADD CONSTRAINT account_determination_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.business_partner(id);


--
-- Name: account account_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.account(id);


--
-- Name: business_partner business_partner_ap_control_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_partner
    ADD CONSTRAINT business_partner_ap_control_id_fkey FOREIGN KEY (ap_control_id) REFERENCES public.account(id);


--
-- Name: business_partner business_partner_ar_control_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_partner
    ADD CONSTRAINT business_partner_ar_control_id_fkey FOREIGN KEY (ar_control_id) REFERENCES public.account(id);


--
-- Name: business_partner business_partner_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_partner
    ADD CONSTRAINT business_partner_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: business_partner business_partner_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_partner
    ADD CONSTRAINT business_partner_currency_fkey FOREIGN KEY (currency) REFERENCES public.currency(code);


--
-- Name: business_partner business_partner_price_level_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_partner
    ADD CONSTRAINT business_partner_price_level_id_fkey FOREIGN KEY (price_level_id) REFERENCES public.price_level(id);


--
-- Name: cost_center cost_center_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_center
    ADD CONSTRAINT cost_center_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: document document_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document
    ADD CONSTRAINT document_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: document document_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document
    ADD CONSTRAINT document_currency_fkey FOREIGN KEY (currency) REFERENCES public.currency(code);


--
-- Name: document document_fiscal_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document
    ADD CONSTRAINT document_fiscal_year_id_fkey FOREIGN KEY (fiscal_year_id) REFERENCES public.fiscal_year(id);


--
-- Name: document document_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document
    ADD CONSTRAINT document_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entry(id);


--
-- Name: document_line document_line_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_line
    ADD CONSTRAINT document_line_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: document_line document_line_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_line
    ADD CONSTRAINT document_line_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.document(id) ON DELETE CASCADE;


--
-- Name: document_line document_line_entered_uom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_line
    ADD CONSTRAINT document_line_entered_uom_id_fkey FOREIGN KEY (entered_uom_id) REFERENCES public.uom(id);


--
-- Name: document_line document_line_foc_reason_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_line
    ADD CONSTRAINT document_line_foc_reason_id_fkey FOREIGN KEY (foc_reason_id) REFERENCES public.foc_reason(id);


--
-- Name: document_line document_line_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_line
    ADD CONSTRAINT document_line_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.item(id);


--
-- Name: document_line document_line_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_line
    ADD CONSTRAINT document_line_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.location(id);


--
-- Name: document_line document_line_source_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_line
    ADD CONSTRAINT document_line_source_line_id_fkey FOREIGN KEY (source_line_id) REFERENCES public.document_line(id);


--
-- Name: document_line document_line_tax_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_line
    ADD CONSTRAINT document_line_tax_code_id_fkey FOREIGN KEY (tax_code_id) REFERENCES public.tax_code(id);


--
-- Name: document document_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document
    ADD CONSTRAINT document_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.location(id);


--
-- Name: document document_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document
    ADD CONSTRAINT document_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.business_partner(id);


--
-- Name: document document_rate_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document
    ADD CONSTRAINT document_rate_type_fkey FOREIGN KEY (rate_type) REFERENCES public.rate_type(code);


--
-- Name: document document_salesman_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document
    ADD CONSTRAINT document_salesman_id_fkey FOREIGN KEY (salesman_id) REFERENCES public.salesman(id);


--
-- Name: document document_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document
    ADD CONSTRAINT document_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.document(id);


--
-- Name: document document_to_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document
    ADD CONSTRAINT document_to_location_id_fkey FOREIGN KEY (to_location_id) REFERENCES public.location(id);


--
-- Name: exchange_rate exchange_rate_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_rate
    ADD CONSTRAINT exchange_rate_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: exchange_rate exchange_rate_from_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_rate
    ADD CONSTRAINT exchange_rate_from_currency_fkey FOREIGN KEY (from_currency) REFERENCES public.currency(code);


--
-- Name: exchange_rate exchange_rate_rate_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_rate
    ADD CONSTRAINT exchange_rate_rate_type_fkey FOREIGN KEY (rate_type) REFERENCES public.rate_type(code);


--
-- Name: exchange_rate exchange_rate_to_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_rate
    ADD CONSTRAINT exchange_rate_to_currency_fkey FOREIGN KEY (to_currency) REFERENCES public.currency(code);


--
-- Name: fiscal_period fiscal_period_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_period
    ADD CONSTRAINT fiscal_period_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: fiscal_period fiscal_period_fiscal_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_period
    ADD CONSTRAINT fiscal_period_fiscal_year_id_fkey FOREIGN KEY (fiscal_year_id) REFERENCES public.fiscal_year(id);


--
-- Name: fiscal_year fiscal_year_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_year
    ADD CONSTRAINT fiscal_year_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: foc_reason foc_reason_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.foc_reason
    ADD CONSTRAINT foc_reason_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.account(id);


--
-- Name: foc_reason foc_reason_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.foc_reason
    ADD CONSTRAINT foc_reason_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: item_alias item_alias_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_alias
    ADD CONSTRAINT item_alias_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: item_alias item_alias_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_alias
    ADD CONSTRAINT item_alias_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.item(id) ON DELETE CASCADE;


--
-- Name: item item_base_uom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item
    ADD CONSTRAINT item_base_uom_id_fkey FOREIGN KEY (base_uom_id) REFERENCES public.uom(id);


--
-- Name: item item_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item
    ADD CONSTRAINT item_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: item_group item_group_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_group
    ADD CONSTRAINT item_group_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: item_group item_group_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_group
    ADD CONSTRAINT item_group_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.item_group(id);


--
-- Name: item item_item_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item
    ADD CONSTRAINT item_item_group_id_fkey FOREIGN KEY (item_group_id) REFERENCES public.item_group(id);


--
-- Name: item_price item_price_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_price
    ADD CONSTRAINT item_price_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: item_price item_price_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_price
    ADD CONSTRAINT item_price_currency_fkey FOREIGN KEY (currency) REFERENCES public.currency(code);


--
-- Name: item_price item_price_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_price
    ADD CONSTRAINT item_price_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.item(id) ON DELETE CASCADE;


--
-- Name: item_price item_price_price_level_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_price
    ADD CONSTRAINT item_price_price_level_id_fkey FOREIGN KEY (price_level_id) REFERENCES public.price_level(id);


--
-- Name: item_price item_price_uom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_price
    ADD CONSTRAINT item_price_uom_id_fkey FOREIGN KEY (uom_id) REFERENCES public.uom(id);


--
-- Name: item_reorder item_reorder_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_reorder
    ADD CONSTRAINT item_reorder_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: item_reorder item_reorder_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_reorder
    ADD CONSTRAINT item_reorder_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.item(id) ON DELETE CASCADE;


--
-- Name: item_reorder item_reorder_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_reorder
    ADD CONSTRAINT item_reorder_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.location(id);


--
-- Name: item_uom item_uom_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_uom
    ADD CONSTRAINT item_uom_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: item_uom item_uom_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_uom
    ADD CONSTRAINT item_uom_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.item(id) ON DELETE CASCADE;


--
-- Name: item_uom item_uom_uom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_uom
    ADD CONSTRAINT item_uom_uom_id_fkey FOREIGN KEY (uom_id) REFERENCES public.uom(id);


--
-- Name: journal_entry journal_entry_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry
    ADD CONSTRAINT journal_entry_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: journal_entry journal_entry_fiscal_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry
    ADD CONSTRAINT journal_entry_fiscal_period_id_fkey FOREIGN KEY (fiscal_period_id) REFERENCES public.fiscal_period(id);


--
-- Name: journal_entry journal_entry_reversed_by_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry
    ADD CONSTRAINT journal_entry_reversed_by_entry_id_fkey FOREIGN KEY (reversed_by_entry_id) REFERENCES public.journal_entry(id);


--
-- Name: journal_entry journal_entry_reverses_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry
    ADD CONSTRAINT journal_entry_reverses_entry_id_fkey FOREIGN KEY (reverses_entry_id) REFERENCES public.journal_entry(id);


--
-- Name: journal_line journal_line_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_line
    ADD CONSTRAINT journal_line_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.account(id);


--
-- Name: journal_line journal_line_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_line
    ADD CONSTRAINT journal_line_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: journal_line journal_line_cost_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_line
    ADD CONSTRAINT journal_line_cost_center_id_fkey FOREIGN KEY (cost_center_id) REFERENCES public.cost_center(id);


--
-- Name: journal_line journal_line_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_line
    ADD CONSTRAINT journal_line_currency_fkey FOREIGN KEY (currency) REFERENCES public.currency(code);


--
-- Name: journal_line journal_line_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_line
    ADD CONSTRAINT journal_line_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entry(id);


--
-- Name: journal_line journal_line_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_line
    ADD CONSTRAINT journal_line_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.location(id);


--
-- Name: journal_line journal_line_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_line
    ADD CONSTRAINT journal_line_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.business_partner(id);


--
-- Name: journal_line journal_line_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_line
    ADD CONSTRAINT journal_line_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.project(id);


--
-- Name: location location_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location
    ADD CONSTRAINT location_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: location location_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location
    ADD CONSTRAINT location_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.location(id);


--
-- Name: number_series number_series_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_series
    ADD CONSTRAINT number_series_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: number_series number_series_fiscal_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_series
    ADD CONSTRAINT number_series_fiscal_year_id_fkey FOREIGN KEY (fiscal_year_id) REFERENCES public.fiscal_year(id);


--
-- Name: payment_allocation payment_allocation_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_allocation
    ADD CONSTRAINT payment_allocation_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: payment_allocation payment_allocation_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_allocation
    ADD CONSTRAINT payment_allocation_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.document(id);


--
-- Name: payment_allocation payment_allocation_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_allocation
    ADD CONSTRAINT payment_allocation_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.document(id);


--
-- Name: price_level price_level_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_level
    ADD CONSTRAINT price_level_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: project project_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project
    ADD CONSTRAINT project_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: promotion promotion_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion
    ADD CONSTRAINT promotion_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: promotion promotion_item_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion
    ADD CONSTRAINT promotion_item_group_id_fkey FOREIGN KEY (item_group_id) REFERENCES public.item_group(id);


--
-- Name: promotion promotion_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion
    ADD CONSTRAINT promotion_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.item(id);


--
-- Name: salesman salesman_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salesman
    ADD CONSTRAINT salesman_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: salesman salesman_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salesman
    ADD CONSTRAINT salesman_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.location(id);


--
-- Name: stock_movement stock_movement_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movement
    ADD CONSTRAINT stock_movement_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: stock_movement stock_movement_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movement
    ADD CONSTRAINT stock_movement_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.document(id);


--
-- Name: stock_movement stock_movement_document_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movement
    ADD CONSTRAINT stock_movement_document_line_id_fkey FOREIGN KEY (document_line_id) REFERENCES public.document_line(id);


--
-- Name: stock_movement stock_movement_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movement
    ADD CONSTRAINT stock_movement_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.item(id);


--
-- Name: stock_movement stock_movement_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movement
    ADD CONSTRAINT stock_movement_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.location(id);


--
-- Name: system_account system_account_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_account
    ADD CONSTRAINT system_account_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.account(id);


--
-- Name: system_account system_account_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_account
    ADD CONSTRAINT system_account_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: tax_code tax_code_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_code
    ADD CONSTRAINT tax_code_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- Name: tax_code tax_code_input_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_code
    ADD CONSTRAINT tax_code_input_account_id_fkey FOREIGN KEY (input_account_id) REFERENCES public.account(id);


--
-- Name: tax_code tax_code_output_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_code
    ADD CONSTRAINT tax_code_output_account_id_fkey FOREIGN KEY (output_account_id) REFERENCES public.account(id);


--
-- Name: uom uom_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uom
    ADD CONSTRAINT uom_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id);


--
-- PostgreSQL database dump complete
--

\unrestrict iaECVP1Wd1Y5OmksphE6B7987ILOKlGlchxjEtk8S6ZVaphKN1STbNH9oW9k39L


-- 0007_determination.sql
-- Account determination — the posting engine's configuration layer.
--
-- This is the table that lets one codebase serve many clients across many
-- industries. A document never names a GL account; it describes what
-- happened, and these rules resolve the accounts. Onboarding a client is
-- filling this in. Never a code change, never a branch.

create table account_determination (
    id            uuid primary key default gen_random_uuid(),
    company_id    uuid not null references company(id),

    role          text not null check (role in (
        'INVENTORY',
        'COGS',
        'REVENUE',
        'SALES_RETURN',
        'AR_CONTROL',
        'AP_CONTROL'
    )),

    -- Match criteria. All nullable: null means "any". The most specific
    -- matching rule wins.
    item_group_id uuid references item_group(id),
    partner_id    uuid references business_partner(id),
    location_id   uuid references location(id),

    account_id    uuid not null references account(id),

    created_at    timestamptz not null default now(),

    unique (company_id, role, item_group_id, partner_id, location_id)
);

create index on account_determination (company_id, role);

-- Specificity: a rule naming three criteria beats one naming two.
-- A company-wide fallback (all criteria null) scores zero and is used last.
create or replace function fn_resolve_account(
    p_company    uuid,
    p_role       text,
    p_item_group uuid default null,
    p_partner    uuid default null,
    p_location   uuid default null
) returns uuid language plpgsql stable as $$
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

-- Item groups inherit up the tree, so a rule set on a parent group covers
-- every child unless a child overrides it.
create or replace function fn_resolve_account_for_item(
    p_company  uuid,
    p_role     text,
    p_item     uuid,
    p_partner  uuid default null,
    p_location uuid default null
) returns uuid language plpgsql stable as $$
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

-- Partner control accounts: the partner's own override first, then the rules.
create or replace function fn_resolve_control_account(
    p_company uuid, p_role text, p_partner uuid
) returns uuid language plpgsql stable as $$
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

create or replace function fn_system_account(p_company uuid, p_role text)
returns uuid language plpgsql stable as $$
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

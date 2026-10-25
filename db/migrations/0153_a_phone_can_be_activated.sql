-- A phone can be activated
--
-- A shop sells the same iPhone twice: sealed, and activated (switched on and
-- registered, then sold on at a lower price). They are different things on the
-- shelf with different costs and prices, and until now the only way to keep
-- both was a second variant with the same values and "(Activated)" typed into
-- its name — which the duplicate check rightly took for a repeat.
--
-- Activation is one more variant value. A sealed phone has none (standard is
-- the absence of the value, so nothing already saved changes); an activated one
-- carries "Activated". Two variants that differ by it are two configurations:
-- v_item_physical keeps them apart and the similar-variant check leaves them
-- alone. Offered for IMEI-tracked products only.

create or replace function fn_seed_activation(p_company uuid) returns void
language plpgsql as $$
declare
    a uuid;
begin
    if exists (select 1 from variant_attribute where company_id = p_company and code = 'ACT') then
        return;
    end if;
    insert into variant_attribute (company_id, code, name, sort_order, identities)
    values (p_company, 'ACT', 'Activation',
            coalesce((select max(sort_order) + 1 from variant_attribute where company_id = p_company), 0),
            '{IMEI}')
    returning id into a;
    insert into variant_option (company_id, attribute_id, code, name, sort_order)
    values (p_company, a, 'ACTIVATED', 'Activated', 0);
end $$;

comment on function fn_seed_activation(uuid) is
    'Activation variant attribute with its one value, Activated; a standard variant has none. Idempotent.';

select fn_seed_activation(id) from company;

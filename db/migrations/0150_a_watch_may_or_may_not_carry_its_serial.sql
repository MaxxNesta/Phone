-- A watch may or may not carry its serial
--
-- Three things a shop that keeps its old codes runs into.
--
-- 1. Optional tracking. Some products arrive sometimes with their serials
--    written down and sometimes as a carton counted by quantity — an Apple
--    Watch bought from one supplier with a list of serials and from another
--    without. item.identity gains OPTIONAL: a receipt line names every unit
--    or none of them, and either is allowed. Named units are stock_serial
--    rows on their layer exactly as before; anonymous units are the rest of
--    the layer. tracks_serial stays "every unit must be named", so it is
--    false for OPTIONAL and every screen and posting that requires serials
--    keeps requiring them for IMEI and SERIAL items only. Tracking is a field
--    somebody chose; nothing reads it out of a name or a size.
--
-- 2. A variant's name can be typed. The generated "Apple Watch Series 11
--    42mm / Black" is a default, and name_is_custom says somebody replaced
--    it, so nothing that regenerates names may overwrite it.
--
-- 3. Two variants can be the same thing. A shop with history has 42MM and 42
--    as two Size values, and so IW001 (42MM Black) and IW007 (42 Black). They
--    stay two records — codes, stock and costs already hang off each — but
--    the system knows they are one physical configuration (v_item_physical),
--    refuses to create such a pair unless an authorised person says so, and
--    reports add them up once.

-- ------------------------------------------------------------- tracking ---

do $$
declare c record;
begin
    for c in select conrelid::regclass::text as tbl, conname
               from pg_constraint
              where contype = 'c' and conrelid in ('item'::regclass, 'item_group'::regclass)
                and pg_get_constraintdef(oid) ilike '%identity%'
    loop
        execute format('alter table %s drop constraint %I', c.tbl, c.conname);
    end loop;
end $$;

alter table item add constraint item_identity_check
    check (identity in ('IMEI', 'SERIAL', 'OPTIONAL', 'NONE'));
alter table item_group add constraint item_group_identity_check
    check (identity in ('IMEI', 'SERIAL', 'OPTIONAL', 'NONE'));

comment on column item.identity is
    'IMEI or SERIAL (every unit named), OPTIONAL (a receipt names every unit '
    'or none), NONE (quantity only). tracks_serial is true for IMEI and SERIAL.';

create or replace function fn_item_identity_sync() returns trigger
language plpgsql as $$
begin
    if tg_op = 'INSERT' then
        if new.identity = 'NONE' and new.tracks_serial then
            new.identity := 'IMEI';
        end if;
    elsif new.identity is distinct from old.identity then
        null;
    elsif new.tracks_serial is distinct from old.tracks_serial then
        new.identity := case when new.tracks_serial
                             then case when old.identity in ('NONE', 'OPTIONAL') then 'IMEI' else old.identity end
                             else 'NONE' end;
    end if;
    new.tracks_serial := new.identity in ('IMEI', 'SERIAL');
    return new;
end $$;

/** Units on this layer that have a name and have not left it. */
create or replace function fn_lot_named_on_hand(p_lot uuid) returns numeric
language sql stable as $$
    select count(*)::numeric
      from stock_serial s
     where s.stock_lot_id = p_lot
       and not exists (
             select 1 from stock_serial_issue si
              where si.serial_id = s.id
                and coalesce(si.lot_id, s.stock_lot_id) = s.stock_lot_id
                and fn_serial_issue_stands(si.stock_movement_id))
$$;

comment on function fn_lot_named_on_hand(uuid) is
    'Named units still on a layer. What is left of the layer beyond them is '
    'anonymous stock, the only part an issue without serials may draw.';

-- ----------------------------------------------------------- the name ---

alter table item add column if not exists name_is_custom boolean not null default false;
comment on column item.name_is_custom is
    'The variant name was typed rather than generated; keep it as it is.';

-- --------------------------------------------- one physical thing, twice ---

alter table item add column if not exists duplicate_ack_by uuid references app_user(id);
alter table item add column if not exists duplicate_ack_at timestamptz;
comment on column item.duplicate_ack_by is
    'Who confirmed this variant is kept on purpose although another variant '
    'of the product has the same configuration.';

/**
 * A value as a physical fact: case, spaces and punctuation dropped, and a
 * unit after a number dropped — 42MM, 42 mm and 42 are one size, 256GB and
 * 256 GB one storage. Kept in step with physicalValue() in lib/variant-identity.ts.
 */
create or replace function fn_variant_value_norm(p text) returns text
language sql immutable as $$
    select regexp_replace(
             regexp_replace(lower(coalesce(p, '')), '[^a-z0-9.]', '', 'g'),
             '^([0-9]+(\.[0-9]+)?)(mm|cm|in|inch|inches|gb|tb)$', '\1')
$$;

/**
 * Each variant's physical identity: its product and, per attribute, the
 * normalised value. Variants sharing a key are the same configuration kept
 * under two codes; canonical_item_id is the one reports file them under
 * (the lowest code), and members says how many share it.
 */
create or replace view v_item_physical as
with keyed as (
    select i.id as item_id, i.company_id, i.code, i.parent_item_id,
           i.parent_item_id::text || '|' || string_agg(
               o.attribute_id::text || '=' || fn_variant_value_norm(o.name), ';'
               order by o.attribute_id::text) as physical_key
      from item i
      join item_variant_option ivo on ivo.item_id = i.id
      join variant_option o on o.id = ivo.option_id
     where i.parent_item_id is not null
     group by i.id
)
select k.item_id, k.company_id, k.parent_item_id, k.physical_key,
       first_value(k.item_id) over w as canonical_item_id,
       count(*) over (partition by k.physical_key) as members
  from keyed k
window w as (partition by k.physical_key order by k.code, k.item_id);

comment on view v_item_physical is
    'Variants by physical configuration. members > 1: the same thing under '
    'more than one code, added up once in reports under canonical_item_id.';

-- 0012_composed_codes.sql
-- Codes composed from the tree, the way the local trade already writes them.
--
--   Class 01  +  Category 01  +  Child 01  +  Serial 001  ->  010101001
--
-- Users type only their own piece. `segment` on a category and `serial` on an
-- item are what people enter; `code` is derived and kept in step by triggers,
-- so it cannot drift from the tree it describes.

alter table item_group add column segment text;
alter table item       add column serial  text;

-- Backfill. Where a child's existing code already starts with its parent's,
-- the tail is its segment and the composed code comes out unchanged. Anything
-- else keeps its whole code as the segment, which will lengthen it — harmless
-- on an empty or freshly seeded database, and visible immediately if not.
update item_group c
   set segment = case
        when p.code is not null and c.code like p.code || '%'
          then substr(c.code, length(p.code) + 1)
        else c.code
   end
  from item_group p
 where c.parent_id = p.id;

update item_group set segment = code where parent_id is null and segment is null;
update item set serial = code where serial is null;

alter table item_group alter column segment set not null;
alter table item       alter column serial  set not null;

-- ------------------------------------------------------------- composition --

-- A parent's code is already composed, so a child only appends its own piece.
create or replace function fn_compose_group_code(p_parent uuid, p_segment text)
returns text language plpgsql stable as $$
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

create or replace function fn_set_group_code() returns trigger
language plpgsql as $$
begin
    new.code := fn_compose_group_code(new.parent_id, new.segment);
    return new;
end;
$$;

create trigger trg_set_group_code
    before insert or update of segment, parent_id on item_group
    for each row execute function fn_set_group_code();

-- Moving or renaming a branch has to reach everything under it. Touching a
-- child re-fires the BEFORE trigger above, which recomposes its code and
-- cascades on down. The tree is acyclic, so this terminates.
create or replace function fn_recompose_descendants() returns trigger
language plpgsql as $$
begin
    if new.code is distinct from old.code then
        update item_group set segment = segment where parent_id = new.id;
        update item       set serial  = serial  where item_group_id = new.id;
    end if;
    return null;
end;
$$;

create trigger trg_recompose_descendants
    after update on item_group
    for each row execute function fn_recompose_descendants();

-- ------------------------------------------------------------------ items --

create or replace function fn_set_item_code() returns trigger
language plpgsql as $$
declare
    v_group text;
begin
    select code into v_group from item_group where id = new.item_group_id;
    new.code := coalesce(v_group, '') || new.serial;
    return new;
end;
$$;

create trigger trg_set_item_code
    before insert or update of serial, item_group_id on item
    for each row execute function fn_set_item_code();

-- Recompose everything once, so existing rows match the rules above.
update item_group set segment = segment where parent_id is null;
update item set serial = serial;

comment on column item_group.segment is
    'The piece the user types for this level. `code` is this appended to the '
    'parent chain and is maintained by trigger — never write to it directly.';

comment on column item.serial is
    'The item''s own piece. `code` is the category chain plus this.';

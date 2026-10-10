-- Which kinds of product an option applies to.
--
-- An iPhone model comes with one amount of memory; nobody chooses it at the
-- counter, so offering Memory as a variant only multiplies the catalogue by
-- combinations that cannot exist and lengthens every name. A Mac is bought
-- by its memory. The kind of product is already recorded — IMEI for phones,
-- SERIAL for Macs — so an option says which of those it is for. Null is all.

alter table variant_attribute add column if not exists identities text[];

comment on column variant_attribute.identities is
    'Product identities (IMEI, SERIAL, NONE) this attribute is offered for; null means all.';

update variant_attribute set identities = '{SERIAL}' where code = 'MEM' and identities is null;

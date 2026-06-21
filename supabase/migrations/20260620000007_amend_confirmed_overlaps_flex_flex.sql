-- Allow flex-vs-flex confirmed overlaps by making nonflex_item_id nullable
-- and adding a flex_item_id_2 column for the second party in a flex-vs-flex conflict.
-- Exactly one of (nonflex_item_id, flex_item_id_2) must be set on every row.

alter table confirmed_overlaps
  alter column nonflex_item_id drop not null,
  add column flex_item_id_2 uuid references schedulable_items (id) on delete cascade;

alter table confirmed_overlaps
  add constraint chk_conflict_parties check (
    (nonflex_item_id is not null and flex_item_id_2 is null)
    or
    (nonflex_item_id is null     and flex_item_id_2 is not null)
  );

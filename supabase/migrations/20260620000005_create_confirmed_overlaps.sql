create table confirmed_overlaps (
  id                      uuid        primary key default gen_random_uuid(),
  user_id                 uuid        not null references auth.users (id) on delete cascade,

  -- The non-flexible item being overlapped (always one side of a confirmed conflict)
  nonflex_item_id         uuid        not null references schedulable_items (id) on delete cascade,
  -- Set to the specific occurrence date when nonflex_item is recurring; null otherwise
  nonflex_occurrence_date date,

  -- The other party: either a non-flexible schedulable_item or a flexible_placement
  other_item_id           uuid        not null,
  other_item_type         text        not null,
  -- Set when other_item_type = 'non_flexible' and that item is recurring
  other_occurrence_date   date,

  -- The calendar date on which the overlap appears
  overlap_date            date        not null,
  confirmed_at            timestamptz not null default now(),

  constraint chk_other_item_type
    check (other_item_type in ('non_flexible', 'flexible_placement'))
);

alter table confirmed_overlaps enable row level security;

create policy "users manage own confirmed overlaps"
  on confirmed_overlaps
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

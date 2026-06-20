create table flexible_placements (
  id                  uuid        primary key default gen_random_uuid(),
  item_id             uuid        not null unique references schedulable_items (id) on delete cascade,
  user_id             uuid        not null references auth.users (id) on delete cascade,
  placed_date         date        not null,
  placed_start_time   time        not null,
  -- True when the user manually dragged this item; informational only.
  -- Manual placement carries no scheduling protection — the item can still be bumped.
  is_manually_placed  boolean     not null default false,
  -- Updated on every write (scheduler or manual). Useful for debugging stale placements.
  last_scheduled_at   timestamptz not null default now(),

  -- Google Calendar sync
  gcal_event_id       text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table flexible_placements enable row level security;

create policy "users manage own flexible placements"
  on flexible_placements
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger flexible_placements_updated_at
  before update on flexible_placements
  for each row execute function touch_updated_at();

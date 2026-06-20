create table recurrence_exceptions (
  id                        uuid        primary key default gen_random_uuid(),
  series_id                 uuid        not null references schedulable_items (id) on delete cascade,
  user_id                   uuid        not null references auth.users (id) on delete cascade,
  original_date             date        not null,
  is_cancelled              boolean     not null default false,

  -- All override fields are nullable; null means "inherit from series"
  override_title            text,
  override_start_time       time,
  override_duration_minutes int,
  override_notes            text,

  -- Google Calendar sync (instance-level event ID differs from series event ID)
  gcal_event_id             text,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  unique (series_id, original_date),

  constraint chk_override_duration_multiple_of_15
    check (
      override_duration_minutes is null
      or (override_duration_minutes > 0 and override_duration_minutes % 15 = 0)
    )
);

alter table recurrence_exceptions enable row level security;

create policy "users manage own recurrence exceptions"
  on recurrence_exceptions
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger recurrence_exceptions_updated_at
  before update on recurrence_exceptions
  for each row execute function touch_updated_at();

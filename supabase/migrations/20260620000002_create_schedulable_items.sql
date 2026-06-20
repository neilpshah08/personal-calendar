create table schedulable_items (
  id                       uuid        primary key default gen_random_uuid(),
  user_id                  uuid        not null references auth.users (id) on delete cascade,
  title                    text        not null,
  tag_id                   uuid        references tags (id) on delete set null,
  is_flexible              boolean     not null default false,
  duration_minutes         int         not null,
  priority                 text,
  notes                    text,

  -- Non-flexible, non-recurring: exact date + time
  fixed_date               date,
  fixed_start_time         time,

  -- Recurrence (non-flexible items only)
  is_recurring             boolean     not null default false,
  recurrence_days          int[],          -- 0=Sun … 6=Sat
  recurrence_start_date    date,
  recurrence_end_date      date,           -- null = indefinite

  -- Flexible scheduling constraints
  earliest_date            date,           -- null = no lower bound
  due_date                 date,           -- null = no upper bound

  -- Google Calendar sync
  gcal_event_id            text,
  gcal_calendar_id         text,
  gcal_last_synced_at      timestamptz,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- duration must be a positive multiple of 15
  constraint chk_duration_multiple_of_15
    check (duration_minutes > 0 and duration_minutes % 15 = 0),

  -- priority is only meaningful (and required) for flexible items
  constraint chk_priority_values
    check (priority in ('High', 'Medium', 'Low')),

  constraint chk_priority_required_when_flexible
    check (is_flexible = false or priority is not null),

  -- flexible items must not carry fixed-time or recurrence fields
  constraint chk_flexible_has_no_fixed_fields
    check (
      is_flexible = false
      or (
        fixed_date           is null
        and fixed_start_time is null
        and is_recurring     = false
        and recurrence_days  is null
        and recurrence_start_date is null
        and recurrence_end_date   is null
      )
    ),

  -- non-flexible, non-recurring items must have both a date and a start time
  constraint chk_non_flex_non_recurring_has_fixed_time
    check (
      is_flexible = true
      or is_recurring = true
      or (fixed_date is not null and fixed_start_time is not null)
    ),

  -- recurring items use recurrence fields, not fixed_date
  constraint chk_recurring_uses_recurrence_fields
    check (
      is_recurring = false
      or (
        fixed_date             is null
        and recurrence_days    is not null
        and recurrence_start_date is not null
      )
    ),

  -- recurrence fields must not appear on non-recurring items
  constraint chk_non_recurring_has_no_recurrence_fields
    check (
      is_recurring = true
      or (
        recurrence_days       is null
        and recurrence_start_date is null
        and recurrence_end_date   is null
      )
    ),

  -- flexible constraints only make sense on flexible items
  constraint chk_date_constraints_only_on_flexible
    check (
      is_flexible = true
      or (earliest_date is null and due_date is null)
    ),

  -- recurrence is only for non-flexible items
  constraint chk_no_flexible_recurrence
    check (is_flexible = false or is_recurring = false)
);

alter table schedulable_items enable row level security;

create policy "users manage own items"
  on schedulable_items
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Keep updated_at current automatically
create or replace function touch_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger schedulable_items_updated_at
  before update on schedulable_items
  for each row execute function touch_updated_at();

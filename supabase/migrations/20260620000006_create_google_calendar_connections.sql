create table google_calendar_connections (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null unique references auth.users (id) on delete cascade,
  -- Tokens should be encrypted by the application layer before insert.
  -- Supabase Vault can be used here once the project is wired up.
  access_token    text        not null,
  refresh_token   text        not null,
  token_expiry    timestamptz,
  calendar_id     text        not null default 'primary',

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table google_calendar_connections enable row level security;

create policy "users manage own google calendar connection"
  on google_calendar_connections
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger google_calendar_connections_updated_at
  before update on google_calendar_connections
  for each row execute function touch_updated_at();

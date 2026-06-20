create table tags (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users (id) on delete cascade,
  name          text        not null,
  color         text        not null default '#808080',
  created_at    timestamptz not null default now(),

  unique (user_id, name)
);

alter table tags enable row level security;

create policy "users manage own tags"
  on tags
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Seed the five default tags for each new user via a function called from the
-- auth.users trigger (wired up in a later migration once all tables exist).

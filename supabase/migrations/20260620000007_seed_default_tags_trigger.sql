-- Inserts the five default tags whenever a new user signs up.
-- The function is intentionally a no-op if tags already exist (idempotent).
create or replace function seed_default_tags_for_user()
  returns trigger language plpgsql security definer as $$
begin
  insert into public.tags (user_id, name, color) values
    (new.id, 'StudyCore',    '#185FA5'),
    (new.id, 'Ripple',       '#0F6E56'),
    (new.id, 'Cold Calling', '#534AB7'),
    (new.id, 'Content',      '#D85A30'),
    (new.id, 'Admin',        '#BA7517')
  on conflict (user_id, name) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_seed_tags
  after insert on auth.users
  for each row execute function seed_default_tags_for_user();

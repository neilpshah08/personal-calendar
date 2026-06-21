-- Add source + RRULE tracking to schedulable_items.
-- (gcal_event_id / gcal_calendar_id / gcal_last_synced_at already exist from migration 002.)
alter table schedulable_items
  add column source text not null default 'app'
    constraint chk_source check (source in ('app', 'gcal')),
  add column gcal_rrule text;

-- A partial unique index lets us upsert by (user_id, gcal_event_id) without
-- touching the NULL rows that belong to app-created items.
create unique index schedulable_items_user_gcal_event_id_idx
  on schedulable_items (user_id, gcal_event_id)
  where gcal_event_id is not null;

-- Sync state lives on the connection row so we know when the last full/
-- incremental sync ran and can store the GCal page-sync token.
alter table google_calendar_connections
  add column gcal_sync_token text,
  add column last_synced_at  timestamptz;
